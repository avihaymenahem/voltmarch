/**
 * ============================================================================
 * VOLTMARCH — src/sim/AI.ts
 * ============================================================================
 * THE SKIRMISH OPPONENT.
 *
 * THE ONE RULE THAT SHAPES EVERYTHING ELSE
 * ----------------------------------------
 * This file issues commands. It does not mutate the world. Every single thing
 * the AI does leaves through `CommandBus.issue*` — the identical struct the
 * human's mouse produces — and the AI has no other exit. It never writes
 * `orderKind`, never writes `credits`, never calls `markDead`, never touches a
 * production queue. Two consequences follow, and they are the reason the rule
 * exists:
 *
 *   - The AI is a live integration test of the command API. If the human can do
 *     something the AI cannot express as a Command, that is a hole in the API,
 *     and this file is where it shows up.
 *   - A match is replayable from `(seed, command log)` with no AI in it at all.
 *
 * The second rule: NO CHEATING VISION. Every read of an enemy goes through
 * `world.vision.canSee()` or `world.vision.isVisibleAt()`, and everything the
 * AI knows beyond that is REMEMBERED — a timestamped entry it saw with its own
 * units and will keep believing until it looks again. Difficulty changes how
 * fast the AI reacts, how many actions per minute it gets, and how well it
 * picks its army (`AI_SKILL.composition`); it does not change what the AI can
 * see. The one sanctioned handicap, `AI_DIFFICULTY[].resourceBonus`, is an
 * ECONOMIC bonus and is published on `AiBrain.resourceBonus` for the economy
 * module to apply — applying it here would mean writing `credits` from
 * Phase.AI, which the write-ownership table in core/loop.ts forbids.
 *
 * LAYERS, EACH ON ITS OWN SLOW CLOCK
 * ----------------------------------
 * Nothing here runs per frame and nothing runs per tick. Five layers tick at
 * their own cadence (see `AI_CADENCE`), staggered by player id so eight brains
 * never spike on the same tick:
 *
 *   CENSUS   1 Hz  — who do I own, what can I see, what do I remember
 *   ECONOMY  2 Hz  — harvesters mining and alive, power ahead of demand
 *   BUILD    2 Hz  — the opening, then adaptive queueing + structure placement
 *   SQUAD    5 Hz  — group assembly, objective choice, retreat, home defence
 *   SCOUT   .3 Hz  — send something cheap, remember what it saw
 *   LATE     2 Hz  — fire a superweapon, call a commander power
 *
 * THE LATE LAYER, AND THE THREE VERBS IT ALREADY KNEW
 * ---------------------------------------------------
 * Superweapons, commander powers and in-match upgrades all shipped complete and
 * player-usable and the AI asked for none of them, which meant a human could
 * build a Nuclear Silo and face no answer and no reciprocal threat. Not one of
 * the three needed new plumbing, because each is a verb this file already says:
 *
 *   superweapon   `OrderKind.UseAbility` addressed to the gating STRUCTURE —
 *                 the identical order `commanderAbility` puts on a hero, and
 *                 `SuperweaponService.consumeOrders` reads it back one phase
 *                 later. See `fireSuperweapon`.
 *   power         `CommandBus.issueUsePower`, drained by the one Phase.Command
 *                 drainer into `CommanderPowerService.use`. See `callPower`.
 *   upgrade       `CommandBus.issueProductionStart` — an ordinary queue item on
 *                 an ordinary tab. See `considerUpgrades`.
 *
 * So the rule at the top of this file is untouched: the AI still has exactly
 * one exit, and every refusal — a charge that has not run, a silo standing in a
 * brownout, an upgrade already installed — is still decided by the same service
 * that refuses the human.
 *
 * WHAT DIFFICULTY DOES TO THEM. All three are force multipliers, so all three
 * are on the ladder in `AI_LATE_GAME`: Easy gets none of them at all, Normal
 * gets one superweapon, one upgrade and the two powers that do not attack, and
 * only Brutal gets everything. The fire layer is gated on the SAME number as
 * the build layer, so an Easy brain handed a silo by a scenario still never
 * presses the button.
 *
 * WHAT THE LATE LAYER DOES NOT DO: it never reads the local profile to ask
 * whether a power is "owned". `src/sim/CommanderPowers.ts` explains at length
 * why the simulation must not — the profile is per-browser localStorage and a
 * mid-match refusal on one machine is a lockstep divergence with no findable
 * cause. Ownership is a UI question; the AI has no UI, so its answer is the
 * difficulty mask, which is simulation state and identical everywhere.
 *
 * DETERMINISM: every brain owns a seeded `Rng` derived from the match seed and
 * its player id. No wall clock, no global RNG, no iteration over a Map keyed by
 * anything but insertion order. Nothing added for the late layer draws from the
 * RNG at all — every choice below is a deterministic scan of remembered
 * structures, the threat grid and the brain's own census.
 *
 * ZERO ALLOCATION: every buffer is sized at construction from the caps in
 * config.ts. The only `new` after boot is in `intent()`, which the debug probe
 * calls by hand and the sim never calls at all.
 * ============================================================================
 */

import {
  AI_BUILD, AI_CADENCE, AI_ECONOMY, AI_MEMORY, AI_MILITARY, AI_ROSTER_CAP,
  AI_SCOUT, AI_SQUAD_MAX, AI_SQUAD_MIN, AI_THREAT_CLASS_COUNT,
  ABILITIES, AbilityId,
  BUILD_RADIUS, CELL, MAP_CELLS, MAP_SIZE, MAX_QUEUE_DEPTH, SIM_DT, SIM_HZ,
} from '../core/config';
import {
  BUILD_TAB_COUNT,
  EntityFlag, EntityKind, Faction, FACTION_PALETTE_KEYS, Locomotor, NONE, OrderKind, Stance,
  UnitState,
} from '../core/types';
import type {
  ArmorClass, EntityId, PlayerId, PlayerState, SimContext,
} from '../core/types';
import { abilities } from './Abilities';
import { transportService } from './Transport';
import { MoveClass, getNav, navigableSeaCells } from './Flowfield';
import { mapSupportsNaval } from './NavalWater';
import { moveClassAt } from './Movement';
import { SUPERWEAPONS, SuperweaponId, superweapons } from './Superweapons';
import type { SuperweaponDef } from './Superweapons';
import { commanderPowers } from './CommanderPowers';
import { hasUpgradeKey } from './Upgrades';
import {
  COMMANDER_POWERS, CommanderPowerId, ownsCommanderPower, powerByContentKey,
} from '../progression/powers';
import type { Channels, CommandBus, EventBus } from '../core/events';
import type { EntityStore, World } from '../core/world';
import { PerEntityU32 } from '../core/world';
import { Rng, cellToWorld, clamp, clampCell, dist2, distSq2, hash2i, worldToCell } from '../core/math';
import {
  AI_DEPLOY, AI_NAVAL, AI_POWER, AI_POWER_BUY, AI_SUPERWEAPON, AI_UPGRADE, BUILD_ROLE_NAMES,
  BuildCatalog, BuildRole, THREAT_CLASS_NAMES, UpgradeAudience,
  classifyThreat, difficultyProfile, openingFor, personalityProfile, pickUnit,
  powerPlanFor, prereqsMet, superweaponPlanFor, upgradePlanFor,
} from './AIStrategy';
import type {
  CatalogEntry, DefLookup, DifficultyProfile, OpeningStep, PersonalityProfile,
  ProductionOracle, UpgradePlanStep,
} from './AIStrategy';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

/** What the brain currently believes it is doing. Published to the probe. */
export const enum AiPosture {
  /** Before the first census — no idea yet. */
  Boot = 0,
  /** Following the scripted opening; no army worth committing. */
  Opening = 1,
  /** Economy is the priority: refineries, harvesters, a second field. */
  Expanding = 2,
  /** Building an attack group and waiting for it to reach threshold. */
  Massing = 3,
  /** Strike group is committed to an objective. */
  Attacking = 4,
  /** Something is hitting the base; everything that can respond is responding. */
  Defending = 5,
  /** The wave lost; pulling back to the rally point. */
  Retreating = 6,
  /** No Construction Yard. Spend everything, attack with everything. */
  Crippled = 7,
  /** Eliminated. */
  Defeated = 8,
}

export const AI_POSTURE_NAMES: readonly string[] = [
  'boot', 'opening', 'expanding', 'massing', 'attacking', 'defending',
  'retreating', 'crippled', 'defeated',
];

/** Squad tags, stored in a generation-stamped side array. */
const GROUP_NONE = 0;
const GROUP_RESERVE = 1;
const GROUP_STRIKE = 2;
const GROUP_SCOUT = 3;
/**
 * Committed to an amphibious operation.
 *
 * A fourth tag rather than a flag on the strike group, and for the same reason
 * `GROUP_SCOUT` is one: `regroupSquads` walks the army and files everything it
 * finds into strike or reserve, so anything with a job of its own has to be
 * INVISIBLE to that pass or it will be re-tagged and walked off to the rally
 * point in the middle of boarding. The tag is cleared the moment the squad is
 * back on dry land, which is what returns them to the ordinary strike group.
 */
const GROUP_NAVAL = 4;

/** What an amphibious operation is currently doing. */
const enum AmphibState {
  /** Nothing staged. */
  Idle = 0,
  /** A squad has been told to board, and the hull is holding at the beach. */
  Boarding = 1,
  /** Loaded, and sailing for the landing point. */
  Crossing = 2,
  /** At the landing point, with an Unload order standing. */
  Landing = 3,
}

/** Anything a unit must have to be worth ordering around. */
const ORDERABLE_REQUIRE = EntityFlag.Alive | EntityFlag.CanMove;
const ORDERABLE_REJECT =
  EntityFlag.PendingDestroy | EntityFlag.Garrisoned | EntityFlag.UnderConstruction;

/** A readable snapshot of one brain, for `__VM.hooks.ai()`. */
export interface AiIntent {
  player: number;
  name: string;
  faction: string;
  difficulty: string;
  personality: string;
  posture: string;
  /** What the military layer thinks it is doing. */
  military: string;
  /** What the build layer thinks it is doing. */
  economy: string;
  credits: number;
  power: number;
  army: number;
  strike: number;
  reserve: number;
  harvesters: number;
  refineries: number;
  /** Construction vehicles owned and not yet unfolded. */
  mcvs: number;
  /** What the deploy layer is doing. Empty when it has nothing to do. */
  deploy: string;
  /** What the late layer is doing. Empty when it has nothing to do. */
  lateGame: string;
  /** What the navy layer is doing. Empty when there is no water to think about. */
  naval: string;
  /** Water cells found near the base. -1 before the first probe. */
  seaCells: number;
  navalYards: number;
  warships: number;
  transports: number;
  /** Landings that put a squad ashore. */
  landings: number;
  /** Why the last amphibious evaluation decided as it did, with numbers. */
  amphibious: string;
  /** Superweapon structures owned or going up. */
  superweapons: number;
  /** Strikes actually fired, powers actually called, upgrades actually bought. */
  superweaponsFired: number;
  powersCalled: number;
  upgradesBought: number;
  /** Commander powers requisitioned from a Command Post. */
  powersBought: number;
  /** Structures owned, by role name. */
  structures: Record<string, number>;
  /** Observed threat mix, by class name, normalised. */
  threat: Record<string, number>;
  waveThreshold: number;
  objectiveX: number;
  objectiveZ: number;
  enemyBaseKnown: boolean;
  rememberedStructures: number;
  basePressure: number;
  commandsIssued: number;
  /** Empty when the AI is playing normally; otherwise why it is stuck. */
  blocked: string;
}

/* ==========================================================================
 * 2. THE BRAIN
 * ========================================================================== */

const THREAT_DIM = Math.max(1, Math.floor(MAP_CELLS / AI_MEMORY.threatDiv));
const THREAT_CELLS = THREAT_DIM * THREAT_DIM;
/** Metres covered by one threat-grid bucket. */
const THREAT_BUCKET_METRES = MAP_SIZE / THREAT_DIM;

/** Max commands the budget may bank, so a paused AI does not burst on resume. */
const ACTION_BURST_CAP = 8;

/**
 * Hostiles that have to be standing inside a commander's ability radius before
 * the AI spends it.
 *
 * THREE, not one. Every one of the four abilities is worth roughly a squad —
 * an area burst, five seconds of invulnerability for everyone nearby, a recall
 * of six units — and every one is on a 40-60 second cooldown. Firing at the
 * first lone scout that wanders past is how an AI arrives at the real fight
 * with its hero button still greyed out, which is exactly how a human loses a
 * game with an unspent superweapon.
 */
const ABILITY_MIN_ENEMIES = 3;

/**
 * The one thing the late layer asks of the commander-power service.
 *
 * Structural, and narrow to a single method, for the reason `ProductionOracle`
 * is: the brain stays constructible and testable with no power system in the
 * process, and a test can hand it a two-line stub instead of a `World`.
 */
interface CommanderPowerReader {
  isReady(player: PlayerId, power: number): boolean;
}

/**
 * What one remembered enemy structure is worth to a SUPERWEAPON blast.
 *
 * Deliberately not `pickObjective`'s table, and the gap between them is the
 * whole reason to own a superweapon rather than another tank. A strike group
 * has to survive the walk in, so `pickObjective` scores static defence highest
 * at 3.0 — clear the coil or lose the wave. A warhead does not walk. What it is
 * worth is measured purely in what the enemy cannot replace quickly, so defence
 * drops to the bottom of this list and the economy rises to the top: a
 * refinery is 2000 credits and a harvester's whole route, a war factory is
 * every hull that has not been built yet, and the Construction Yard is both.
 *
 * A pillbox at 0.4 still counts for something, because a cluster scored by
 * SUM means a tight ring of defences around a refinery correctly reads as a
 * better aim point than the same refinery standing alone.
 */
function strikeValue(role: BuildRole): number {
  switch (role) {
    case BuildRole.Refinery: return 3.0;
    case BuildRole.WarFactory: return 2.6;
    case BuildRole.Builder: return 2.4;
    case BuildRole.TechLab:
    case BuildRole.Superweapon: return 2.2;
    case BuildRole.Barracks: return 1.8;
    case BuildRole.Power: return 1.6;
    case BuildRole.Radar: return 1.2;
    case BuildRole.Defense:
    case BuildRole.AntiAir: return 0.4;
    default: return 0.8;
  }
}

export class AiBrain {
  readonly player: PlayerId;
  readonly faction: Faction;
  readonly diff: DifficultyProfile;
  readonly pers: PersonalityProfile;

  /** Published for the economy module. This file never applies it. */
  get resourceBonus(): number { return this.diff.resourceBonus; }

  private readonly world: World;
  private readonly store: EntityStore;
  private readonly commands: CommandBus;
  private readonly catalog: BuildCatalog;
  private readonly rng: Rng;
  /**
   * The production module's own rule engine, when it is in the process. With
   * it, "can I build this" and "may I put it here" are answered by exactly the
   * code the human's sidebar and build ghost use. Without it the brain falls
   * back to its own equivalents, which is what the headless tests exercise.
   */
  private oracle: ProductionOracle | null = null;

  /** Tick offset so N brains never run the same layer on the same tick. */
  private readonly phaseOffset: number;

  /* -- squad membership -------------------------------------------------- */
  /** Generation-stamped, so a dead unit silently leaves its group. */
  private readonly groupTag: PerEntityU32;

  /* -- own census -------------------------------------------------------- */
  private readonly armyIds = new Int32Array(AI_ROSTER_CAP);
  private armyCount = 0;
  private readonly strikeIds = new Int32Array(AI_ROSTER_CAP);
  private strikeCount = 0;
  private readonly reserveIds = new Int32Array(AI_ROSTER_CAP);
  private reserveCount = 0;
  private readonly harvesterIds = new Int32Array(64);
  private harvesterCount = 0;
  /**
   * Construction vehicles we own and have not unfolded yet.
   *
   * This is the single most important census row in the opening: a match now
   * begins with one of these and NOTHING else (`game/Scenarios.ts` start
   * condition `mcv`), so an AI that does not see it here is an AI that stands in
   * a field for twenty minutes while the match looks perfectly normal.
   */
  private readonly mcvIds = new Int32Array(8);
  private mcvCount = 0;
  /** Completed structures owned, indexed by BuildRole. */
  private readonly roleCount = new Int32Array(BUILD_ROLE_NAMES.length);
  /** Structures of each role still under construction. */
  private readonly roleBuilding = new Int32Array(BUILD_ROLE_NAMES.length);
  private scoutId: EntityId = NONE;

  /** Centroid of owned structures — "the base". */
  private baseX = MAP_SIZE * 0.5;
  private baseZ = MAP_SIZE * 0.5;
  /** The Construction Yard we place from. NONE when crippled. */
  private builderId: EntityId = NONE;
  private builderX = MAP_SIZE * 0.5;
  private builderZ = MAP_SIZE * 0.5;

  /* -- enemy knowledge (vision-gated, then remembered) -------------------- */
  private readonly memX = new Float32Array(AI_MEMORY.structureSlots);
  private readonly memZ = new Float32Array(AI_MEMORY.structureSlots);
  private readonly memCell = new Int32Array(AI_MEMORY.structureSlots);
  private readonly memRole = new Uint8Array(AI_MEMORY.structureSlots);
  private readonly memSeen = new Int32Array(AI_MEMORY.structureSlots);
  private readonly memTouched = new Uint8Array(AI_MEMORY.structureSlots);
  private memCount = 0;

  /** Coarse mobile-threat field. Decays; never cheats. */
  private readonly threatGrid = new Float32Array(THREAT_CELLS);
  /** Exponentially-smoothed histogram over ThreatClass. */
  private readonly threatMix = new Float32Array(AI_THREAT_CLASS_COUNT);
  private readonly threatObs = new Float32Array(AI_THREAT_CLASS_COUNT);
  /** Tick an airborne enemy was last observed. -1 = never. */
  private sawAirTick = -1;
  /**
   * Tick an airborne enemy was FIRST observed. -1 = never.
   *
   * Separate from `sawAirTick` because the reaction delay has to be measured
   * from the sighting that started the clock, not from the most recent frame of
   * a gunship that has been circling for a minute — otherwise a flyer that
   * stays visible resets the timer forever and an Easy brain never reacts at
   * all, which is the opposite of a difficulty knob.
   */
  private firstAirTick = -1;

  /** Best guess at where the enemy lives. */
  private enemyBaseX = -1;
  private enemyBaseZ = -1;

  /* -- pressure and reaction --------------------------------------------- */
  /** Decaying "my base is being hit" signal, in HP-fraction units. */
  private basePressure = 0;
  private attackX = -1;
  private attackZ = -1;
  /** Tick the base attack was OBSERVED. Acted on only after reactionTicks. */
  private attackObservedTick = -1e9;
  private lastDamageTick = -1e9;

  /* -- production bookkeeping -------------------------------------------- */
  /** Requests issued but not yet acknowledged by a `production:started`. */
  /**
   * Outstanding `ProductionStart`s per tab, and the tick each was issued.
   *
   * `BUILD_TAB_COUNT`, NOT 4. Both of these were `new Int32Array(4)` and the
   * guards that read them tested `tab > 3`, which is the same literal written
   * five times. When `BuildTab.Powers` landed at index 4 the effect was
   * silent and total: `canQueue` refused every commander power outright, so a
   * brain built its Command Post, banked thirty thousand credits and never
   * bought a thing. Nothing threw, nothing logged, and every unit test passed
   * — it took booting a match and watching a Brutal AI sit on the money.
   */
  private readonly inFlight = new Int32Array(BUILD_TAB_COUNT);
  private readonly inFlightTick = new Int32Array(BUILD_TAB_COUNT);
  /** Structures that finished and are waiting for a PlaceBuilding command. */
  private readonly pendingPlaceDef = new Int32Array(MAX_QUEUE_DEPTH);
  private pendingPlaceCount = 0;

  private readonly opening: readonly OpeningStep[];
  private openingIndex = 0;

  /* -- military ----------------------------------------------------------- */
  private posture: AiPosture = AiPosture.Boot;
  private objectiveX = -1;
  private objectiveZ = -1;
  private objectiveIssuedTick = -1e9;
  private waveEscalation = 0;
  private strikeStartCount = 0;
  private regroupUntilTick = 0;
  /**
   * Earliest tick an OFFENSIVE commit is allowed. Set once from the difficulty
   * at construction and then only ever brought forward, never pushed back.
   * Defence ignores it entirely — `defendBase` returns above this gate.
   */
  private offensiveUnlockTick = 0;
  /** Tick the last wave went out, for the `rearmTicks` gap between pushes. */
  private lastWaveTick = -1e9;
  /** Ticks between waves for this difficulty. Resolved once. */
  private readonly rearmTicks: number;
  /** Last tick a gather order went out. Rate-limits the rally nudge. */
  private lastGatherTick = -1e9;
  private rallyX = MAP_SIZE * 0.5;
  private rallyZ = MAP_SIZE * 0.5;

  /* -- the navy ------------------------------------------------------------ */
  /** Troop hulls owned. Never in `armyIds` — see `navalRoleOfUnit`. */
  private readonly transportIds = new Int32Array(8);
  private transportCount = 0;
  /** Armed hulls owned. Never in `armyIds`, for the same reason. */
  private readonly warshipIds = new Int32Array(16);
  private warshipCount = 0;
  /**
   * Naval cells within `AI_NAVAL.seaSearchCells` of the base, counted on the
   * census clock. 0 means "landlocked as far as this brain is concerned", and
   * it is the gate every other naval thought sits behind.
   */
  private seaCells = -1;
  /**
   * Does this MAP have a navy at all — the shared `mapSupportsNaval()` answer.
   *
   * Separate from `seaCells` because it is a different question with a
   * different lifetime. This one is about the MAP, is the same predicate the
   * build menu is entitled to, and is re-asked every census because it costs
   * two array reads. `shoreCx` is about this BASE and is cached behind a ring
   * walk.
   */
  private navalMap = false;
  /** Where `probeSea` last ran. Water cannot move, so a still base re-probes never. */
  private seaProbeX = -1e9;
  private seaProbeZ = -1e9;
  /** A cell on our own beach: foot-passable land touching the sea. -1 when none. */
  private shoreCx = -1;
  private shoreCz = -1;
  /*
   * `shoreWaterCx/Cz` used to live here — the wet cell beside our own beach,
   * written by every `probeSea` and READ BY NOTHING. The wet cell that actually
   * matters is the one beside the FAR beach, and `amphibiousWanted` takes that
   * straight out of `shoreOut[2]/[3]` at the moment it needs it. A field that is
   * only ever written is a comment that the compiler cannot check, so it is
   * gone rather than left looking load-bearing.
   */
  /** Where the warships hold station. -1 when there is no sea to hold. */
  private stationX = -1;
  private stationZ = -1;
  private lastStationTick = -1e9;

  /* -- the amphibious operation -------------------------------------------- */
  private amphib: AmphibState = AmphibState.Idle;
  /** The hull carrying the operation. NONE when nothing is staged. */
  private amphibHull: EntityId = NONE;
  /** The squad committed to it, tagged GROUP_NAVAL. */
  private readonly amphibSquad = new Int32Array(8);
  private amphibSquadCount = 0;
  /** Beach the squad boards from, and the hostile beach it lands on. */
  private embarkX = -1;
  private embarkZ = -1;
  private landX = -1;
  private landZ = -1;
  /** Tick the current state was entered. Drives the abandon clocks. */
  private amphibTick = -1e9;
  /** Cached verdict of `amphibiousWanted`, and the tick it was taken. */
  private amphibWanted = false;
  private amphibEvalTick = -1e9;
  /** Last tick an order went out for the operation. Rate-limits re-issue. */
  private amphibIssuedTick = -1e9;
  /** Landings that reached Unload and put at least one man ashore. */
  private landingsMade = 0;
  /** What the navy layer is doing. Empty when it has nothing to do. */
  private navalGoal = '';
  /** Why the last amphibious evaluation refused. Published to the probe. */
  private amphibVerdict = '';
  /** Scratch for the shore search. Written, never retained. */
  private readonly shoreOut = new Int32Array(4);

  /* -- scouting ----------------------------------------------------------- */
  private readonly scoutWaypointX = new Float32Array(6);
  private readonly scoutWaypointZ = new Float32Array(6);
  private scoutWaypointCount = 0;
  private scoutWaypoint = 0;
  private nextScoutTick = 0;

  /* -- deployment ---------------------------------------------------------- */
  /** The construction vehicle currently being driven to a site. */
  private deployId: EntityId = NONE;
  private deployX = -1;
  private deployZ = -1;
  /** Tick the LAST Deploy order went out. Rate-limits the re-issue. */
  private deployIssuedTick = -1e9;
  /**
   * Tick the FIRST Deploy order for the current site went out, and never
   * refreshed after that.
   *
   * Two clocks, deliberately, and the bug that forced them is worth naming: a
   * single `deployIssuedTick` doing both jobs is bumped by every re-issue, so
   * "has this site had its chance yet" is measured against an order sent a
   * moment ago and the answer is always no. The AI then re-proposes the same
   * refused site forever, at 87 orders per four thousand ticks, and never
   * relocates once.
   */
  private deployArmedTick = -1e9;
  /** Tick the current SITE was chosen. Drives the relocate-and-retry clock. */
  private deploySiteTick = -1e9;
  /** Sites abandoned as unreachable or unbuildable. Widens the next search. */
  private deployAttempts = 0;
  /** Last tick a move-to-site order went out. Rate-limits the approach. */
  private lastDeployMoveTick = -1e9;
  /** Last tick an ability order went out. One hero, so one counter suffices. */
  private abilityIssuedTick = -1e9;
  private deployGoal = '';

  /* -- economy ------------------------------------------------------------ */
  private wantHarvesters = 0;
  private powerUrgent = false;
  private oreStarved = false;
  private expandX = -1;
  private expandZ = -1;
  /**
   * Power surplus the economy layer last projected, with everything under
   * construction already charged against it.
   *
   * Published as a field purely so the superweapon gate can read it. -150 is
   * more than three Power Plants make between them, and a silo built into a
   * brownout does not charge slowly — `SuperweaponService.rescanAvailability`
   * skips any structure that needs power and has none, so it does not charge at
   * all. Reacting to that after the fact costs 2500 credits.
   */
  private powerSurplus = 0;

  /* -- the late game ------------------------------------------------------ */
  /** Superweapon structure keys this faction builds, best first. Resolved once. */
  private readonly superPlan: readonly string[];
  /** Upgrades this faction buys, in buy order. Resolved once. */
  private readonly upgradePlan: readonly UpgradePlanStep[];
  /**
   * Bit per `superPlan` index for a superweapon structure already owned OR
   * under construction.
   *
   * The census cannot answer this from `roleCount` alone: every superweapon is
   * `BuildRole.Superweapon`, so a Brutal brain allowed two would happily build
   * a second Nuclear Silo and never touch the Iron Curtain. The mask costs one
   * catalog lookup per superweapon building per census — of which there are
   * never more than two.
   */
  private superOwnedMask = 0;
  /** Infantry and vehicles owned. The upgrade gates are counts of these. */
  private infantryCount = 0;
  private vehicleCount = 0;
  /**
   * Tick each `upgradePlan` step was last asked for. See `upgradeSettled`.
   *
   * Sized to the longest plan any army has (three) with a slot to spare, so it
   * is indexed by plan position rather than by upgrade bit — the brain only
   * ever asks about its own faction's three.
   */
  private readonly upgradeAskedTick = new Int32Array(4).fill(-1e9);
  /**
   * Tick each `powerPlan` step was last asked for. See `powerSettled`.
   *
   * Sized to the plan, which is five for every army — one commander power is
   * the same purchase in every sidebar, so unlike the upgrade plan there is no
   * per-faction length to allow for.
   */
  private readonly powerAskedTick = new Int32Array(COMMANDER_POWERS.length).fill(-1e9);
  /** Commander powers this brain has bought, for the debug probe. */
  private powersBought = 0;
  /** Tick the fire layer last looked for a target and found nothing worth one. */
  private superBackoffTick = -1e9;
  /**
   * Tick the Chronosphere's SOURCE command went out. -1e9 when nothing is
   * staged.
   *
   * The Chronosphere is the one `pointPair` weapon: `consumeOrders` reads the
   * order's TARGET as the stage flag — `NONE` for the source click, the
   * structure's own id to commit — so the AI spends two layer ticks on it, half
   * a second apart, exactly as a human spends two clicks.
   */
  private chronoStagedTick = -1e9;
  /** What the late layer is doing. Empty when it has nothing to do. */
  private lateGoal = '';
  private superweaponsFired = 0;
  private powersCalled = 0;
  private upgradesRequested = 0;
  /** Aim point scratch for the cluster scorer. Written, never retained. */
  private readonly aimOut = new Float64Array(2);

  /* -- budget and diagnostics -------------------------------------------- */
  private budget = 0;
  private commandsIssued = 0;
  private blocked = '';
  /** First refusal seen during the current build pass. See `noteUnavailable`. */
  private unavailableReason = '';
  private buildGoal = 'booting';
  private militaryGoal = 'booting';

  /* -- scratch (allocated once) ------------------------------------------ */
  private readonly candidates: CatalogEntry[] = [];
  private readonly scoreScratch = new Float32Array(64);
  private readonly cellOut = new Int32Array(2);
  private readonly oreOut = new Int32Array(2);
  private readonly orderScratch = new Int32Array(AI_ROSTER_CAP);
  private readonly haveRoleFn: (role: BuildRole) => boolean;
  /** `consider()` state, held as fields so scoring allocates no closures. */
  private bestEntry: CatalogEntry | null = null;
  private bestScore = 0;
  private bestGoal = '';
  private spendable = 0;

  constructor(
    world: World,
    commands: CommandBus,
    catalog: BuildCatalog,
    player: PlayerId,
    seed: number,
  ) {
    this.world = world;
    this.store = world.store;
    this.commands = commands;
    this.catalog = catalog;
    this.player = player;

    const p = world.player(player);
    this.faction = p === undefined ? Faction.Neutral : p.faction;
    this.diff = difficultyProfile(p === undefined ? 1 : p.aiDifficulty);
    this.pers = personalityProfile(p === undefined ? 0 : p.aiPersonality);
    // Every brain in a match draws from its own stream, so adding a second AI
    // cannot change the first one's decisions.
    this.rng = new Rng(hash2i(seed, (player as number) + 1));
    this.phaseOffset = (player as number) * 7;
    this.groupTag = new PerEntityU32(world.store, GROUP_NONE);
    this.opening = openingFor(this.faction, this.pers.index);
    this.nextScoutTick = Math.round(AI_SCOUT.firstScoutTick * this.diff.scoutDelayMul);
    // Aggression DIVIDES both gates: a low-aggression brain waits longer for
    // its first push and longer between pushes. `Math.max(0.1, ...)` guards a
    // hand-authored 0 in the table from producing an Infinity gate, which would
    // read as an AI that builds an economy and then never does anything.
    const agg = Math.max(0.1, this.diff.aggression);
    this.offensiveUnlockTick = Math.round((AI_MILITARY.firstStrikeSeconds * SIM_HZ) / agg);
    this.rearmTicks = Math.round((AI_MILITARY.rearmSeconds * SIM_HZ) / agg);
    this.haveRoleFn = (role: BuildRole) => this.roleCount[role] > 0;
    // Both plans are pure functions of the faction, so they are resolved once
    // here rather than per build pass. They are lists of KEYS, not entries: the
    // catalog is re-bound underneath us when production lands, and an entry
    // captured at construction would be the pre-binding one with defId -1.
    this.superPlan = superweaponPlanFor(this.faction);
    this.upgradePlan = upgradePlanFor(this.faction);
  }

  /** Attach the production module's rule engine. Safe to call at any time. */
  setOracle(oracle: ProductionOracle | null): void {
    this.oracle = oracle;
  }

  /* ======================================================================
   * 2.1 EVENT SUBSCRIPTIONS
   *
   * Handlers RECORD, they never issue. That keeps the "Phase.AI may only call
   * commandBus.issue()" rule literally true: an event fires during whatever
   * phase produced it, and acting from there would let the AI order units from
   * inside Phase.Damage.
   * ====================================================================== */

  attach(events: EventBus): () => void {
    const me = this.player as number;
    const offs: (() => void)[] = [];

    offs.push(events.on('combat:underAttack', (e) => {
      if ((e.player as number) !== me) return;
      // A structure being hit is a base attack; a unit being hit in the field
      // is just the war happening.
      this.basePressure += e.isBuilding ? 1.0 : 0.25;
      if (e.isBuilding || this.attackX < 0) {
        this.attackX = e.x;
        this.attackZ = e.z;
        this.attackObservedTick = this.world.tick;
      }
    }));

    offs.push(events.on('entity:damaged', (e) => {
      if ((e.player as number) !== me) return;
      this.lastDamageTick = this.world.tick;
    }));

    offs.push(events.on('production:started', (e) => {
      if ((e.player as number) !== me) return;
      const t = e.tab as number;
      if (t >= 0 && t < BUILD_TAB_COUNT && this.inFlight[t] > 0) this.inFlight[t]--;
    }));

    offs.push(events.on('production:cancelled', (e) => {
      if ((e.player as number) !== me) return;
      const t = e.tab as number;
      if (t >= 0 && t < BUILD_TAB_COUNT && this.inFlight[t] > 0) this.inFlight[t]--;
    }));

    offs.push(events.on('production:ready', (e) => {
      if ((e.player as number) !== me || !e.isBuilding) return;
      if (this.pendingPlaceCount >= this.pendingPlaceDef.length) return;
      // Duplicate readies for the same def are legal (two of them queued); each
      // needs its own placement, so there is deliberately no dedupe here.
      this.pendingPlaceDef[this.pendingPlaceCount++] = e.defId;
    }));

    offs.push(events.on('building:completed', (e) => {
      if ((e.player as number) !== me) return;
      this.consumePendingPlacement(e.defId);
    }));

    return () => { for (let i = 0; i < offs.length; i++) offs[i](); };
  }

  /** Drop the first pending placement matching `defId`. */
  private consumePendingPlacement(defId: number): void {
    let hit = -1;
    for (let i = 0; i < this.pendingPlaceCount; i++) {
      if (this.pendingPlaceDef[i] === defId) { hit = i; break; }
    }
    if (hit < 0) return;
    for (let i = hit; i < this.pendingPlaceCount - 1; i++) {
      this.pendingPlaceDef[i] = this.pendingPlaceDef[i + 1];
    }
    this.pendingPlaceCount--;
  }

  /* ======================================================================
   * 2.2 THE TICK
   * ====================================================================== */

  tick(s: SimContext): void {
    const p = this.world.player(this.player);
    if (p === undefined || p.defeated) {
      this.posture = AiPosture.Defeated;
      this.militaryGoal = 'eliminated';
      return;
    }

    // Actions accrue at apmCap/minute and bank up to a small burst, so a brain
    // that had nothing to do for ten seconds can still answer a raid promptly
    // without ever exceeding its documented action rate on average.
    this.budget = Math.min(ACTION_BURST_CAP, this.budget + this.diff.actionsPerTick);

    const t = s.tick + this.phaseOffset;
    if (t % AI_CADENCE.census === 0) {
      this.census();
      this.observe(s);
    }
    // The economy layer runs one tick before the build layer: build decisions
    // consume `wantHarvesters` / `powerUrgent`, and a stale power reading is
    // exactly how an AI blacks itself out.
    if (t % AI_CADENCE.economy === 1) this.economy(s, p);
    // Deployment runs BETWEEN economy and build, on the build clock. Economy is
    // what discovers `expandX` (the ore field a second yard would be for), and
    // build is what needs the yard this layer produces — so it belongs exactly
    // here, and nowhere else.
    if (t % AI_CADENCE.build === 2) {
      this.deploy(s);
      this.build(s, p);
    }
    if (t % AI_CADENCE.squad === 3) this.squad(s);
    if (t % AI_CADENCE.scout === 4) this.scout(s);
    // The navy, on the squad clock one slot after the squad layer. It reads
    // `strikeIds` and `objectiveX` — both written by `squad` — so running it
    // first would stage a landing against the last tick's objective and pull
    // its squad out of a strike group that has not been rebuilt yet.
    if (t % AI_CADENCE.squad === 5) this.navy(s);
    // On the squad clock, one slot later: the commander's ability is a combat
    // decision and wants the squad layer's fresh picture of who is near what.
    if (t % AI_CADENCE.squad === 4) this.commanderAbility(s);
    // THE LATE LAYER, on the build clock and deliberately in a far slot.
    //
    // 2 Hz is generous for verbs whose cooldowns are 120-420 SECONDS, and the
    // slot is 8 rather than 5 or 6 purely to keep it off the ticks the economy
    // (1), deploy+build (2) and squad (3) layers already run on — the whole
    // point of the phase offsets is that no single tick does two layers' work
    // for eight brains at once. It runs LAST of the five for the same reason
    // `commanderAbility` runs after `squad`: firing a superweapon at the strike
    // group's position wants this tick's census, not the last one's.
    if (t % AI_CADENCE.build === 8) this.lateGame(s, p);
  }

  /* ======================================================================
   * 2.2b THE COMMANDER'S ABILITY
   * ====================================================================== */

  /**
   * Fire the hero's faction ability when it is worth firing.
   *
   * THROUGH `channels.command`, as an ordinary `OrderKind.UseAbility` — the
   * same command the HUD button issues. That is the project's standing rule
   * ("the AI issues the same commands the player does") and here it also buys
   * something concrete: every refusal — no ability, still cooling, dead this
   * tick — is decided once, in `src/sim/Abilities.ts`, so the AI cannot fire
   * something the player could not.
   *
   * The trigger is deliberately crude, because a commander ability is a
   * once-a-minute button and a clever heuristic would be untestable:
   *
   *   PrismFocus / ChronoRally / SalvageCall  fire when at least
   *     `ABILITY_MIN_ENEMIES` hostiles stand inside the radius. Offence, a
   *     regroup under contact, and a battlefield harvest all want the same
   *     answer to "is there a fight here".
   *
   *   IronWill  fires on the same condition, which is correct rather than lazy:
   *     five seconds of invulnerability is worth nothing in an empty field and
   *     everything the moment somebody is shooting.
   *
   * No cooldown bookkeeping here at all. The service already refuses a hero
   * that is cooling, and a second copy of that clock in the AI is how the two
   * would drift apart.
   */
  private commanderAbility(s: SimContext): void {
    // The SERVICE is the oracle, not a def table of our own. It already knows
    // which unit carries what and whether the cooldown has run, and a second
    // copy of either fact in here is how the two would drift apart. Null on a
    // boot with no content module, where there are no commanders anyway.
    const svc = abilities();
    if (svc === null) return;
    if (s.tick - this.abilityIssuedTick < AI_MILITARY.reissueTicks) return;

    const st = this.store;
    const me = this.player as number;
    const n = st.byKindCount[EntityKind.Infantry];
    const list = st.byKind[EntityKind.Infantry];
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if (st.owner[i] !== me) continue;
      const f = st.flags[i];
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;

      const id = st.handleOf(i);
      const ability = svc.abilityOf(id);
      if (ability === AbilityId.None) continue;
      if (!svc.isReady(id)) continue;

      const spec = ABILITIES[ability];
      // `false` — NOT vision-gated, and deliberately so. The radius here is the
      // hero's own bubble: anything inside it is standing next to a unit of
      // ours that provides vision, so the gate would be a no-op that cost a
      // `canSee` call per candidate. Every REMOTE decision in this file passes
      // `true`, because aiming across the map at something the AI has not
      // looked at is exactly the cheat this class does not get to have.
      if (this.hostilesWithin(st.posX[i], st.posZ[i], spec.radius, false) < ABILITY_MIN_ENEMIES) {
        continue;
      }

      if (this.issueOrder(
        OrderKind.UseAbility, this.one(id), 1, st.posX[i], st.posZ[i], NONE,
      )) {
        this.abilityIssuedTick = s.tick;
      }
      return;
    }
  }

  /**
   * Living hostiles inside a circle. Counts structures — a base is a target.
   *
   * `visibleOnly` is THE VISION DISCIPLINE, expressed as an argument because
   * the two callers genuinely differ. A commander ability fires on a circle
   * centred on our own hero, where every hostile is by construction inside a
   * friendly sight radius; a superweapon or an airstrike is aimed at a point
   * across the map, and counting what is standing there without asking
   * `canSee` first would be the AI knowing something it never looked at. There
   * is no default: a caller has to say which of those it is.
   */
  private hostilesWithin(x: number, z: number, radius: number, visibleOnly: boolean): number {
    const st = this.store;
    const buf = this.world.queryScratchB;
    const found = this.world.spatial.queryCircleFat(x, z, radius, buf);
    let hostile = 0;
    for (let k = 0; k < found; k++) {
      const e = buf[k];
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.NotATarget)) !== 0) continue;
      const kind = st.kind[e];
      if (kind === EntityKind.Wreck || kind === EntityKind.Prop || kind === EntityKind.Crate) {
        continue;
      }
      if (this.world.areAllied(this.player, st.owner[e] as PlayerId)) continue;
      if (visibleOnly && !this.world.vision.canSee(this.player, st.handleOf(e))) continue;
      hostile++;
    }
    return hostile;
  }

  /**
   * Our own wounded inside a circle. No vision gate — these are ours.
   *
   * Structures count, because Emergency Repair is the only mend in the game
   * that reaches a building without an engineer walking to it, and a base under
   * a siege line is the moment it exists for.
   */
  private damagedWithin(x: number, z: number, radius: number): number {
    const st = this.store;
    const buf = this.world.queryScratchB;
    const found = this.world.spatial.queryCircleFat(x, z, radius, buf);
    const me = this.player as number;
    let hurt = 0;
    for (let k = 0; k < found; k++) {
      const e = buf[k];
      if (st.owner[e] !== me) continue;
      const f = st.flags[e];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
      const kind = st.kind[e];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle
        && kind !== EntityKind.Building) continue;
      const max = st.maxHp[e];
      if (max <= 0 || st.hp[e] >= max * 0.9) continue;
      hurt++;
    }
    return hurt;
  }

  /* ======================================================================
   * 2.2c THE LATE GAME — superweapons and commander powers
   *
   * Both halves issue ordinary commands and nothing else, and both are gated on
   * the difficulty ladder before anything else is computed, so an Easy brain
   * pays none of the cost of either.
   * ====================================================================== */

  private lateGame(s: SimContext, p: PlayerState): void {
    if (this.posture === AiPosture.Defeated) return;
    // `lateGoal` is DELIBERATELY NOT CLEARED HERE. It used to be, and that made
    // it useless: this layer does nothing on the overwhelming majority of its
    // passes, so the probe read an empty string at every sampling point of a
    // twenty-minute match in which the AI had in fact fired a nuke. It holds
    // the last thing the late layer actually DID, which is the same contract
    // `militaryGoal` and `buildGoal` keep.
    // The superweapon first: it is the more decisive of the two and they draw
    // on the same action budget, so on a tick where both want to fire the
    // 2500-credit button wins over the one that only cost a clock.
    if (this.fireSuperweapon(s)) return;
    this.callPower(s, p);
  }

  /**
   * Fire whichever superweapon is charged, at whatever is worth it.
   *
   * THROUGH THE BUS, as `OrderKind.UseAbility` addressed to the gating
   * STRUCTURE — byte for byte the command `SuperweaponService.issueFire` builds
   * for the human's reticle, read back by `consumeOrders` at Phase.Production.
   * The AI does not call `fireAt`, does not touch a charge, and cannot fire
   * something the player could not: readiness, power, ownership and faction are
   * all answered by `isReady`, which is the same call the HUD countdown asks.
   *
   * It issues the order itself rather than calling `issueFire`, for one reason:
   * `issueFire` writes straight to `channels.commands` and would therefore
   * bypass `spend()` — the APM budget that is the difficulty ladder's honest
   * axis and the thing `tests/ai.spec.ts` holds to 22 commands per 20 seconds
   * on Easy. Every command this class emits is counted, including this one.
   *
   * THE BACK-OFF IS NOT AN OPTIMISATION. A charged weapon with nothing worth
   * hitting would otherwise re-run its target scan twice a second for the rest
   * of the match. Ten seconds between looks is nothing against a 300-420 second
   * charge and turns an O(remembered²) scan into a rounding error.
   */
  private fireSuperweapon(s: SimContext): boolean {
    if (this.diff.maxSuperweapons <= 0) return false;
    const svc = superweapons();
    if (svc === null) return false;
    if (s.tick - this.superBackoffTick < AI_SUPERWEAPON.retargetBackoffTicks) return false;

    for (let w = 0; w < SUPERWEAPONS.length; w++) {
      const def = SUPERWEAPONS[w];
      if (!svc.isReady(this.player, def.key)) continue;
      const structure = svc.structureFor(this.player, def.key);
      if (structure === NONE) continue;
      if (this.aimSuperweapon(s, def, structure)) {
        this.superweaponsFired++;
        return true;
      }
    }
    // Nothing was worth a strike this pass — including the case where nothing
    // was charged at all, which is the overwhelmingly common one and the reason
    // the back-off is set here rather than only on a failed aim.
    this.superBackoffTick = s.tick;
    return false;
  }

  /**
   * Point one superweapon at something and pull the trigger. False when there
   * is nothing worth spending it on.
   *
   * Dispatch is on `def.effect`, never on `def.id` — the Solar Lance runs the
   * nuke's effect and the Arc Storm runs the storm's, and reading the id here
   * would leave both later armies unable to fire the button they built.
   */
  private aimSuperweapon(s: SimContext, def: SuperweaponDef, structure: EntityId): boolean {
    switch (def.effect) {
      case SuperweaponId.Nuke: return this.aimAnnihilation(def, structure);
      case SuperweaponId.LightningStorm: return this.aimStorm(def, structure);
      case SuperweaponId.IronCurtain: return this.aimCurtain(def, structure);
      case SuperweaponId.Chronosphere: return this.aimChrono(s, def, structure);
      default: return false;
    }
  }

  /**
   * NUKE / SOLAR LANCE — one warned, annihilating blast on the densest knot of
   * enemy VALUE the AI can remember.
   *
   * Aimed with `bestCluster`, which is a different priority from
   * `pickObjective` on purpose and the difference is the whole point of owning
   * one. A strike group has to fight through the defences to reach anything, so
   * `pickObjective` values a tesla coil at 3.0 — the highest number on its
   * list. A missile flies over the coil. What a 1400-damage blast is worth is
   * measured in what the enemy cannot replace quickly: refineries, factories
   * and the yard that rebuilds them. So `strikeValue` inverts the defence entry
   * almost exactly, and a nuke lands on the economy.
   */
  private aimAnnihilation(def: SuperweaponDef, structure: EntityId): boolean {
    if (!this.bestCluster(def.radius, this.aimOut)) return false;
    this.lateGoal =
      `nuclear strike at ${this.aimOut[0].toFixed(0)},${this.aimOut[1].toFixed(0)}`;
    return this.issueOrder(
      OrderKind.UseAbility, this.one(structure), 1, this.aimOut[0], this.aimOut[1], structure,
    );
  }

  /**
   * LIGHTNING STORM / ARC STORM — nine seconds of scattered Tesla bolts.
   *
   * MASSED ARMY FIRST, base second, and that ordering is the warhead's rather
   * than a preference. `WarheadClass.Tesla` is the armour matrix's best answer
   * to flesh and its worst to concrete, so twenty-one bolts into a stack of
   * infantry and light vehicles is worth several times the same twenty-one into
   * a refinery. The hottest bucket of the threat grid is where that stack is,
   * and the grid is built entirely from what the AI has SEEN and decays when it
   * stops looking — so aiming at it cannot become a cheat.
   *
   * The fallback to a structure cluster is not a consolation prize: a charged
   * storm held for a field battle that never comes is a storm wasted, and nine
   * seconds over a factory still removes a factory.
   */
  private aimStorm(def: SuperweaponDef, structure: EntityId): boolean {
    let ok = this.hottestThreat(this.aimOut) >= AI_SUPERWEAPON.stormMinThreat;
    if (ok) {
      this.lateGoal = `storm on massed enemy at ${this.aimOut[0].toFixed(0)},${this.aimOut[1].toFixed(0)}`;
    } else if (this.bestCluster(def.radius, this.aimOut)) {
      ok = true;
      this.lateGoal = `storm on the enemy base at ${this.aimOut[0].toFixed(0)},${this.aimOut[1].toFixed(0)}`;
    }
    if (!ok) return false;
    return this.issueOrder(
      OrderKind.UseAbility, this.one(structure), 1, this.aimOut[0], this.aimOut[1], structure,
    );
  }

  /**
   * IRON CURTAIN — twenty seconds of true invulnerability, on the strike group.
   *
   * The one superweapon aimed at our OWN units, which makes it the one with no
   * vision question and the one with a genuine timing problem: it is worth
   * nothing in an empty field and everything the instant somebody is shooting.
   * So the trigger is contact — hostiles inside twice the curtain's radius —
   * measured around the strike group's centre.
   *
   * TWICE the radius, not once. The curtain protects 13 m; a tank shoots from
   * further away than it stands, so the fight that justifies spending it is
   * bigger than the circle it covers. Requiring the enemy to already be inside
   * the protection radius would mean firing it after the trade rather than
   * before.
   *
   * `strikeCount` has a floor of its own because `groupCentre` falls back to the
   * base when the group is empty — without it a dead wave would curtain an
   * empty rally point.
   */
  private aimCurtain(def: SuperweaponDef, structure: EntityId): boolean {
    if (this.strikeCount < AI_SUPERWEAPON.curtainMinEnemies) return false;
    const cx = this.groupCentre(true);
    const cz = this.groupCentre(false);
    if (this.hostilesWithin(cx, cz, def.radius * 2, true) < AI_SUPERWEAPON.curtainMinEnemies) {
      return false;
    }
    this.lateGoal = `iron curtain over ${this.strikeCount} in contact`;
    return this.issueOrder(OrderKind.UseAbility, this.one(structure), 1, cx, cz, structure);
  }

  /**
   * CHRONOSPHERE — lift the committed wave onto the objective.
   *
   * THE ONLY TWO-COMMAND VERB THE AI HAS. `targetMode` is `pointPair`, and
   * `consumeOrders` reads the order's TARGET as the stage flag: `NONE` means
   * "this is the source", the structure's own id means "commit". So the brain
   * spends two late-layer ticks — half a second apart — exactly as a human
   * spends two clicks, and `stagedSw` in the service holds the source in
   * between. Nothing here alternates on its own state; the flag rides on the
   * command, which is what makes it replayable.
   *
   * WHAT IT IS FOR: skipping a walk, not winning a fight. Nine tanks set down
   * beside a refinery is a wave that arrives before the defender can answer it;
   * nine tanks teleported into a fight they were already losing is nine tanks
   * lost slightly sooner. So it fires only while `Attacking`, only with a real
   * group, and only when there is `chronoMinTravel` of ground left to cover —
   * below that the walk was nearly free and the charge is better banked.
   *
   * They land SHORT of the objective by `chronoDropStandoff`, backed off along
   * the line the group was coming from. Dropping them exactly on the target
   * spirals nine hulls into whatever is already standing there; landing beside
   * it lets them arrive as a formation and shoot.
   *
   * ONE COST, WRITTEN DOWN: `applyChrono` clears every order it moves and sets
   * the unit Idle, so the wave stands still until `pressAttack` re-issues on
   * its own clock — at most `AI_MILITARY.reissueTicks`, a second and a half.
   * That is cheap against the twenty seconds of walking it just saved, but it
   * is not free and it is why this is not fired at a group already in contact.
   */
  private aimChrono(s: SimContext, def: SuperweaponDef, structure: EntityId): boolean {
    if (this.posture !== AiPosture.Attacking) return false;
    if (this.strikeCount < AI_SUPERWEAPON.chronoMinStrike) return false;
    if (this.objectiveX < 0) return false;

    const cx = this.groupCentre(true);
    const cz = this.groupCentre(false);
    const travel = dist2(cx, cz, this.objectiveX, this.objectiveZ);
    if (travel < AI_SUPERWEAPON.chronoMinTravel) return false;

    const staleTick = this.chronoStagedTick <= -1e8
      || s.tick - this.chronoStagedTick > AI_SUPERWEAPON.chronoCommitTicks;
    if (staleTick) {
      // The SOURCE. Target `NONE` is the stage flag.
      if (!this.issueOrder(OrderKind.UseAbility, this.one(structure), 1, cx, cz, NONE)) {
        return false;
      }
      this.chronoStagedTick = s.tick;
      this.lateGoal = 'chronosphere: marking the wave';
      // Deliberately NOT counted as a fire and NOT returned as one — no charge
      // has been spent yet and the layer must come back next tick to commit.
      return false;
    }

    const back = Math.min(AI_SUPERWEAPON.chronoDropStandoff, travel * 0.5);
    const dx = (cx - this.objectiveX) / travel;
    const dz = (cz - this.objectiveZ) / travel;
    const dropX = clamp(this.objectiveX + dx * back, CELL, MAP_SIZE - CELL);
    const dropZ = clamp(this.objectiveZ + dz * back, CELL, MAP_SIZE - CELL);
    if (!this.issueOrder(
      OrderKind.UseAbility, this.one(structure), 1, dropX, dropZ, structure,
    )) {
      return false;
    }
    this.chronoStagedTick = -1e9;
    this.lateGoal = `chronoshift of ${this.strikeCount} onto the objective`;
    return true;
  }

  /**
   * The point that puts the most enemy VALUE inside `radius`.
   *
   * Reads `memX/memZ/memRole` and nothing else, which is what makes it honest:
   * that table is populated only by `observe`, only through `vision.canSee`,
   * and is emptied by `forgetUnseen` when the AI looks and finds nothing there.
   * A superweapon therefore lands on a base the AI has actually scouted, and an
   * enemy who never let a scout through never gets nuked.
   *
   * O(remembered²) with `AI_MEMORY.structureSlots` at 96, so 9216 distance
   * tests worst case — run only while a weapon is charged and at most once per
   * `retargetBackoffTicks`.
   */
  private bestCluster(radius: number, out: Float64Array): boolean {
    if (this.memCount === 0) return false;
    const r2 = radius * radius;
    const standoff = AI_SUPERWEAPON.friendlyStandoff;
    let bestScore = 0;
    let bestX = -1;
    let bestZ = -1;

    for (let a = 0; a < this.memCount; a++) {
      const cx = this.memX[a];
      const cz = this.memZ[a];
      // A blast is an `attacker: NONE` splash record — it hits ours too. Every
      // candidate here is a remembered ENEMY structure so this should never
      // bind; it binds the day somebody builds inside our base, which is
      // exactly the day nobody would be watching for it.
      if (dist2(cx, cz, this.baseX, this.baseZ) < standoff) continue;
      let score = 0;
      for (let b = 0; b < this.memCount; b++) {
        if (distSq2(cx, cz, this.memX[b], this.memZ[b]) > r2) continue;
        score += strikeValue(this.memRole[b] as BuildRole);
      }
      if (score > bestScore) { bestScore = score; bestX = cx; bestZ = cz; }
    }

    if (bestX < 0) return false;
    out[0] = bestX;
    out[1] = bestZ;
    return true;
  }

  /** Hottest mobile-threat bucket, and its weight. 0 when there is nothing. */
  private hottestThreat(out: Float64Array): number {
    let hot = -1;
    let hotV = 0;
    for (let c = 0; c < THREAT_CELLS; c++) {
      if (this.threatGrid[c] > hotV) { hotV = this.threatGrid[c]; hot = c; }
    }
    if (hot < 0) return 0;
    const x = ((hot % THREAT_DIM) + 0.5) * THREAT_BUCKET_METRES;
    const z = (Math.floor(hot / THREAT_DIM) + 0.5) * THREAT_BUCKET_METRES;
    if (dist2(x, z, this.baseX, this.baseZ) < AI_SUPERWEAPON.friendlyStandoff) return 0;
    out[0] = x;
    out[1] = z;
    return hotV;
  }

  /**
   * Call a commander power, at most one per pass.
   *
   * ORDER IS URGENCY, not value. Repair and the airstrike answer something that
   * is happening now and stop being worth anything a few seconds later; the ore
   * boost and the scan are worth the same amount whenever they are called, so
   * they queue behind. Charges are 120-240 seconds against a 2 Hz layer, so two
   * powers wanting the same pass is rare — but when it happens the reactive one
   * has to win or it may as well not exist.
   *
   * `powerMask` is the ladder and it is checked first in every branch, so a
   * Normal brain never even measures whether an airstrike would land.
   */
  private callPower(s: SimContext, p: PlayerState): boolean {
    if (this.diff.powerMask === 0) return false;
    const svc = commanderPowers();
    if (svc === null) return false;
    void s;
    // The scan sits AHEAD of the ore boost, which looks like the wrong way
    // round for a "most urgent first" list until you read what gates it: it
    // fires only while the AI does not know where the enemy lives, and not
    // knowing that stalls the entire military layer — `pickObjective` is
    // guessing, the strike group is walking at a mirrored start position, and
    // every wave until it is answered is thrown at a coordinate. Free money can
    // wait a pass; being lost cannot. It is also self-limiting in a way the ore
    // boost is not: the moment one enemy structure is remembered this branch
    // stops firing for the rest of the match.
    return this.tryRepair(svc)
      || this.tryAirstrike(svc)
      || this.tryChronoshift(svc)
      || this.tryScan(svc)
      || this.tryOreBoost(svc, p);
  }

  /**
   * May this difficulty call this power, has it been BOUGHT, and has its charge
   * run?
   *
   * Three conditions, two of them here. The purchase is inside `svc.isReady`
   * since v2.6.0, which is deliberate rather than an omission: the human's HUD
   * asks the same method, so a brain and a sidebar cannot disagree about what
   * "ready" means. The mask stays first so a Normal brain never even measures
   * whether an airstrike would land.
   */
  private powerReady(svc: CommanderPowerReader, power: CommanderPowerId): boolean {
    if ((this.diff.powerMask & (1 << (power as number))) === 0) return false;
    return svc.isReady(this.player, power as number);
  }

  /**
   * EMERGENCY REPAIR — 45% of maxHp back on up to 24 things under the marker.
   *
   * Aimed at `attackX/attackZ`, the point the `combat:underAttack` handler
   * recorded, because a base under a siege line is the only moment this beats
   * banking the charge. Gated on real damage rather than on pressure alone:
   * pressure is a decaying memory and can still be high after the raid has
   * been cleared, at which point there is nothing left to mend.
   */
  private tryRepair(svc: CommanderPowerReader): boolean {
    const id = CommanderPowerId.EmergencyRepair;
    if (!this.powerReady(svc, id)) return false;
    if (this.basePressure < AI_POWER.repairMinPressure) return false;
    if (this.attackX < 0) return false;
    const radius = COMMANDER_POWERS[id].radius;
    const hurt = this.damagedWithin(this.attackX, this.attackZ, radius);
    if (hurt < AI_POWER.repairMinDamaged) return false;
    this.lateGoal = `emergency repair on ${hurt} damaged`;
    return this.issuePower(id, this.attackX, this.attackZ);
  }

  /**
   * AIRSTRIKE — one bombing run, on the biggest knot of enemies the AI can see.
   *
   * The threat grid picks the region and `hostilesWithin(..., true)` confirms
   * it: the grid is a decaying memory and can still be warm over ground the
   * enemy left a minute ago, so the count is re-taken live and VISION-GATED
   * before the charge is spent. `friendlyStandoff` inside `hottestThreat` keeps
   * it off our own base — the strike friendly-fires, which is correct for a
   * bombing run and is why aiming it is a decision rather than a formality.
   */
  private tryAirstrike(svc: CommanderPowerReader): boolean {
    const id = CommanderPowerId.Airstrike;
    if (!this.powerReady(svc, id)) return false;
    if (this.hottestThreat(this.aimOut) <= 0) return false;
    const radius = COMMANDER_POWERS[id].radius;
    const enemies = this.hostilesWithin(this.aimOut[0], this.aimOut[1], radius, true);
    if (enemies < AI_POWER.airstrikeMinEnemies) return false;
    this.lateGoal = `airstrike on ${enemies} at ${this.aimOut[0].toFixed(0)},${this.aimOut[1].toFixed(0)}`;
    return this.issuePower(id, this.aimOut[0], this.aimOut[1]);
  }

  /**
   * CHRONOSHIFT — lift the home guard onto the objective as a second wave.
   *
   * This power lifts from the caster's OWN base centroid, so what it actually
   * spends is the reserve — the units `regroupSquads` holds back precisely so
   * the base is not empty. That makes the pressure gate the important one:
   * stripping the home guard while something is already hitting the base trades
   * a won attack for a lost base, which is the single worst thing an RTS AI can
   * be caught doing.
   */
  private tryChronoshift(svc: CommanderPowerReader): boolean {
    const id = CommanderPowerId.Chronoshift;
    if (!this.powerReady(svc, id)) return false;
    if (this.posture !== AiPosture.Attacking) return false;
    if (this.basePressure > AI_POWER.chronoshiftMaxPressure) return false;
    if (this.reserveCount < AI_POWER.chronoshiftMinReserve) return false;
    if (this.objectiveX < 0) return false;
    this.lateGoal = `chronoshifting ${this.reserveCount} of the home guard forward`;
    return this.issuePower(id, this.objectiveX, this.objectiveZ);
  }

  /**
   * ORE BOOST — 2500 credits, immediately.
   *
   * The only power with no aim; `(x, z)` is accepted and ignored by the effect,
   * so it carries the base and the command shape stays identical to the other
   * four. The one way to waste it is to call it into a full bank —
   * `Economy.grant` clamps at `storageMax` — so it waits for the bank to be
   * under half. That also means it lands when the AI has something to spend it
   * on, which is when 2500 credits is worth the most.
   */
  private tryOreBoost(svc: CommanderPowerReader, p: PlayerState): boolean {
    const id = CommanderPowerId.OreBoost;
    if (!this.powerReady(svc, id)) return false;
    if (p.storageMax > 0 && p.credits > p.storageMax * AI_POWER.oreBoostFillFraction) return false;
    this.lateGoal = 'ore boost';
    return this.issuePower(id, this.baseX, this.baseZ);
  }

  /**
   * ORBITAL SCAN — chart a 90 m circle, permanently.
   *
   * ONLY WHILE THE AI IS LOST. `exploreCircle` marks cells EXPLORED and not
   * visible, so it hands over terrain and static structures and no live units —
   * which is exactly the gap the scouting layer is trying to close on foot. Once
   * `memCount` is non-zero the enemy base is on the map and a second circle buys
   * nothing, so the charge is better held.
   *
   * It is aimed at the mirrored start position, which is the same first guess
   * `buildScoutRoute` makes and is right more often than any other single point
   * on an RTS map.
   */
  private tryScan(svc: CommanderPowerReader): boolean {
    const id = CommanderPowerId.OrbitalScan;
    if (!this.powerReady(svc, id)) return false;
    if (this.memCount > 0 || this.enemyBaseX >= 0) return false;
    const x = clamp(MAP_SIZE - this.baseX, CELL, MAP_SIZE - CELL);
    const z = clamp(MAP_SIZE - this.baseZ, CELL, MAP_SIZE - CELL);
    this.lateGoal = 'orbital scan of the far start position';
    return this.issuePower(id, x, z);
  }

  /**
   * Put a `CommandKind.UsePower` on the bus. The AI's only route to a power,
   * and the same one `__vmPowers.fire` and a HUD button take.
   *
   * Through `spend()` like everything else in this class: a power costs no
   * credits, but it costs an ACTION, and a difficulty rung that got its powers
   * for free would be spending an APM it does not have.
   */
  private issuePower(power: CommanderPowerId, x: number, z: number): boolean {
    if (!this.spend()) return false;
    this.commands.issueUsePower(this.player, power as number, x, z);
    this.powersCalled++;
    return true;
  }

  /* ======================================================================
   * 2.3 CENSUS — what do I own
   * ====================================================================== */

  private census(): void {
    const st = this.store;
    const me = this.player as number;

    this.armyCount = 0;
    this.harvesterCount = 0;
    this.mcvCount = 0;
    this.transportCount = 0;
    this.warshipCount = 0;
    this.infantryCount = 0;
    this.vehicleCount = 0;
    this.superOwnedMask = 0;
    this.roleCount.fill(0);
    this.roleBuilding.fill(0);
    this.builderId = NONE;

    let sumX = 0;
    let sumZ = 0;
    let structures = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== me) continue;
      const f = st.flags[i];
      // GARRISONED IS A CENSUS REJECT, not just an order-time one.
      //
      // `ORDERABLE_REJECT` has carried this bit since it was written, so a man
      // riding in a transport or holding a building is skipped by `moveGroup`
      // and `gatherIdle` — but he was still counted into `armyCount` here, and
      // `armyCount` is what `waveThreshold` and `regroupSquads` divide up. The
      // result is an AI that reaches its attack threshold on bodies it
      // physically cannot send, then masses forever waiting for a strike group
      // that is permanently N units short. Reachable today through
      // `GarrisonService` alone; the three passenger-carrying hulls that landed
      // in v2.2.0 (Hover Transport, Sandskiff, Slag Scow) are a second road to
      // the same place. Counted force must mean orderable force.
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      const kind = st.kind[i];

      if (kind === EntityKind.Building) {
        const role = this.roleOfBuilding(i);
        // Before the under-construction fork, so a silo still going up already
        // stops the AI ordering a second one on top of it.
        if (role === BuildRole.Superweapon) this.noteSuperweapon(st.defId[i]);
        if ((f & EntityFlag.UnderConstruction) !== 0) {
          this.roleBuilding[role]++;
          continue;
        }
        this.roleCount[role]++;
        sumX += st.posX[i]; sumZ += st.posZ[i]; structures++;
        if (role === BuildRole.Builder && this.builderId === NONE) {
          this.builderId = st.handleOf(i);
          this.builderX = st.posX[i];
          this.builderZ = st.posZ[i];
        }
        continue;
      }

      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;

      // THE UPGRADE AUDIENCE, counted before the army/harvester fork on
      // purpose. `PlayerState.upgradeMul` is indexed by `EntityKind`, so a
      // vehicle-scope multiplier covers harvesters and construction vehicles
      // exactly as it covers tanks — Composite Armour really does put 18% of
      // the damage off a 1400-credit truck. Counting only the fighting half
      // would undersell every vehicle upgrade in the game by a third.
      if (kind === EntityKind.Infantry) this.infantryCount++;
      else this.vehicleCount++;

      if ((f & EntityFlag.IsHarvester) !== 0) {
        if (this.harvesterCount < this.harvesterIds.length) {
          this.harvesterIds[this.harvesterCount++] = st.handleOf(i) as number;
        }
        continue;
      }

      // THE FLOATING CENSUS, and it runs BEFORE the `CanAttack` fork because a
      // warship carries that flag. Everything that floats goes into its own
      // list and NEVER into `armyIds`: `armyIds` is what `regroupSquads` files
      // into the strike group and what `pressAttack` walks at a land objective,
      // so one destroyer in it is a destroyer ordered to march on the enemy
      // base — and a body counted toward `waveThreshold` that can never
      // arrive. Same failure the Garrisoned mask above exists to stop, reached
      // by a different route.
      const naval = this.navalRoleOfUnit(i, kind, f);
      if (naval === BuildRole.Transport) {
        if (this.transportCount < this.transportIds.length) {
          this.transportIds[this.transportCount++] = st.handleOf(i) as number;
        }
        continue;
      }
      if (naval === BuildRole.Warship) {
        if (this.warshipCount < this.warshipIds.length) {
          this.warshipIds[this.warshipCount++] = st.handleOf(i) as number;
        }
        continue;
      }

      // An unarmed non-harvester (engineer, MCV) is not army; it must never be
      // counted toward a wave threshold or the AI attacks with a truck.
      if ((f & EntityFlag.CanAttack) === 0) {
        if (this.isUndeployedMcv(i, kind, f) && this.mcvCount < this.mcvIds.length) {
          this.mcvIds[this.mcvCount++] = st.handleOf(i) as number;
        }
        continue;
      }
      if (this.armyCount < AI_ROSTER_CAP) {
        this.armyIds[this.armyCount++] = st.handleOf(i) as number;
      }
    }

    if (structures > 0) {
      this.baseX = sumX / structures;
      this.baseZ = sumZ / structures;
    } else if (this.mcvCount > 0) {
      // No buildings, but a construction vehicle: THAT is the base, and every
      // rally, retreat and defence order in the file has to resolve to it. This
      // branch is the whole first minute of a match under the `mcv` opening —
      // put the army first and the escort walks off toward the enemy while the
      // one thing that matters is left behind on its own.
      const i = st.index(this.mcvIds[0] as EntityId);
      if (i >= 0) { this.baseX = st.posX[i]; this.baseZ = st.posZ[i]; }
    } else if (this.armyCount > 0) {
      // No buildings left: the "base" is wherever the army is, so retreat and
      // rally orders still resolve to somewhere meaningful.
      const i = st.index(this.armyIds[0] as EntityId);
      if (i >= 0) { this.baseX = st.posX[i]; this.baseZ = st.posZ[i]; }
    }
    if (this.builderId === NONE) { this.builderX = this.baseX; this.builderZ = this.baseZ; }

    // The rally point sits between the base and the enemy, so a massing group
    // is already facing the right way when it is released.
    const tx = this.enemyBaseX >= 0 ? this.enemyBaseX : MAP_SIZE - this.baseX;
    const tz = this.enemyBaseZ >= 0 ? this.enemyBaseZ : MAP_SIZE - this.baseZ;
    const dx = tx - this.baseX, dz = tz - this.baseZ;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1) {
      this.rallyX = clamp(this.baseX + (dx / len) * AI_MILITARY.rallyOffset, CELL, MAP_SIZE - CELL);
      this.rallyZ = clamp(this.baseZ + (dz / len) * AI_MILITARY.rallyOffset, CELL, MAP_SIZE - CELL);
    } else {
      this.rallyX = this.baseX; this.rallyZ = this.baseZ;
    }

    // Pressure decays on the census clock; a raid that stops mattering stops
    // pinning the whole army at home. It decays SLOWLY on purpose — see
    // AI_MILITARY.pressureDecayPerSec.
    const decay = AI_MILITARY.pressureDecayPerSec * AI_CADENCE.census * SIM_DT;
    this.basePressure = Math.max(0, this.basePressure - decay);

    // Last, because it anchors on the base centroid the loop above just wrote.
    // It is a cached one-shot, not a per-census scan — see `probeSea`.
    this.probeSea();
  }

  /**
   * Record that we own the superweapon structure this def names.
   *
   * Keyed by position in `superPlan` rather than by content key, because that
   * is the axis the build layer asks along: "is the next thing on my list
   * already standing". A structure whose key is not in this faction's plan —
   * one captured off another army — sets no bit, which is the honest answer:
   * the AI did not choose it and will not count it toward its own plan.
   */
  private noteSuperweapon(defId: number): void {
    const entry = this.catalog.entryForBuilding(defId);
    if (entry === undefined) return;
    for (let k = 0; k < this.superPlan.length; k++) {
      if (this.superPlan[k] === entry.key) { this.superOwnedMask |= 1 << k; return; }
    }
  }

  /**
   * Is this one of ours a construction vehicle that has not unfolded yet?
   *
   * Prefers the catalog, which knows `BuildRole.Mcv` exactly. Without a bound
   * catalog — the state of every headless test — the answer comes from columns
   * that exist regardless of content: a VEHICLE that cannot shoot, does not
   * mine, carries neither ore nor infantry, and is not already deployed. In
   * this game that set is exactly {mcv, mrdCarryall, rclCrawler} — an engineer
   * is Infantry and a harvester carries `IsHarvester`.
   *
   * THE SEAT TEST IS NOT REDUNDANT. This comment used to end "and a transport
   * has a non-zero `cargoMax`", which was never true: `cargoMax` is ORE, the
   * Hover Transport has none of it, and the unit therefore matched every clause
   * of the fallback. It was harmless only because transports could not carry
   * anything, so nothing ever asked. Now that `UnitDef.passengers` is real
   * content, an unarmed hull with seats is a transport and the AI must not send
   * it off looking for somewhere to unfold.
   */
  private isUndeployedMcv(i: number, kind: EntityKind, flags: number): boolean {
    if ((flags & EntityFlag.Deployed) !== 0) return false;
    const st = this.store;
    const entry = this.catalog.entryForUnit(st.defId[i]);
    if (entry !== undefined) return entry.role === BuildRole.Mcv;
    return kind === EntityKind.Vehicle
      && (flags & EntityFlag.IsHarvester) === 0
      && st.cargoMax[i] <= 0
      && (transportService()?.capacityAt(i) ?? 0) <= 0
      && st.maxSpeed[i] > 0;
  }

  /**
   * Is this one of ours a troop hull, an armed hull, or neither?
   *
   * THE CATALOG IS THE ONLY HONEST ANSWER FOR A WARSHIP, and that is why the
   * fallback below does not try to invent one. Every ship in this game is
   * `Locomotor.Hover` — `Locomotor` has no Naval member — and so is the entire
   * Meridian ARMY, so "hovers and shoots" describes a Solarch as exactly as it
   * describes a Kite Corvette. `MoveClass` would answer it, but only after
   * `moveClassAt` has seen the hull standing in water, which is not true of a
   * ship that has just rolled out of a yard onto its slipway. Guessing here
   * would take the Pact's whole army out of its own strike group.
   *
   * A TRANSPORT, by contrast, has TWO facts of its own, and the fallback needs
   * BOTH. Seats are the obvious one — `capacityAt` is the same question
   * `isUndeployedMcv` already asks for the same reason, and it is what keeps an
   * unarmed 900-credit ferry out of an attack wave. Seats ALONE are not enough:
   * "unarmed vehicle with passengers" is also every armoured personnel carrier
   * anyone will ever add, and `stageAmphibious` picks the hull with the MOST
   * seats out of this list and then sends it across open water. A carrier that
   * cannot swim wins that comparison, sails nowhere, and the operation dies on
   * `crossTicks` with the squad locked inside it — while `transports` reports a
   * fleet the brain does not have. It reported THREE for a brain with no naval
   * yard, which is how this was noticed.
   *
   * So the second fact is AMPHIBIOUSNESS, read off the locomotor column rather
   * than off `moveClassAt`: `MoveClass` answers Hover for a hull standing on
   * sand and Naval for the same hull one cell out, so it describes where the
   * unit IS. `Locomotor.Hover` describes what it can DO, which is the question,
   * and it is the property every troop hull in this game already has (see the
   * embark note in `amphibiousWanted`).
   */
  private navalRoleOfUnit(i: number, kind: EntityKind, flags: number): BuildRole {
    // THE SERVICE'S REVERSE MAP FIRST, and it is the one that actually answers
    // in a real match — see `ProductionOracle.entityKey`. `entryForUnit` is
    // kept behind it because it is the only path the headless tests have, and
    // because it is correct wherever the two id spaces do agree.
    const named = this.oracle?.entityKey?.(this.store.handleOf(i) as number) ?? '';
    const entry = named !== ''
      ? this.catalog.get(named)
      : this.catalog.entryForUnit(this.store.defId[i]);
    if (entry !== undefined) {
      if (entry.role === BuildRole.Transport || entry.role === BuildRole.Warship) {
        return entry.role;
      }
      return BuildRole.Unknown;
    }
    if (kind === EntityKind.Vehicle && (flags & EntityFlag.CanAttack) === 0
      && this.store.locomotor[i] === Locomotor.Hover
      && (transportService()?.capacityAt(i) ?? 0) > 0) {
      return BuildRole.Transport;
    }
    return BuildRole.Unknown;
  }

  /**
   * True while an undeployed construction vehicle is the AI's whole base.
   *
   * The build and squad layers both branch on "no Construction Yard", and
   * before the `mcv` opening existed that condition meant exactly one thing:
   * the yard was destroyed, the game is lost, throw everything at them. On tick
   * one of a match it means the opposite — nothing has happened yet.
   */
  get mcvPending(): boolean {
    return this.mcvCount > 0;
  }

  /**
   * Which role a structure of ours plays.
   *
   * Prefers the def table when one is bound. Without it — the state of this
   * repo today — the answer comes from EntityFlag bits plus the footprint,
   * which are real columns that exist regardless of content. The only ambiguous
   * pair is barracks vs war factory (both are `IsFactory`), and they are
   * separated by width: every infantry producer in BUILDING_DIMENSIONS is 2
   * cells wide, every vehicle producer is 3.
   */
  private roleOfBuilding(i: number): BuildRole {
    const st = this.store;
    const entry = this.catalog.entryForBuilding(st.defId[i]);
    if (entry !== undefined) return entry.role;

    const f = st.flags[i];
    if ((f & EntityFlag.IsBuilder) !== 0) return BuildRole.Builder;
    if ((f & EntityFlag.IsRefinery) !== 0) return BuildRole.Refinery;
    if ((f & EntityFlag.IsRadar) !== 0) return BuildRole.Radar;
    if ((f & EntityFlag.CanAttack) !== 0) {
      // A turreted defensive structure is the one that can plausibly track
      // something airborne; a fixed emplacement cannot.
      return (f & EntityFlag.HasTurret) !== 0 ? BuildRole.AntiAir : BuildRole.Defense;
    }
    if (st.powerDraw[i] > 0) return BuildRole.Power;
    if ((f & EntityFlag.IsFactory) !== 0) {
      return st.footprintW[i] >= 3 ? BuildRole.WarFactory : BuildRole.Barracks;
    }
    // Nothing flags a tech lab or an ore silo, and the difference matters: the
    // tech gate is "do I already own a lab". BUILDING_DIMENSIONS separates them
    // by size — every silo and wall is 1x1, every lab is 2x2 and draws power.
    if (st.footprintW[i] <= 1 && st.footprintH[i] <= 1) return BuildRole.Storage;
    if (st.powerDraw[i] < 0) return BuildRole.TechLab;
    return BuildRole.Unknown;
  }

  /* ======================================================================
   * 2.4 OBSERVE — what can I see, what do I remember
   *
   * THE VISION DISCIPLINE. Every enemy read below is gated on
   * `world.vision.canSee`. Nothing else in this class ever looks at an entity
   * it does not own.
   * ====================================================================== */

  private observe(s: SimContext): void {
    const st = this.store;
    const w = this.world;
    const me = this.player as number;
    const enemies = w.enemyMask(this.player);

    // Decay the mobile-threat field before adding this sweep's observations, so
    // a position the AI has not looked at in a while stops attracting it.
    const decay = Math.exp(-AI_MILITARY.threatDecayPerSec * AI_CADENCE.census * SIM_DT);
    for (let c = 0; c < THREAT_CELLS; c++) this.threatGrid[c] *= decay;

    this.threatObs.fill(0);
    this.memTouched.fill(0);

    let observedX = 0, observedZ = 0, observedStructures = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const owner = st.owner[i];
      if (owner === me) continue;
      if ((enemies & (1 << owner)) === 0) continue;
      const f = st.flags[i];
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Cloaked)) !== 0) continue;

      if (!w.vision.canSee(this.player, st.handleOf(i))) continue;

      const x = st.posX[i], z = st.posZ[i];
      const airborne = st.posY[i] - w.terrain.heightAt(x, z) > AI_BUILD.airAltitudeMetres;
      if (airborne) {
        this.sawAirTick = s.tick;
        if (this.firstAirTick < 0) this.firstAirTick = s.tick;
      }

      const cls = classifyThreat(st.kind[i] as EntityKind, st.armorClass[i] as ArmorClass, airborne);
      // Live HP is the cheapest honest strength proxy, and it is a column the
      // AI is allowed to read for anything it can see.
      const strength = Math.max(0.1, st.hp[i] / 60);

      if (st.kind[i] === EntityKind.Building) {
        this.remember(x, z, this.enemyRoleOf(i), s.tick);
        observedX += x; observedZ += z; observedStructures++;
        // A defensive structure is a real threat and belongs in the mix; a
        // power plant is not.
        if ((f & EntityFlag.CanAttack) !== 0) this.threatObs[cls] += strength;
        continue;
      }

      this.threatObs[cls] += strength;
      const bx = clamp(Math.floor(x / THREAT_BUCKET_METRES), 0, THREAT_DIM - 1) | 0;
      const bz = clamp(Math.floor(z / THREAT_BUCKET_METRES), 0, THREAT_DIM - 1) | 0;
      this.threatGrid[bz * THREAT_DIM + bx] += strength;
    }

    this.forgetUnseen(s.tick);

    // Exponential smoothing: the composition scorer should chase the enemy's
    // army over ~10 seconds, not flicker with whatever walked past a scout.
    let total = 0;
    for (let c = 0; c < AI_THREAT_CLASS_COUNT; c++) total += this.threatObs[c];
    const blend = 0.25;
    for (let c = 0; c < AI_THREAT_CLASS_COUNT; c++) {
      const norm = total > 0 ? this.threatObs[c] / total : 0;
      this.threatMix[c] = this.threatMix[c] * (1 - blend) + norm * blend;
    }

    if (observedStructures > 0) {
      this.enemyBaseX = observedX / observedStructures;
      this.enemyBaseZ = observedZ / observedStructures;
    } else if (this.memCount > 0 && this.enemyBaseX < 0) {
      this.enemyBaseX = this.memX[0];
      this.enemyBaseZ = this.memZ[0];
    }
  }

  /** Role guess for an ENEMY structure — same heuristic, their flags. */
  private enemyRoleOf(i: number): BuildRole {
    const st = this.store;
    const entry = this.catalog.entryForBuilding(st.defId[i]);
    if (entry !== undefined) return entry.role;
    const f = st.flags[i];
    if ((f & EntityFlag.IsBuilder) !== 0) return BuildRole.Builder;
    if ((f & EntityFlag.IsRefinery) !== 0) return BuildRole.Refinery;
    if ((f & EntityFlag.CanAttack) !== 0) return BuildRole.Defense;
    if ((f & EntityFlag.IsFactory) !== 0) {
      return st.footprintW[i] >= 3 ? BuildRole.WarFactory : BuildRole.Barracks;
    }
    if (st.powerDraw[i] > 0) return BuildRole.Power;
    return BuildRole.Unknown;
  }

  /** Stable identity for a remembered structure: its origin cell. */
  private cellKey(x: number, z: number): number {
    return clampCell(worldToCell(z)) * MAP_CELLS + clampCell(worldToCell(x));
  }

  /** Insert or refresh a remembered enemy structure. */
  private remember(x: number, z: number, role: BuildRole, tick: number): void {
    const cell = this.cellKey(x, z);
    for (let m = 0; m < this.memCount; m++) {
      if (this.memCell[m] !== cell) continue;
      this.memSeen[m] = tick;
      this.memRole[m] = role;
      this.memTouched[m] = 1;
      return;
    }
    let slot = this.memCount;
    if (slot >= AI_MEMORY.structureSlots) {
      // Evict the stalest entry rather than dropping the new sighting: what the
      // AI just looked at is always worth more than what it saw five minutes
      // ago and has not revisited.
      slot = 0;
      for (let m = 1; m < this.memCount; m++) if (this.memSeen[m] < this.memSeen[slot]) slot = m;
    } else {
      this.memCount++;
    }
    this.memX[slot] = x;
    this.memZ[slot] = z;
    this.memCell[slot] = cell;
    this.memRole[slot] = role;
    this.memSeen[slot] = tick;
    this.memTouched[slot] = 1;
  }

  /**
   * Drop remembered structures that are provably gone, and let very old ones
   * expire.
   *
   * "Provably gone" means: the AI can SEE that cell right now and there was
   * nothing there this sweep. That is the honest rule — it is exactly what a
   * player knows, and it is why the AI walks into a razed base once before it
   * updates its map.
   */
  private forgetUnseen(tick: number): void {
    let w = 0;
    for (let m = 0; m < this.memCount; m++) {
      const cx = clampCell(worldToCell(this.memX[m]));
      const cz = clampCell(worldToCell(this.memZ[m]));
      const stale = tick - this.memSeen[m] > AI_MILITARY.memoryTicks;
      const disproved = this.memTouched[m] === 0 && this.world.vision.isVisibleAt(this.player, cx, cz);
      if (stale || disproved) continue;
      if (w !== m) {
        this.memX[w] = this.memX[m];
        this.memZ[w] = this.memZ[m];
        this.memCell[w] = this.memCell[m];
        this.memRole[w] = this.memRole[m];
        this.memSeen[w] = this.memSeen[m];
      }
      w++;
    }
    this.memCount = w;
  }

  /* ======================================================================
   * 2.5 ECONOMY
   * ====================================================================== */

  private economy(s: SimContext, p: PlayerState): void {
    const st = this.store;
    const w = this.world;

    /* -- keep harvesters mining and alive -------------------------------- */
    let starved = 0;
    for (let k = 0; k < this.harvesterCount; k++) {
      const h = this.harvesterIds[k] as EntityId;
      const i = st.index(h);
      if (i < 0) continue;
      if ((st.flags[i] & ORDERABLE_REJECT) !== 0) continue;

      const hpFrac = st.maxHp[i] > 0 ? st.hp[i] / st.maxHp[i] : 1;
      const underFire = s.time - st.lastHitTime[i] < AI_ECONOMY.harvesterThreatSec;

      // A wounded harvester under fire is worth more parked at home than dead
      // on the field: it is 1400 credits and the ore is not going anywhere.
      if (underFire && hpFrac < AI_ECONOMY.harvesterFleeHp) {
        if (st.state[i] !== UnitState.Fleeing) {
          this.issueOrder(OrderKind.Move, this.one(h), 1, this.baseX, this.baseZ, NONE);
        }
        continue;
      }

      const state = st.state[i];
      const busy =
        state === UnitState.SeekOre || state === UnitState.Harvesting ||
        state === UnitState.ReturnToRefinery || state === UnitState.Docked;
      if (busy) continue;

      // Idle harvester: point it at the nearest ore it can reach.
      if (w.ore.findOre(st.cellX[i], st.cellZ[i], AI_ECONOMY.oreSearchCells, this.oreOut)) {
        this.issueOrder(
          OrderKind.Harvest, this.one(h), 1,
          cellToWorld(this.oreOut[0]), cellToWorld(this.oreOut[1]), NONE,
        );
      } else {
        starved++;
      }
    }

    /* -- cut off from ore ------------------------------------------------- */
    // Every harvester failing to find ore inside its search radius is the
    // "economy is dead" signal. The response is not to keep buying harvesters;
    // it is to look for a second field, and failing that, to spend the bank on
    // an army while there is still a bank (see `waveThreshold`).
    this.oreStarved = this.harvesterCount > 0 && starved === this.harvesterCount;
    this.expandX = -1;
    this.expandZ = -1;
    if (this.oreStarved || this.roleCount[BuildRole.Refinery] === 0) {
      const cx = clampCell(worldToCell(this.baseX));
      const cz = clampCell(worldToCell(this.baseZ));
      if (w.ore.findOre(cx, cz, AI_ECONOMY.expandSearchCells, this.oreOut)) {
        this.expandX = cellToWorld(this.oreOut[0]);
        this.expandZ = cellToWorld(this.oreOut[1]);
      }
    }

    /* -- how many harvesters do I want ------------------------------------ */
    const refineries = this.roleCount[BuildRole.Refinery] + this.roleBuilding[BuildRole.Refinery];
    const want = Math.min(
      this.diff.maxHarvesters,
      Math.round(refineries * AI_ECONOMY.harvestersPerRefinery * this.pers.economy),
    );

    // Trucks already PAID FOR count against the target. Without this the demand
    // is computed from the trucks that have finished, so the brain re-orders
    // the same last harvester once per free queue slot and overshoots its own
    // cap by `queueDepth - 1` every time — a Brutal brain settled on ten with a
    // cap of nine. Harmless while the cap was a shared constant nobody read as
    // a promise; not harmless now that it is the difficulty setting.
    let queued = 0;
    const harvester = this.catalog.forRole(BuildRole.Harvester, this.faction);
    if (harvester !== undefined && harvester.defId >= 0) {
      const q = p.queues[harvester.tab as number];
      if (q !== undefined) {
        for (let k = 0; k < q.items.length; k++) {
          const it = q.items[k];
          if (!it.isBuilding && it.defId === harvester.defId) queued++;
        }
      }
    }

    // No point buying a harvester with nothing left to mine.
    this.wantHarvesters = this.oreStarved && this.expandX < 0
      ? 0 : Math.max(0, want - this.harvesterCount - queued);

    /* -- power ------------------------------------------------------------ */
    // Project the demand already committed: a structure under construction
    // draws power the moment it lands, and reacting only once the lights go out
    // costs a minute of build speed every single time.
    let committed = 0;
    for (let r = 0; r < this.roleBuilding.length; r++) {
      if (this.roleBuilding[r] === 0) continue;
      const e = this.catalog.forRole(r as BuildRole, this.faction);
      if (e !== undefined && e.power < 0) committed += -e.power * this.roleBuilding[r];
    }
    const surplus = p.powerProduced - p.powerConsumed - committed;
    this.powerSurplus = surplus;
    this.powerUrgent = surplus < AI_ECONOMY.powerHeadroom;
  }

  /* ======================================================================
   * 2.5b DEPLOYMENT — turning a truck into a base
   *
   * THE LAYER THE WHOLE OPENING HANGS ON. Under `game/Scenarios.ts` start
   * condition `mcv` — the default — an AI begins a match owning one
   * construction vehicle, a handful of infantry, a light vehicle or two, and
   * nothing else. No yard, no power, no refinery, no factory. Every other layer
   * in this file is written against a base that already exists; without this
   * one the brain has nothing to build from, `chooseBuild` finds nothing
   * available, and the opponent simply never plays. That failure is INVISIBLE
   * from the outside — the match runs, the frame rate is fine, the HUD is
   * correct — right up until you notice you are unopposed.
   *
   * It is an ORDER layer, not a production layer: deploying is something you
   * tell a unit you already own to do, so it goes out through
   * `commands.issueOrder(OrderKind.Deploy, ...)`, the same struct the player's
   * deploy button produces. The AI has no privileged path.
   *
   * TWO ORDERS, NOT ONE. The vehicle is driven to the chosen site with a plain
   * Move and only unfolded once it is standing on it. That is deliberate
   * insurance: it is correct whether `OrderKind.Deploy` means "unfold where you
   * are" or "drive to (x,z) and unfold there", so this layer cannot be broken
   * by the order handler settling on either reading.
   * ====================================================================== */

  /** Metres from the chosen site at which the vehicle is "there". */
  private static readonly DEPLOY_ARRIVE_M = 5.0;

  private deploy(s: SimContext): void {
    const st = this.store;

    if (this.mcvCount === 0) {
      if (this.deployId !== NONE) this.resetDeploySite();
      this.deployId = NONE;
      this.deployGoal = '';
      this.deployAttempts = 0;
      return;
    }

    // Work with one vehicle at a time. Keep the tracked one while it lives so a
    // half-finished approach is not restarted every census.
    let i = this.store.index(this.deployId);
    if (i < 0 || (st.flags[i] & ORDERABLE_REJECT) !== 0) {
      this.deployId = NONE;
      for (let k = 0; k < this.mcvCount; k++) {
        const h = this.mcvIds[k] as EntityId;
        const idx = st.index(h);
        if (idx < 0 || (st.flags[idx] & ORDERABLE_REJECT) !== 0) continue;
        this.deployId = h;
        i = idx;
        break;
      }
      if (this.deployId === NONE) return;
      this.resetDeploySite();
      this.deployAttempts = 0;
    }

    // Already unfolding. Do not touch it — a second order here cancels the very
    // thing this layer exists to cause.
    if (st.state[i] === UnitState.Deploying) {
      this.deployGoal = 'construction vehicle is unfolding';
      return;
    }

    const haveYard =
      this.roleCount[BuildRole.Builder] + this.roleBuilding[BuildRole.Builder] > 0;

    // A second yard is only worth unfolding somewhere the first one cannot
    // reach; otherwise the vehicle is a 3000-credit insurance policy against
    // losing the first, and it is worth more parked than spent.
    if (haveYard && !this.wantsExpansion()) {
      if (this.deployX >= 0) this.resetDeploySite();
      this.deployGoal = 'construction vehicle held in reserve';
      return;
    }

    /* -- blocked ground: relocate, do not retry ---------------------------
     * Two different failures, on two different clocks, and conflating them is
     * a bug either way round:
     *
     *   - THE GROUND REFUSED. A Deploy order has been outstanding for
     *     `retryTicks` and there is still no yard. Re-proposing the identical
     *     site would fail identically forever — the classic "the AI did
     *     nothing all match".
     *   - THE VEHICLE NEVER GOT THERE. No Deploy order has gone out at all
     *     within `approachTicks`, so the site is unreachable. This one needs
     *     its OWN, much longer clock: an honest drive to a site 64 m away takes
     *     fifteen seconds, and sharing the deploy clock would re-site the
     *     vehicle mid-approach every ten, so it would never arrive anywhere.  */
    if (this.deployX >= 0) {
      const armed = this.deployArmedTick > -1e8;
      const overdue = armed
        ? s.tick - this.deployArmedTick > AI_DEPLOY.retryTicks
        : s.tick - this.deploySiteTick > AI_DEPLOY.approachTicks;
      if (overdue) {
        this.deployAttempts++;
        this.resetDeploySite();
      }
    }

    if (this.deployX < 0) {
      const giveUp = this.deployAttempts >= AI_DEPLOY.maxRelocations;
      if (giveUp || !this.chooseDeploySite(i, haveYard)) {
        // Unfolding on mediocre ground beats never unfolding: a yard sited
        // badly still builds an army, and a vehicle that never deploys is a
        // player who never joined the match.
        this.deployX = st.posX[i];
        this.deployZ = st.posZ[i];
        this.blocked = 'no clear construction yard site nearby — deploying where it stands';
      } else {
        // A site was found, so whatever the last pass complained about is no
        // longer true. The build layer deliberately does not clear `blocked`
        // while a vehicle is pending, so this is the only thing that can.
        this.blocked = '';
      }
      this.deploySiteTick = s.tick;
      this.deployIssuedTick = -1e9;
      this.deployArmedTick = -1e9;
      this.lastDeployMoveTick = -1e9;
    }

    const arrive = AiBrain.DEPLOY_ARRIVE_M * AiBrain.DEPLOY_ARRIVE_M;
    if (distSq2(st.posX[i], st.posZ[i], this.deployX, this.deployZ) > arrive) {
      this.deployGoal =
        `driving to ${this.deployX.toFixed(0)},${this.deployZ.toFixed(0)} to deploy`;
      if (s.tick - this.lastDeployMoveTick < AI_MILITARY.reissueTicks) return;
      // Already under way: leave it alone unless the order has gone stale,
      // which is how a vehicle wedged against a rock gets un-wedged.
      const moving = st.state[i] === UnitState.Moving || st.state[i] === UnitState.AttackMoving;
      if (moving && s.tick - this.lastDeployMoveTick < AI_DEPLOY.retryTicks) return;
      if (this.issueOrder(
        OrderKind.Move, this.one(this.deployId), 1, this.deployX, this.deployZ, NONE,
      )) {
        this.lastDeployMoveTick = s.tick;
      }
      return;
    }

    if (s.tick - this.deployIssuedTick < AI_MILITARY.reissueTicks) return;
    this.deployGoal = 'deploying the construction yard';
    if (this.issueOrder(
      OrderKind.Deploy, this.one(this.deployId), 1, this.deployX, this.deployZ, NONE,
    )) {
      this.deployIssuedTick = s.tick;
      if (this.deployArmedTick <= -1e8) this.deployArmedTick = s.tick;
    }
  }

  /** Forget the current site so the next pass picks a fresh one. */
  private resetDeploySite(): void {
    this.deployX = -1;
    this.deployZ = -1;
    this.deploySiteTick = -1e9;
    this.deployIssuedTick = -1e9;
    this.deployArmedTick = -1e9;
    this.lastDeployMoveTick = -1e9;
  }

  /** Is there a second ore field far enough from the yard to be worth one? */
  private wantsExpansion(): boolean {
    if (this.expandX < 0) return false;
    return dist2(this.expandX, this.expandZ, this.builderX, this.builderZ)
      > AI_DEPLOY.expansionSpacing;
  }

  /**
   * Pick where the yard goes. Writes `deployX`/`deployZ`; false when nothing
   * legal was found.
   *
   * THE ANCHOR IS ORE. A Construction Yard is only worth what its refinery can
   * reach, and the build radius is measured from the yard — put it in an empty
   * corner and the first refinery is out of range of every field on the map.
   * So the site is the nearest ore, backed off by `AI_DEPLOY.oreStandoff` along
   * the line from the field to where the vehicle is actually standing, which
   * leaves room for the refinery AND stops the yard paving over the cells its
   * own harvesters were going to mine.
   *
   * LEGALITY IS ASKED OF THE TERRAIN, NOT THE ORACLE. `ProductionOracle
   * .placeable` is the build ghost's answer and the build ghost enforces the
   * build radius of an existing Construction Yard — which is precisely the
   * thing that does not exist yet. Asking it here returns false everywhere and
   * the AI never deploys at all.
   */
  private chooseDeploySite(i: number, haveYard: boolean): boolean {
    const st = this.store;
    const w = this.world;
    let ax = st.posX[i];
    let az = st.posZ[i];

    if (haveYard && this.expandX >= 0) {
      ax = this.expandX;
      az = this.expandZ;
    }

    const ocx = clampCell(worldToCell(ax));
    const ocz = clampCell(worldToCell(az));
    if (w.ore.findOre(ocx, ocz, AI_DEPLOY.oreSearchCells, this.oreOut)) {
      const ox = cellToWorld(this.oreOut[0]);
      const oz = cellToWorld(this.oreOut[1]);
      // Back off along the line from the field toward the vehicle, so the yard
      // ends up between the army and the ore rather than beyond it.
      const dx = ax - ox;
      const dz = az - oz;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 1) {
        ax = ox + (dx / len) * AI_DEPLOY.oreStandoff;
        az = oz + (dz / len) * AI_DEPLOY.oreStandoff;
      } else {
        ax = ox + AI_DEPLOY.oreStandoff;
        az = oz;
      }
    }
    // Cap the detour. A field on the far side of the map is not worth a minute
    // of driving with no base, no income and an undefended truck in the open —
    // pull the anchor back along the line and take the best ground within
    // reach instead.
    const tx = ax - st.posX[i];
    const tz = az - st.posZ[i];
    const trip = Math.sqrt(tx * tx + tz * tz);
    if (trip > AI_DEPLOY.maxTravel) {
      ax = st.posX[i] + (tx / trip) * AI_DEPLOY.maxTravel;
      az = st.posZ[i] + (tz / trip) * AI_DEPLOY.maxTravel;
    }

    ax = clamp(ax, CELL * 2, MAP_SIZE - CELL * 2);
    az = clamp(az, CELL * 2, MAP_SIZE - CELL * 2);

    const entry = this.catalog.forRole(BuildRole.Builder, this.faction);
    const fw = entry === undefined || entry.footprintW <= 0 ? 3 : entry.footprintW;
    const fh = entry === undefined || entry.footprintH <= 0 ? 3 : entry.footprintH;

    const cx0 = clampCell(worldToCell(ax) - ((fw / 2) | 0));
    const cz0 = clampCell(worldToCell(az) - ((fh / 2) | 0));

    if (this.deployAttempts === 0 && this.siteTakesAYard(cx0, cz0, fw, fh)) {
      this.acceptDeploySite(cx0, cz0, fw, fh);
      return true;
    }

    // Each relocation starts its ring scan one step further out and spins the
    // side order, so a retry genuinely looks somewhere else rather than
    // re-proposing the cell that just failed.
    const first = 1 + Math.min(this.deployAttempts, AI_DEPLOY.maxRelocations);
    const spin = this.rng.int(0, 3);
    for (let ring = first; ring <= first + AI_DEPLOY.searchRings; ring++) {
      for (let side = 0; side < 4; side++) {
        const sd = (side + spin) & 3;
        for (let t = -ring; t <= ring; t++) {
          let ox: number;
          let oz: number;
          if (sd === 0) { ox = cx0 + t; oz = cz0 - ring; }
          else if (sd === 1) { ox = cx0 + ring; oz = cz0 + t; }
          else if (sd === 2) { ox = cx0 + t; oz = cz0 + ring; }
          else { ox = cx0 - ring; oz = cz0 + t; }
          if (!this.siteTakesAYard(ox, oz, fw, fh)) continue;
          this.acceptDeploySite(ox, oz, fw, fh);
          return true;
        }
      }
    }
    return false;
  }

  /** Footprint origin cell -> the world centre the order carries. */
  private acceptDeploySite(ox: number, oz: number, fw: number, fh: number): void {
    this.deployX = cellToWorld(ox) + (fw - 1) * CELL * 0.5;
    this.deployZ = cellToWorld(oz) + (fh - 1) * CELL * 0.5;
  }

  /**
   * Will the ground take a Construction Yard footprint here, with room to work?
   *
   * The gap ring is the same idea as `siteIsLegal`'s and matters more: a yard
   * wedged flush against a cliff and a rock is a yard whose entire build radius
   * is unusable, and there is no second yard to place from.
   */
  private siteTakesAYard(ox: number, oz: number, w: number, h: number): boolean {
    if (ox < 1 || oz < 1 || ox + w > MAP_CELLS - 1 || oz + h > MAP_CELLS - 1) return false;
    const terrain = this.world.terrain;
    for (let z = oz; z < oz + h; z++) {
      for (let x = ox; x < ox + w; x++) {
        if (!terrain.isBuildable(x, z) || terrain.isOccupied(x, z)) return false;
      }
    }
    const gap = AI_DEPLOY.gapCells;
    for (let z = oz - gap; z < oz + h + gap; z++) {
      for (let x = ox - gap; x < ox + w + gap; x++) {
        if (x >= ox && x < ox + w && z >= oz && z < oz + h) continue;
        if (terrain.isOccupied(x, z)) return false;
      }
    }
    return true;
  }

  /* ======================================================================
   * 2.6 BUILD
   * ====================================================================== */

  private build(s: SimContext, p: PlayerState): void {
    // A ProductionStart that was never acknowledged is assumed lost. Without
    // this the AI deadlocks forever against a production module that has not
    // landed yet — which is the boot state of this repo.
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      if (this.inFlight[t] > 0 && s.tick - this.inFlightTick[t] > AI_BUILD.requestTimeoutTicks) {
        this.inFlight[t] = 0;
      }
    }

    // Placement first: a completed structure sitting unplaced blocks its whole
    // tab, so it is always the most valuable single action available.
    if (this.pendingPlaceCount > 0 && this.placeNext()) return;

    if (this.builderId === NONE && this.roleCount[BuildRole.Builder] === 0) {
      // No Construction Yard — but WHY not decides everything.
      //
      // A construction vehicle still folded up means the match has not started
      // yet, and the deploy layer is already dealing with it. Spending the whole
      // bank on units here (the old unconditional behaviour) would empty the
      // opening bank into a factory that does not exist and set the posture to
      // Crippled on tick one.
      if (this.mcvPending) {
        this.buildGoal = this.deployGoal === '' ? 'waiting on the construction yard' : this.deployGoal;
        this.blocked = '';
        return;
      }
      // Genuinely crippled: everything the AI has goes into units from whatever
      // factories survived.
      this.buildUnits(s, p, true);
      return;
    }

    this.unavailableReason = '';
    const choice = this.chooseBuild(s, p);
    if (choice === null) {
      // Nothing was queued this pass. If something was REFUSED, say what and
      // why — "the AI built nothing" is a mystery, "conyard: Requires a
      // Construction Yard" is a bug report.
      this.blocked = this.unavailableReason;
      return;
    }
    this.requestProduction(choice, s.tick);
  }

  /** Score one candidate into `bestEntry`. Allocation-free by construction. */
  private consider(entry: CatalogEntry | undefined, score: number, why: string): void {
    if (entry === undefined || score <= this.bestScore) return;
    if (!this.available(entry) || !this.canQueue(entry, this.spendable)) return;
    this.bestEntry = entry;
    this.bestScore = score;
    this.bestGoal = why;
  }

  /**
   * Pick the next thing to queue. Returns null when the right answer is "wait"
   * — which is a real decision, not a failure: an AI that always has something
   * in every queue is an AI that never banks for a war factory.
   */
  private chooseBuild(s: SimContext, p: PlayerState): CatalogEntry | null {
    this.spendable = p.credits - this.diff.creditFloor;

    /* -- 1. power is an interrupt ----------------------------------------- */
    if (this.powerUrgent) {
      const power = this.catalog.forRole(BuildRole.Power, this.faction);
      if (power !== undefined && this.available(power) && this.canQueue(power, this.spendable)) {
        this.buildGoal = 'power deficit — queueing a generator';
        return power;
      }
    }

    /* -- 2. anti-air is an interrupt once something has flown over --------
     * Gated on the difficulty in both directions. `airReactionTicks` is how
     * long this brain takes to believe what it saw; `maxAntiAir` is how much of
     * an answer it is allowed to build. Both were flat before `Locomotor.Air`
     * existed, which cost nothing at the time because the branch below had
     * never once been reached — no entity in the game could get above
     * `AI_BUILD.airAltitudeMetres`, so `sawAirTick` never left -1.
     *
     * `roleBuilding` counts here as well as `roleCount`. It has to: this is an
     * interrupt that runs before the scripted opening and before every scored
     * candidate, and counting only COMPLETED towers means an Easy brain capped
     * at one queues its second, third and fourth while the first is still
     * scaffolding. That is the shape of the bug the harvester caps fixed on the
     * economy side.
     *
     * `AI_BUILD.maxAntiAir` is still honoured as the hard ceiling over the
     * per-rung number, so the shared constant is a rule the game obeys and not
     * a comment that only a test reads. */
    const airCap = Math.min(this.diff.maxAntiAir, AI_BUILD.maxAntiAir);
    if (this.firstAirTick >= 0 && s.tick - this.firstAirTick >= this.diff.airReactionTicks
        && this.antiAirCount < airCap) {
      const aa = this.catalog.forRole(BuildRole.AntiAir, this.faction);
      if (aa !== undefined && this.available(aa) && this.canQueue(aa, this.spendable)) {
        this.buildGoal = 'saw an aircraft — putting up anti-air';
        return aa;
      }
    }

    /* -- 3. the scripted opening ------------------------------------------ */
    while (this.openingIndex < this.opening.length) {
      const step = this.opening[this.openingIndex];
      const entry = this.catalog.get(step.key);
      if (entry === undefined) { this.openingIndex++; continue; }
      if (!this.available(entry)) {
        // Unbuildable and marked optional -> skip and keep the script moving.
        // Unbuildable and required -> the prereq is still coming, so hold the
        // script here and let the adaptive layer below fill the gap.
        if (step.optional) { this.openingIndex++; continue; }
        break;
      }
      if (!this.canQueue(entry, this.spendable)) {
        // Cannot start the next scripted step yet. Do NOT stop here: hold the
        // step's cost back and let the adaptive layer spend whatever is left
        // over. An AI that sits on 3000 credits because it is "saving for a
        // refinery" while a 100-credit conscript would have held the ramp is
        // the single most common way a scripted opening loses a game.
        this.buildGoal = `saving ${entry.cost} for ${entry.key}`;
        this.spendable -= entry.cost;
        break;
      }
      this.openingIndex++;
      this.buildGoal = `opening: ${entry.key}`;
      return entry;
    }

    /* -- 4. adaptive scoring ---------------------------------------------- */
    this.bestEntry = null;
    // Floor: below this, banking beats building.
    this.bestScore = 0.35;
    this.bestGoal = '';

    const refineries = this.roleCount[BuildRole.Refinery] + this.roleBuilding[BuildRole.Refinery];
    const safeTicks = s.tick - this.lastDamageTick;

    // Economy: more refineries while there is ore left and the personality
    // wants them. The expansion case (a remote field) scores the same entry
    // higher because it is also the answer to being mined out.
    if (refineries < this.diff.maxRefineries) {
      this.consider(this.catalog.forRole(BuildRole.Refinery, this.faction),
        (1.4 - refineries * 0.35) * this.pers.economy, 'growing the economy');
    }
    if (this.expandX >= 0) {
      this.consider(this.catalog.forRole(BuildRole.Refinery, this.faction),
        2.2, 'expanding to a new ore field');
    }

    // Harvesters: the highest-return purchase in the game right up until the
    // ratio is satisfied.
    if (this.wantHarvesters > 0) {
      this.consider(this.catalog.forRole(BuildRole.Harvester, this.faction),
        1.6 * this.pers.economy, 'more harvesters');
    }

    // Producers: one of each is not optional.
    if (this.roleCount[BuildRole.Barracks] + this.roleBuilding[BuildRole.Barracks] === 0) {
      this.consider(this.catalog.forRole(BuildRole.Barracks, this.faction), 1.5, 'need a barracks');
    }
    if (this.roleCount[BuildRole.WarFactory] + this.roleBuilding[BuildRole.WarFactory] === 0) {
      this.consider(this.catalog.forRole(BuildRole.WarFactory, this.faction), 1.8, 'need a war factory');
    }

    // Defence: scored off pressure the AI has actually felt, capped by
    // difficulty so an Easy AI cannot turtle its way out of losing.
    const defenceCount = this.roleCount[BuildRole.Defense] + this.roleCount[BuildRole.AntiAir];
    if (defenceCount < this.diff.maxDefense) {
      this.consider(this.catalog.forRole(BuildRole.Defense, this.faction),
        (0.4 + this.basePressure * 0.8) * this.pers.defense, 'reinforcing the base');
    }

    // Tech: only when nothing has shot at us recently. Teching under pressure
    // is how an AI loses with a full tech tree and no army.
    if (safeTicks > AI_BUILD.techSafeTicks) {
      if (this.roleCount[BuildRole.Radar] + this.roleBuilding[BuildRole.Radar] === 0) {
        this.consider(this.catalog.forRole(BuildRole.Radar, this.faction),
          1.0 * this.pers.tech * this.diff.techBias, 'teching to radar');
      } else if (this.roleCount[BuildRole.TechLab] + this.roleBuilding[BuildRole.TechLab] === 0) {
        this.consider(this.catalog.forRole(BuildRole.TechLab, this.faction),
          0.9 * this.pers.tech * this.diff.techBias, 'teching to the battle lab');
      }
    }

    // Storage: only worth it when the bank is actually overflowing.
    if (p.credits > p.storageMax * AI_ECONOMY.siloFillFraction) {
      this.consider(this.catalog.forRole(BuildRole.Storage, this.faction), 1.1, 'banking overflow');
    }

    /* -- the repair depot -------------------------------------------------
     * ONE, and only once there is armour worth mending. The building has no
     * order and no command: `RepairSell.tickDepots` services whatever is
     * parked inside its radius, so the AI gets the whole mechanic simply by
     * owning one near the base it already retreats damaged hulls toward.
     *
     * Scored off `basePressure` for the same reason defence is: a depot is
     * only worth 800 credits to an army that is actually taking losses, and
     * an AI that opens with one has spent a war factory's worth of tempo on
     * a building with no output. */
    if (this.roleCount[BuildRole.Repair] + this.roleBuilding[BuildRole.Repair] === 0
      && this.roleCount[BuildRole.WarFactory] > 0) {
      this.consider(this.catalog.forRole(BuildRole.Repair, this.faction),
        (0.3 + this.basePressure * 0.7) * this.pers.defense, 'a depot to mend the armour');
    }

    /* -- the late game, LAST of the scored candidates ---------------------
     * Both blocks below are deliberately the final `consider` calls in this
     * function, and the ordering is load-bearing for a reason that has nothing
     * to do with score. `consider` runs `available()`, which records the FIRST
     * refusal of the pass into `unavailableReason` — the string the brain
     * publishes as `blocked` when it queues nothing. A superweapon refused for
     * "Requires a Battle Lab" is the least interesting thing that can be wrong
     * with this AI, and reported first it would bury whatever actually is. */
    this.considerNavy();
    this.considerSuperweapon();
    this.considerUpgrades(s, p);
    this.considerCommandPost(p);
    this.considerPowers(s, p);

    if (this.bestEntry !== null) {
      this.buildGoal = this.bestGoal;
      return this.bestEntry;
    }

    // Nothing structural is worth building: convert credits into army.
    return this.buildUnits(s, p, false);
  }

  /* -- "is there anywhere to put a dock", memoised on a tick stamp ---------- */
  private dockSiteTick = -1e9;
  private dockSiteOk = false;
  private readonly dockSiteOut = new Int32Array(2);
  /** Tick this brain first wanted a dock it had nowhere to put. -1 when it does. */
  private coastWantTick = -1;

  /**
   * Could this brain place a Naval Yard right now, and where?
   *
   * THE SAME SEARCH `placeNext` WILL RUN, run early. Anchored on the beach and
   * answered by `siteIsLegal`, which is `ProductionOracle.placeable` — the build
   * ghost's own rule, including the coast test the four yards carry. Asking any
   * cheaper question here (is the shore inside the build radius? is there
   * buildable ground near water?) would be a SECOND definition of placeable, and
   * this file already has one seam to the placement rule.
   *
   * Rate-limited on a tick stamp: a refusal costs the full 16-ring spiral, and
   * this is asked on the build clock. `AI_NAVAL.evalTicks` is the cadence the
   * amphibious evaluation already pays for its own ring walk.
   */
  private dockHasSomewhereToStand(entry: CatalogEntry): boolean {
    if (this.shoreCx < 0) return false;
    const tick = this.world.tick;
    if (tick - this.dockSiteTick < AI_NAVAL.evalTicks) return this.dockSiteOk;
    this.dockSiteTick = tick;
    this.dockSiteOk = this.findPlacement(
      entry.defId, entry.footprintW, entry.footprintH,
      cellToWorld(this.shoreCx), cellToWorld(this.shoreCz), this.dockSiteOut,
    );
    return this.dockSiteOk;
  }

  /**
   * Score the navy: a dock, then escorts, then a hull for a landing.
   *
   * THE COAST GATE COMES FIRST AND IS THE CHEAP ONE. `seaCells` is a cached
   * one-shot count of water near the base, so a desert match pays a single
   * integer compare for all of this and never reaches a catalog lookup.
   *
   * THE ECONOMY GATE IS THE SAME RULE `considerSuperweapon` HAD TO LEARN. A
   * dock is 1000 credits and 30 power and produces nothing that can take
   * ground, so it is bought OUT OF a working land army and never INSTEAD OF
   * one: a refinery and a war factory must already be standing. Without that
   * ordering the yard's 1.15 would beat the war factory's 1.8 on affordability
   * alone in the one window where the AI has credits and no factory, and the
   * opponent would answer the opening with a boat.
   *
   * A TRANSPORT IS BOUGHT AGAINST A PLAN, NEVER ON SPECULATION. `amphibWanted`
   * is the measured verdict from `amphibiousWanted`, so on a map where the
   * objective is walkable this never fires and the AI never owns a ferry it has
   * no water to use. That is the difference between this and a build rule that
   * says "coastal map, buy a transport" — which is how you get a 900-credit hull
   * parked next to a Construction Yard for twenty minutes.
   *
   * AND A DOCK IS NOT BOUGHT UNTIL THERE IS SOMEWHERE TO PUT IT. See the gate
   * below; that one is not a nicety, it is what stops a 1000-credit purchase
   * from freezing the Structures tab for the rest of the match.
   */
  private considerNavy(): void {
    if (!this.navalMap) return;

    // THE TRANSPORT IS SCORED FIRST AND WITHOUT A DOCK GATE, because the Pact's
    // one is not on a dock: `mrdSkiff` lists `prereqs: ['mrdForgeyard']` — their
    // WAR FACTORY — since the Sandskiff is an amphibious raider they field with
    // no navy at all. Gating this on a slipway would have cost a Meridian brain
    // 1000 credits for a building its transport does not need. `available()` is
    // the real gate either way and answers per faction from the oracle.
    if (this.amphibWanted && this.transportCount < AI_NAVAL.maxTransports) {
      this.consider(this.catalog.forRole(BuildRole.Transport, this.faction),
        1.5, 'a transport for the landing');
    }

    const yards = this.roleCount[BuildRole.NavalYard] + this.roleBuilding[BuildRole.NavalYard];
    if (yards === 0) {
      // The land army comes first, in both directions: something to mine with
      // and something to build tanks in.
      if (this.roleCount[BuildRole.Refinery] === 0) return;
      if (this.roleCount[BuildRole.WarFactory] === 0) return;
      const yard = this.catalog.forRole(BuildRole.NavalYard, this.faction);
      // A DOCK IS NOT BOUGHT UNTIL THERE IS SOMEWHERE TO PUT IT, and that is a
      // gate rather than a nicety. `canQueue` caps the Structures tab at ONE,
      // and a finished building that cannot be placed sits at the head of that
      // queue with `awaitingPlacement` set — forever. So a dock bought while the
      // coast is still out of reach does not merely fail to appear: it freezes
      // every other structure this brain will ever build, which is how one
      // unplaceable 1000-credit purchase ended a base's development at minute
      // five. Worse, the base creep in `coastCreepWanted` is DRIVEN by placing
      // ordinary structures, so the blockage also removes the only mechanism
      // that would have made the site legal. Measured on Sunder Atoll: two of
      // four brains bought a yard, neither ever placed one, and both stopped
      // building anything at all from that moment.
      if (yard === undefined) return;
      const score = AI_NAVAL.yardScore * this.pers.tech;
      if (this.dockHasSomewhereToStand(yard)) {
        this.coastWantTick = -1;
        this.consider(yard, score, 'a dock, to stop giving away the sea');
        return;
      }

      /*
       * NOWHERE TO PUT ONE. BUY THE STEP THAT MAKES ONE EXIST.
       *
       * `coastCreepWanted` already aims every unanchored structure at the beach,
       * but that only creeps as fast as the brain happens to build — and a poor
       * brain builds slowly. Measured over twelve minutes on Sunder Atoll: the
       * Allied brain placed SIX structures in total, two of them power plants,
       * and its build envelope reached the shore band by exactly five cells,
       * every one of which had one of its own units parked on it. The Soviet
       * brain, which built five plants, reached the water and founded a dock.
       *
       * So the step toward the water is bought DELIBERATELY, at the dock's own
       * score, because it IS the dock purchase one building earlier. A power
       * plant is the right instrument: every faction has one, it is the cheapest
       * structure any of them owns, and a spare generator is the one surplus
       * this AI can always use.
       *
       * BOUNDED BY A CLOCK, because "walk toward the sea" must not become
       * "build generators forever" on a base whose nearest beach is a cliff.
       * After `AI_NAVAL.coastReachTicks` of trying, the brain stops paying for
       * steps — but it keeps PROBING, so a site opened up by a demolished
       * building or a moved unit is still taken.
       */
      if (!this.coastCreepWanted) return;
      if (this.coastWantTick < 0) this.coastWantTick = this.world.tick;
      if (this.world.tick - this.coastWantTick > AI_NAVAL.coastReachTicks) return;
      this.consider(this.catalog.forRole(BuildRole.Power, this.faction), score,
        'extending the base to the water, so a dock has a coast to stand on');
      return;
    }

    // Escorts. Capped hard: a hull cannot hold ground, so every credit here is
    // one the army that can does not get.
    if (this.warshipCount < AI_NAVAL.maxWarships) {
      this.consider(this.catalog.forRole(BuildRole.Warship, this.faction),
        0.9 + this.basePressure * 0.3, 'a hull to hold the lane');
    }
  }

  /**
   * Score the next superweapon structure this army wants, if any.
   *
   * FOUR GATES BEFORE THE SCORE, because 2500 credits and 150 power is the most
   * expensive single mistake the build layer can make:
   *
   *   DIFFICULTY  `maxSuperweapons` is 0 on Easy. That is the answer to "should
   *               an easy AI use superweapons at all", and it is no. An Easy
   *               brain holds a 1400-credit floor and runs two refineries; the
   *               worst outcome available is not a beginner eating a nuke, it
   *               is an Easy brain banking for a silo it never finishes and
   *               building no army for two minutes while it tries.
   *   ONE AT A TIME  by `superOwnedMask`, so a Brutal brain allowed two builds
   *               the Iron Curtain second rather than a spare Nuclear Silo.
   *   INCOME      THE ECONOMY MUST BE FINISHED, not merely started: the AI
   *               wants `maxRefineries` — the number its own difficulty rung
   *               says is a complete economy — and never fewer than
   *               `AI_SUPERWEAPON.minRefineries`. This gate is the one that had
   *               to be tightened after the fact. Scored on its own merits a
   *               superweapon (1.6) beats a third refinery, because the
   *               refinery term decays with every one already owned (0.7 at
   *               two) — so a Brutal brain cheerfully bought two silos and
   *               plateaued its economy one refinery below the rung it is
   *               documented to reach, and `ai-economy-handicap.spec.ts` caught
   *               it. A superweapon is bought OUT OF a working economy, never
   *               INSTEAD OF one, and that is not a scoring nuance that can be
   *               tuned — it is an ordering, so it belongs in a gate.
   *   POWER       the surplus must survive the structure's own draw with
   *               `AI_SUPERWEAPON.powerHeadroom` to spare. This is the gate
   *               that actually bites: a silo in a brownout charges NOTHING —
   *               `rescanAvailability` skips any unpowered structure — so
   *               getting this wrong buys a dark building, not a slow one.
   *
   * Past all four the score is `AI_SUPERWEAPON.score * pers.tech`, which lands
   * above ordinary army and below every producer the AI does not own yet. A
   * Boomer reaches for it, a Rusher usually spends the credits on bodies, and
   * neither ever skips a war factory for it.
   */
  private considerSuperweapon(): void {
    if (this.diff.maxSuperweapons <= 0) return;
    const built = this.roleCount[BuildRole.Superweapon] + this.roleBuilding[BuildRole.Superweapon];
    if (built >= this.diff.maxSuperweapons) return;
    const wantRefineries = Math.max(AI_SUPERWEAPON.minRefineries, this.diff.maxRefineries);
    if (this.roleCount[BuildRole.Refinery] < wantRefineries) return;

    for (let k = 0; k < this.superPlan.length; k++) {
      if ((this.superOwnedMask & (1 << k)) !== 0) continue;
      const entry = this.catalog.get(this.superPlan[k]);
      if (entry === undefined) continue;

      // `entry.power` is NEGATIVE for a consumer, so this adds the draw.
      if (this.powerSurplus + entry.power < AI_SUPERWEAPON.powerHeadroom) {
        // THE POWER COMES FIRST, and asking for it here rather than skipping is
        // the difference between an AI that owns a superweapon and one that
        // never does. Nothing else in the build layer will ever supply this:
        // `powerUrgent` fires at a surplus of 40 and a working base settles
        // comfortably above it, so the AI parks at a surplus that is fine for
        // everything it currently owns and 150 short of the one thing it wants
        // — forever. Watching a real Brutal match is what found this: three
        // refineries, a Battle Lab, all three upgrades bought, and a permanent
        // surplus of exactly 100 against a silo needing 190.
        //
        // A human wanting a nuke builds two power plants first. So does this.
        // It cannot run away: the plant is scored only while a superweapon is
        // otherwise wanted, and the wanting stops the moment the surplus clears
        // — which one or two plants does.
        this.consider(this.catalog.forRole(BuildRole.Power, this.faction),
          AI_SUPERWEAPON.score * this.pers.tech, `power to run ${entry.key}`);
        return;
      }

      this.consider(entry, AI_SUPERWEAPON.score * this.pers.tech, `superweapon: ${entry.key}`);
      // Only ever the FIRST unbuilt entry in the plan. Offering both to the
      // scorer would let the cheaper one win on affordability alone, which is
      // how the Allies end up with a Chronosphere and no plan for it.
      return;
    }
  }

  /**
   * Score the next in-match upgrade.
   *
   * THE QUESTION THIS ANSWERS IS "is an upgrade a better buy than the tank it
   * costs the same as", and the honest answer is: it depends entirely on how
   * many of that tank you are going to buy afterwards. Composite Armour is 1200
   * credits for 18% off every Allied hull — 1.7 Grizzlies' worth of purchase,
   * against a multiplier that covers the whole column and everything built
   * after it for the rest of the match. Bought over an army of two it is a
   * disaster; bought over a war factory that has been running for five minutes
   * it is the best 1200 credits on the sidebar.
   *
   * That break-even is a FLOW and the AI cannot see the future, so the gate is
   * a stock: am I fielding this class in quantity right now (`AI_UPGRADE`
   * minimums), which is the cheapest honest proxy for "yes, I will keep buying
   * these". The buy ORDER is `upgradePlanFor` — economy multipliers first,
   * because they are the only ones that pay for themselves.
   *
   * `maxUpgrades` takes the front of that plan, so Normal buys the economy one
   * and stops while Hard and Brutal work through all three.
   *
   * THE BANK MULTIPLE IS NOT REDUNDANT WITH `canQueue`. An upgrade is the only
   * purchase in the game with no immediate output — nothing leaves a door and
   * no wall goes up — so buying one at exactly its price hands the enemy a
   * window where the AI has spent everything and fielded nothing.
   */
  /**
   * Build the Command Post, once, if this rung uses commander powers at all.
   *
   * GATED ON `powerMask`, WHICH IS THE WHOLE LADDER. An Easy brain has mask 0,
   * so it never builds the structure and never buys a power — the same number
   * that already decided it would never CALL one. That keeps one knob for the
   * whole layer instead of a second `maxPowers` that could disagree with it.
   *
   * `roleCount + roleBuilding` is the one-at-a-time test, the same shape the
   * repair depot above uses: a post standing OR rising counts, so the brain
   * cannot queue two while the first is on the line.
   *
   * SCORED BELOW EVERY PRODUCER AND BELOW THE UPGRADE LAYER, on `pers.tech`,
   * because that is what it is: the price of admission to a layer of buttons,
   * bought out of a working economy or not at all. It also has to clear the
   * same POWER headroom a superweapon does, and for a sharper reason — the
   * Powers tab is published only by a `Powered` structure, so a post built into
   * a brownout does not open the tab at all and the AI would have paid 1500
   * credits for a dark building it can never buy anything from.
   */
  private considerCommandPost(p: PlayerState): void {
    if (this.diff.powerMask === 0) return;
    if (this.roleCount[BuildRole.CommandPost] + this.roleBuilding[BuildRole.CommandPost] > 0) return;
    if (this.roleCount[BuildRole.Refinery] < AI_POWER_BUY.minRefineries) return;
    const entry = this.catalog.forRole(BuildRole.CommandPost, this.faction);
    if (entry === undefined) return;
    // `entry.power` is negative; a surplus that does not cover it plus the
    // headroom means the post arrives dark. Same projection the superweapon
    // block makes, and the same reason.
    if (p.powerProduced - p.powerConsumed + entry.power < AI_SUPERWEAPON.powerHeadroom) return;
    this.consider(entry, AI_POWER_BUY.score * this.pers.tech, 'a command post for the powers');
  }

  /**
   * Buy the commander powers this rung is allowed, cheapest useful first.
   *
   * `considerUpgrades`' twin — read that function and `upgradeSettled`, because
   * every argument there applies here unchanged: a power produces a BIT, no
   * census can see it, and without the settled test the scorer would re-propose
   * the same 2500-credit purchase on every build pass for the rest of the
   * match.
   *
   * THE LADDER IS `powerMask`, AGAIN. A Normal brain is allowed Ore Boost and
   * Emergency Repair and buys exactly those two; it will not spend a credit on
   * a Chronoshift it is not allowed to call. That is the same bit `callPower`
   * checks, so the AI can never own a power it will not use or use one it has
   * not bought.
   *
   * No `return` after a hit, like the upgrade layer: the five are not
   * alternatives and the plan order only decides which is reached first.
   */
  private considerPowers(s: SimContext, p: PlayerState): void {
    if (this.diff.powerMask === 0) return;
    if (this.roleCount[BuildRole.CommandPost] === 0) return;
    if (this.roleCount[BuildRole.Refinery] < AI_POWER_BUY.minRefineries) return;

    const plan = powerPlanFor();
    for (let k = 0; k < plan.length; k++) {
      const spec = powerByContentKey(plan[k]);
      if (spec === undefined) continue;
      if ((this.diff.powerMask & (1 << (spec.id as number))) === 0) continue;
      const entry = this.catalog.get(plan[k]);
      if (entry === undefined) continue;
      if (this.powerSettled(s, p, entry, spec.id as number)) continue;
      if (p.credits < entry.cost * AI_POWER_BUY.bankMultiple) continue;
      this.consider(entry, AI_POWER_BUY.score * this.pers.tech, `power: ${spec.key}`);
    }
  }

  /**
   * Is this power bought, on the line, or asked for too recently to ask again?
   *
   * `upgradeSettled` with one word changed, and the same three answers widest
   * first. BOUGHT reads `PlayerState.commanderPowerMask` — the simulation's own
   * authority, the same bit the human's sidebar greys the cameo on and the same
   * bit `CommanderPowerService.use` refuses on. Reading a column of our OWN
   * player is what this class does everywhere and is not the vision rule.
   */
  private powerSettled(
    s: SimContext, p: PlayerState, entry: CatalogEntry, powerId: number,
  ): boolean {
    if (ownsCommanderPower(p, powerId)) return true;
    if (s.tick - this.powerAskedTick[powerId] < AI_POWER_BUY.reaskTicks) return true;
    const queue = p.queues[entry.tab as number];
    if (queue === undefined) return false;
    for (let i = 0; i < queue.items.length; i++) {
      const it = queue.items[i];
      if (!it.isBuilding && it.defId === entry.defId) return true;
    }
    return false;
  }

  private considerUpgrades(s: SimContext, p: PlayerState): void {
    const allowed = Math.min(this.diff.maxUpgrades, this.upgradePlan.length);
    if (allowed <= 0) return;

    for (let k = 0; k < allowed; k++) {
      const step = this.upgradePlan[k];
      const entry = this.catalog.get(step.key);
      if (entry === undefined) continue;
      if (this.upgradeSettled(s, p, entry, k)) continue;
      if (!this.upgradeIsEarned(step.audience)) continue;
      if (p.credits < entry.cost * AI_UPGRADE.bankMultiple) continue;
      // No `return` here, unlike the superweapon: the three upgrades are not
      // alternatives, the AI wants every one it has earned and the plan order
      // only decides which it reaches first.
      this.consider(entry, AI_UPGRADE.score * this.pers.tech, `upgrade: ${entry.key}`);
    }
  }

  /**
   * Is this upgrade bought, on the line, or asked for too recently to ask
   * again?
   *
   * AN UPGRADE IS A ONE-OFF AND NOTHING ELSE IN THIS FILE KNOWS THAT. Every
   * other purchase the build layer makes produces a THING — a hull leaves a
   * door, a structure lands — and the census counts it on the next sweep, so
   * "do I still want one" answers itself. An upgrade produces a BIT. It appears
   * in no census, no roster and no structure list, so without this check the
   * scorer proposes the same 1000-credit multiplier on every build pass for the
   * rest of the match and the third refinery behind it is never reached. That
   * is not hypothetical: it is what this function was written for.
   *
   * THREE ANSWERS, WIDEST FIRST:
   *
   *   BOUGHT      `hasUpgradeKey` reads `PlayerState.upgradeMask`, which is the
   *               simulation's own authority and the same bit the human's
   *               sidebar greys the cameo on. Reading a column of our OWN
   *               player is what this class does everywhere — `credits`,
   *               `queues`, `powerProduced` — and is not the vision rule.
   *   ON THE LINE `applyEnqueue` silently drops a second copy of an upgrade
   *               already in the queue, so re-asking is not harmless: it spends
   *               an action out of the APM budget and buys nothing.
   *   JUST ASKED  the backoff, which covers the window between issuing the
   *               command and the queue reflecting it, and the case where no
   *               production module is listening at all. LONG rather than
   *               permanent on purpose: a request issued before production
   *               finished booting must eventually be retried, or one unlucky
   *               tick costs the AI an upgrade for the whole match.
   */
  private upgradeSettled(
    s: SimContext, p: PlayerState, entry: CatalogEntry, planIndex: number,
  ): boolean {
    if (hasUpgradeKey(p, entry.key)) return true;
    if (s.tick - this.upgradeAskedTick[planIndex] < AI_UPGRADE.reaskTicks) return true;
    const queue = p.queues[entry.tab as number];
    if (queue === undefined) return false;
    for (let i = 0; i < queue.items.length; i++) {
      const it = queue.items[i];
      if (!it.isBuilding && it.defId === entry.defId) return true;
    }
    return false;
  }

  /** Is the army this upgrade improves big enough to be worth the credits? */
  private upgradeIsEarned(audience: UpgradeAudience): boolean {
    switch (audience) {
      case UpgradeAudience.Infantry: return this.infantryCount >= AI_UPGRADE.minInfantry;
      case UpgradeAudience.Vehicle: return this.vehicleCount >= AI_UPGRADE.minVehicles;
      case UpgradeAudience.Army: return this.armyCount >= AI_UPGRADE.minArmy;
      default:
        return this.roleCount[BuildRole.Refinery] >= AI_UPGRADE.minRefineries
          && this.harvesterCount >= AI_UPGRADE.minHarvesters;
    }
  }

  /**
   * Queue army. Returns the entry when called from `chooseBuild`; when called
   * directly (the crippled path) it issues immediately and returns null.
   */
  private buildUnits(s: SimContext, p: PlayerState, immediate: boolean): CatalogEntry | null {
    // `this.spendable` already has the credit floor and any opening-step
    // reservation taken out of it; the crippled path spends the lot.
    const spendable = immediate ? p.credits : this.spendable;

    // Candidates: everything armed this faction can actually field right now.
    const cands = this.candidates;
    cands.length = 0;
    const all = this.catalog.all;
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.isBuilding || e.weight <= 0) continue;
      if (e.faction !== Faction.Neutral && e.faction !== this.faction) continue;
      if (!this.available(e) || !this.canQueue(e, spendable)) continue;
      cands.push(e);
    }
    if (cands.length === 0) {
      if (!immediate && this.blocked === '') this.buildGoal = 'nothing affordable — banking';
      return null;
    }

    const pick = pickUnit(cands, this.threatMix, this.diff.composition, this.rng, this.scoreScratch);
    if (pick === null) return null;

    if (immediate) {
      this.posture = AiPosture.Crippled;
      this.buildGoal = `construction yard lost — throwing ${pick.key} at them`;
      this.requestProduction(pick, s.tick);
      return null;
    }
    this.buildGoal = `building army: ${pick.key}`;
    return pick;
  }

  /**
   * Buildable in principle right now — prereqs, faction, a servicing factory.
   * Deliberately NOT an affordability test: `canQueue` owns that, because
   * "unaffordable" means save up and "unavailable" means look elsewhere.
   */
  private available(entry: CatalogEntry): boolean {
    if (entry.defId < 0) {
      // Nothing in the process can name this yet. Record why, and keep playing
      // with whatever IS resolvable.
      this.noteUnavailable('no production catalog — commands cannot name a buildable');
      return false;
    }
    // The sidebar's own answer when the production module is present.
    if (this.oracle !== null) {
      const me = this.player as number;
      if (this.oracle.available(me, entry.defId)) return true;
      const why = this.oracle.reason === undefined ? '' : this.oracle.reason(me, entry.defId);
      // THE HERO CAP IS NOT A BLOCKAGE. `blocked` means "why the AI is stuck",
      // and every other refusal on that list is "you cannot have this YET" —
      // a state that resolves. "You already have a War Commissar" never
      // resolves, so recording it pins the diagnostic for the rest of the match
      // the moment the AI's commander walks out of the barracks and drowns any
      // real reason underneath it. The AI still declines the entry; it just
      // does not report having done so.
      const capped = this.oracle.atCap !== undefined && this.oracle.atCap(me, entry.defId);
      if (!capped) {
        this.noteUnavailable(`${entry.key}: ${why === '' ? 'unavailable' : why}`);
      }
      return false;
    }
    if (prereqsMet(entry, this.haveRoleFn)) return true;
    this.noteUnavailable(`${entry.key}: prerequisites not met`);
    return false;
  }

  /**
   * Keep the FIRST refusal of a build pass. The build layer probes the opening
   * step before it probes anything else, so the first refusal is the one that
   * explains why the AI is stuck rather than the last of a dozen fallbacks.
   */
  private noteUnavailable(why: string): void {
    if (this.unavailableReason === '') this.unavailableReason = why;
  }

  /** Affordable, and the tab has room. */
  private canQueue(entry: CatalogEntry, spendable: number): boolean {
    if (spendable < entry.cost) return false;
    const tab = entry.tab as number;
    if (tab < 0 || tab >= BUILD_TAB_COUNT) return false;
    const p = this.world.player(this.player);
    const queue = p === undefined ? undefined : p.queues[tab];
    const queued = queue === undefined ? 0 : queue.items.length;
    // A structure tab holds one at a time in practice: a second structure
    // cannot be placed until the first one is down.
    const cap = entry.isBuilding ? 1 : this.diff.queueDepth;
    return queued + this.inFlight[tab] < Math.min(cap, MAX_QUEUE_DEPTH);
  }

  private requestProduction(entry: CatalogEntry, tick: number): void {
    const tab = entry.tab as number;
    if (!this.spend()) return;
    this.commands.issueProductionStart(this.player, entry.tab, entry.defId, 1);
    this.inFlight[tab]++;
    this.inFlightTick[tab] = tick;
    this.blocked = '';
    // An upgrade is an ordinary queue item on the wire and gets no special
    // handling there. It needs two things recorded here that nothing else does:
    // a counter, because an upgrade produces no entity and would otherwise be
    // invisible to every probe; and the ask tick, because it produces no entity
    // and would otherwise be re-proposed on every build pass forever. See
    // `upgradeSettled`.
    // A COMMANDER POWER NEEDS THE SAME TWO RECORDS AN UPGRADE DOES, and for the
    // same reason: it produces no entity, so it is invisible to every probe and
    // would be re-proposed on every build pass forever. See `powerSettled`.
    if (entry.role === BuildRole.CommanderPower) {
      this.powersBought++;
      const spec = powerByContentKey(entry.key);
      if (spec !== undefined) this.powerAskedTick[spec.id as number] = tick;
      return;
    }
    if (entry.role !== BuildRole.Upgrade) return;
    this.upgradesRequested++;
    for (let k = 0; k < this.upgradePlan.length && k < this.upgradeAskedTick.length; k++) {
      if (this.upgradePlan[k].key === entry.key) { this.upgradeAskedTick[k] = tick; return; }
    }
  }

  /* ----------------------------------------------------------------------
   * Structure placement
   * -------------------------------------------------------------------- */

  /**
   * Is this brain's base still too far from the water to found a dock?
   *
   * THE PREDICATE IS A DISTANCE, AND IT IS THE ONE THE PLACEMENT RULE USES.
   * `evaluatePlacement` accepts a site inside `BUILD_RADIUS` of the Construction
   * Yard or `PLACEMENT.adjacencyRadius` of any other finished structure — which
   * is exactly the C&C rule that a base creeps outward one building at a time.
   * A Naval Yard additionally has to stand on a coast. On an island map those
   * two conditions can have an EMPTY INTERSECTION on turn one, and on Sunder
   * Atoll they do: measured through the real generator and the real placement
   * rule, 532 sites on that map are buildable ground beside navigable water,
   * 400-470 sites per army are inside that army's build radius, and for three of
   * the four armies the OVERLAP IS ZERO. The nearest ground-and-shore site sits
   * 72, 76 and 79 m from the Construction Yard against a 56 m radius.
   *
   * So the answer is not a better search — no search can find a legal site that
   * does not exist — it is to WALK THE BASE TO THE WATER, which is what a human
   * does and what this map's own layout is designed around (its expansion ore
   * sits at 72 m, outside the opening radius, on the inward face). While this is
   * true, every structure that has no anchor of its own is anchored on the beach
   * instead of on the Construction Yard, so each one lands at the coast-facing
   * edge of the envelope and drags the envelope 20 m closer to the sea.
   *
   * IT TURNS ITSELF OFF. A dock founded (or merely under construction) makes
   * `roleCount + roleBuilding` non-zero, so the pull stops and the base goes back
   * to clustering. It never starts at all on a map with no navy
   * (`navalMap` is `mapSupportsNaval()`), and it never starts when the coast is
   * already inside the Construction Yard's own radius — which is the case on
   * both older sea maps, where the AI founds its dock in the first minutes.
   */
  private get coastCreepWanted(): boolean {
    if (!this.navalMap || this.shoreCx < 0) return false;
    if (this.roleCount[BuildRole.NavalYard] + this.roleBuilding[BuildRole.NavalYard] > 0) {
      return false;
    }
    return dist2(
      this.builderX, this.builderZ, cellToWorld(this.shoreCx), cellToWorld(this.shoreCz),
    ) > BUILD_RADIUS;
  }

  /**
   * Find a spot for the oldest ready structure and commit it.
   *
   * The anchor is role-dependent, which is most of what makes an AI base look
   * deliberate rather than sprayed: refineries go toward the ore they will
   * serve, defence goes toward whatever has been shooting at us, and everything
   * else clusters on the Construction Yard.
   */
  private placeNext(): boolean {
    const defId = this.pendingPlaceDef[0];
    const entry = this.catalog.entryForBuilding(defId);
    const fw = entry === undefined ? 2 : entry.footprintW;
    const fh = entry === undefined ? 2 : entry.footprintH;
    const role = entry === undefined ? BuildRole.Unknown : entry.role;

    let ax = this.builderX;
    let az = this.builderZ;
    if (role === BuildRole.NavalYard && this.shoreCx >= 0) {
      /*
       * THE BEACH, and it is the one `probeSea` already found.
       *
       * `shoreCx/shoreCz` is foot-passable land touching the MAIN naval region
       * (see `isShore`), which is the same fact `evaluatePlacement` demands of a
       * `needsShore` structure — so anchoring here puts the spiral's ring 0 on
       * ground that already satisfies the rule instead of on ground that never
       * can.
       *
       * Before this the dock was anchored on the Construction Yard like a power
       * plant and hunted by a 16-ring spiral, which reaches
       * `AI_BUILD.placementRings * CELL` = 64 m. On Sunder Atoll the buildable
       * coast is 61-79 m out, so on three of four islands the search could not
       * physically reach the water and the AI reported "no legal building site
       * inside the build radius" for a building whose whole point is to be on
       * one.
       */
      ax = cellToWorld(this.shoreCx);
      az = cellToWorld(this.shoreCz);
    } else if (role === BuildRole.Refinery && this.expandX >= 0) {
      ax = this.expandX; az = this.expandZ;
    } else if (role === BuildRole.Refinery) {
      const cx = clampCell(worldToCell(this.builderX));
      const cz = clampCell(worldToCell(this.builderZ));
      if (this.world.ore.findOre(cx, cz, AI_ECONOMY.oreSearchCells, this.oreOut)) {
        // Halfway to the ore: close enough to shorten the trip, near enough the
        // yard to stay inside the build radius and behind the defences.
        ax = (this.builderX + cellToWorld(this.oreOut[0])) * 0.5;
        az = (this.builderZ + cellToWorld(this.oreOut[1])) * 0.5;
      }
    } else if (role === BuildRole.Defense || role === BuildRole.AntiAir) {
      const tx = this.attackX >= 0 ? this.attackX : this.enemyBaseX;
      const tz = this.attackX >= 0 ? this.attackZ : this.enemyBaseZ;
      if (tx >= 0) {
        const dx = tx - this.builderX, dz = tz - this.builderZ;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 1) {
          const reach = Math.min(len * 0.5, BUILD_RADIUS * 0.7);
          ax = this.builderX + (dx / len) * reach;
          az = this.builderZ + (dz / len) * reach;
        }
      }
    } else if (this.coastCreepWanted) {
      // Nothing else wanted this one, and the base has to reach the water. The
      // anchor is the beach and `findPlacement` pulls it back to the nearest
      // LEGAL cell, which is the coast-facing edge of the build envelope — one
      // structure, one step closer. See `coastCreepWanted`.
      ax = cellToWorld(this.shoreCx);
      az = cellToWorld(this.shoreCz);
    }

    if (!this.findPlacement(defId, fw, fh, ax, az, this.cellOut)) {
      // Nowhere legal near the anchor. Fall back to the yard itself before
      // giving up — a blocked expansion must not stall the whole build queue.
      if (!this.findPlacement(defId, fw, fh, this.builderX, this.builderZ, this.cellOut)) {
        this.blocked = 'no legal building site inside the build radius';
        return false;
      }
    }
    if (!this.spend()) return false;
    this.commands.issuePlaceBuilding(this.player, defId, this.cellOut[0], this.cellOut[1]);
    // The pending entry is NOT dropped here: `building:completed` is the
    // acknowledgement. Dropping on issue would lose the structure forever if
    // the placement were rejected; as written it is simply retried on the next
    // build tick, and the action budget bounds the retry rate.
    return true;
  }

  /**
   * Spiral search for a legal footprint origin near (ax, az).
   *
   * Writes [originCx, originCz] into `out`. The search requires
   * `AI_BUILD.placementGapCells` of clear ground on every side, which is what
   * stops the AI sealing its own factory exit with a power plant.
   */
  private findPlacement(
    defId: number, w: number, h: number, ax: number, az: number, out: Int32Array,
  ): boolean {
    const cx0 = clampCell(worldToCell(ax) - ((w / 2) | 0));
    const cz0 = clampCell(worldToCell(az) - ((h / 2) | 0));

    if (this.siteIsLegal(defId, cx0, cz0, w, h)) {
      out[0] = cx0; out[1] = cz0;
      return true;
    }

    // Rotate the ring scan per attempt so successive structures do not all pile
    // into the same corner of the yard.
    const spin = this.rng.int(0, 3);
    for (let ring = 1; ring <= AI_BUILD.placementRings; ring++) {
      for (let side = 0; side < 4; side++) {
        const sd = (side + spin) & 3;
        for (let t = -ring; t <= ring; t++) {
          let ox: number, oz: number;
          if (sd === 0) { ox = cx0 + t; oz = cz0 - ring; }
          else if (sd === 1) { ox = cx0 + ring; oz = cz0 + t; }
          else if (sd === 2) { ox = cx0 + t; oz = cz0 + ring; }
          else { ox = cx0 - ring; oz = cz0 + t; }
          if (this.siteIsLegal(defId, ox, oz, w, h)) {
            out[0] = ox; out[1] = oz;
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Legal AND sensible.
   *
   * "Legal" is the build ghost's answer when the production module is present,
   * and a local reimplementation of the same three rules (in map, buildable,
   * unoccupied, inside the build radius) when it is not.
   *
   * "Sensible" is an AI-only extra: a ring of clear cells around the footprint.
   * The rules permit packing structures flush against each other; doing so is
   * how an AI seals its own factory exit and then wonders why nothing comes out.
   */
  private siteIsLegal(defId: number, ox: number, oz: number, w: number, h: number): boolean {
    const gap = AI_BUILD.placementGapCells;
    if (ox < 1 || oz < 1 || ox + w > MAP_CELLS - 1 || oz + h > MAP_CELLS - 1) return false;

    const terrain = this.world.terrain;
    if (this.oracle !== null) {
      if (!this.oracle.placeable(this.player as number, defId, ox, oz)) return false;
    } else {
      // Inside the build radius of the Construction Yard, measured from the
      // footprint CENTRE — the same rule the placement UI enforces for a human.
      const centreX = cellToWorld(ox) + (w - 1) * CELL * 0.5;
      const centreZ = cellToWorld(oz) + (h - 1) * CELL * 0.5;
      if (dist2(centreX, centreZ, this.builderX, this.builderZ) > BUILD_RADIUS) return false;
      for (let z = oz; z < oz + h; z++) {
        for (let x = ox; x < ox + w; x++) {
          if (!terrain.isBuildable(x, z) || terrain.isOccupied(x, z)) return false;
        }
      }
    }

    // The breathing-room ring, on top of whatever answered "legal".
    for (let z = oz - gap; z < oz + h + gap; z++) {
      for (let x = ox - gap; x < ox + w + gap; x++) {
        if (x >= ox && x < ox + w && z >= oz && z < oz + h) continue;
        if (terrain.isOccupied(x, z)) return false;
      }
    }
    return true;
  }

  /* ======================================================================
   * 2.7 MILITARY
   * ====================================================================== */

  private squad(s: SimContext): void {
    this.regroupSquads();

    if (this.posture === AiPosture.Defeated) return;
    // Same fork as the build layer, and the more dangerous of the two: without
    // the `mcvPending` guard, an AI opening from a construction vehicle reads
    // "no Construction Yard" on tick one and marches its entire escort across
    // the map, leaving the only asset it owns undefended in a field.
    if (this.builderId === NONE && this.roleCount[BuildRole.Builder] === 0
      && this.armyCount > 0 && !this.mcvPending) {
      this.crippledOffensive(s);
      return;
    }

    /* -- 1. is the base under attack -------------------------------------- */
    // Reaction latency is the honest difficulty axis: Brutal answers in 0.3 s,
    // Easy takes 2.4 s. The information arrives at the same instant for both.
    const observed = s.tick - this.attackObservedTick;
    const reacting = observed >= this.diff.reactionTicks && observed < AI_MILITARY.regroupTicks;
    // Being hit cancels the opening grace period on the spot. An AI that
    // absorbs a five-minute rush without ever counter-attacking because a timer
    // said so is not easy, it is inert — and rushing the enemy base is the
    // first thing anyone does to a new build.
    if (this.basePressure > AI_MILITARY.gracePressureCancel && s.tick < this.offensiveUnlockTick) {
      this.offensiveUnlockTick = s.tick;
    }
    if (reacting && this.basePressure > 0.2 && this.attackX >= 0) {
      this.defendBase(s);
      return;
    }

    /* -- 2. regrouping after a beating ------------------------------------ */
    if (s.tick < this.regroupUntilTick) {
      this.posture = AiPosture.Retreating;
      this.militaryGoal = 'regrouping at the rally point';
      this.gather(s, this.rallyX, this.rallyZ);
      return;
    }

    /* -- 3. committed? ---------------------------------------------------- */
    if (this.posture === AiPosture.Attacking) {
      if (this.strikeCount === 0) {
        // The whole wave died. Remember that this was not enough and ask for a
        // bigger one next time — the only "learning" in here, and the only kind
        // that matters.
        // Scaled by `waveSizeMul`, not flat. A flat AI_SQUAD_MAX let an Easy
        // brain that had lost four waves mass 17 units — bigger than anything a
        // Brutal brain opens with — purely because the player kept winning.
        this.waveEscalation = Math.min(
          AI_SQUAD_MAX * this.diff.waveSizeMul,
          this.waveEscalation + AI_MILITARY.waveEscalation,
        );
        this.posture = AiPosture.Massing;
        this.regroupUntilTick = s.tick + AI_MILITARY.regroupTicks;
        this.militaryGoal = 'wave was wiped out — massing a bigger one';
        return;
      }
      if (this.shouldRetreat(s)) return;
      this.pressAttack(s);
      return;
    }

    /* -- 4. massing ------------------------------------------------------- */
    // The two TIME gates, both scaled by `aggression`. Until this pass nothing
    // gated an attack on the clock at all, so an Easy AI shipped its first wave
    // the moment two units existed. Size was already tuned per difficulty; when
    // was not, and "when" is what the player feels first.
    const armedAt = Math.max(this.offensiveUnlockTick, this.lastWaveTick + this.rearmTicks);
    const threshold = this.waveThreshold();
    if (this.strikeCount >= threshold && s.tick >= armedAt) {
      this.pickObjective();
      this.posture = AiPosture.Attacking;
      this.strikeStartCount = this.strikeCount;
      this.lastWaveTick = s.tick;
      this.objectiveIssuedTick = -1e9;
      this.pressAttack(s);
      return;
    }

    this.posture = this.openingIndex < this.opening.length ? AiPosture.Opening : AiPosture.Massing;
    this.militaryGoal = s.tick < armedAt
      ? `holding — ${Math.ceil((armedAt - s.tick) / SIM_HZ)}s to the next push`
      : `massing ${this.strikeCount}/${threshold}`;
    // Idle strikers walk to the rally point; already-there units are left alone
    // so the AI does not re-issue 40 move orders a second.
    this.gather(s, this.rallyX, this.rallyZ);
  }

  /**
   * Nudge idle strikers toward the rally point, at most once every
   * `reissueTicks`.
   *
   * The rate limit matters more than it looks: a unit that is idle because it
   * is BLOCKED stays idle, so without a cooldown the squad layer re-orders it
   * five times a second and burns the brain's entire action budget on a unit
   * that is never going to move. That is what a Hard AI spending 160 apm on
   * nothing looks like from the outside.
   */
  private gather(s: SimContext, x: number, z: number): boolean {
    if (s.tick - this.lastGatherTick < AI_MILITARY.reissueTicks) return false;
    this.lastGatherTick = s.tick;
    return this.gatherIdle(this.strikeIds, this.strikeCount, x, z);
  }

  /** Rebuild strike/reserve from the tagged army, and re-fill both. */
  private regroupSquads(): void {
    const st = this.store;
    this.strikeCount = 0;
    this.reserveCount = 0;

    // The reserve is a FRACTION of the army, but it must never grow so large
    // that the strike group can no longer reach its threshold — a defensive
    // personality with a big enough army would otherwise sit at home forever,
    // permanently one unit short of an attack it is mathematically unable to
    // launch. Once the army can afford both, the reserve stops taking a cut.
    const wanted = Math.round(this.armyCount * AI_MILITARY.reserveFraction * this.pers.defense);
    const headroom = this.armyCount - this.waveThreshold();
    const reserveTarget = Math.min(
      this.armyCount,
      Math.max(AI_MILITARY.reserveMin, Math.min(wanted, Math.max(AI_MILITARY.reserveMin, headroom))),
    );

    // Pass 1: honour existing tags. Dead units are already gone from armyIds,
    // and the generation stamp means a recycled slot reads as untagged.
    for (let a = 0; a < this.armyCount; a++) {
      const h = this.armyIds[a] as EntityId;
      const i = st.index(h);
      if (i < 0) continue;
      const tag = this.groupTag.getAt(i);
      if (tag === GROUP_SCOUT) continue;
      if (tag === GROUP_STRIKE) this.strikeIds[this.strikeCount++] = h as number;
      else if (tag === GROUP_RESERVE) this.reserveIds[this.reserveCount++] = h as number;
    }

    // Pass 2: assign anything untagged, reserve first up to its target.
    for (let a = 0; a < this.armyCount; a++) {
      const h = this.armyIds[a] as EntityId;
      const i = st.index(h);
      if (i < 0 || this.groupTag.getAt(i) !== GROUP_NONE) continue;
      if (this.reserveCount < reserveTarget) {
        this.groupTag.setAt(i, GROUP_RESERVE);
        this.reserveIds[this.reserveCount++] = h as number;
      } else {
        this.groupTag.setAt(i, GROUP_STRIKE);
        this.strikeIds[this.strikeCount++] = h as number;
      }
    }

    // Pass 3: rebalance. A reserve that has grown past its share releases the
    // surplus, which is what lets the strike group reach threshold again after
    // the AI has spent a while sitting at home defending.
    while (this.reserveCount > reserveTarget && this.reserveCount > 0) {
      const h = this.reserveIds[--this.reserveCount] as EntityId;
      const i = st.index(h);
      if (i < 0) continue;
      this.groupTag.setAt(i, GROUP_STRIKE);
      this.strikeIds[this.strikeCount++] = h as number;
    }
  }

  /**
   * How big a wave has to be before it goes.
   *
   * `push` DIVIDES: a Rusher commits with fewer units, a Turtle sits on a
   * bigger stack before it moves. Multiplying (the obvious reading of "push")
   * is backwards and produces a Rusher that never attacks.
   */
  private waveThreshold(): number {
    let base = AI_SQUAD_MIN * this.diff.waveSizeMul / Math.max(0.3, this.pers.push)
      + this.waveEscalation;
    // Mined out with nowhere to expand: the bank is all the army there will
    // ever be, so stop saving for a wave that cannot get bigger.
    if (this.oreStarved && this.expandX < 0) base *= 0.6;
    return clamp(Math.round(base), 2, AI_SQUAD_MAX * 3);
  }

  private defendBase(s: SimContext): void {
    this.posture = AiPosture.Defending;
    this.militaryGoal = `base under attack — defending (${this.basePressure.toFixed(1)})`;

    this.moveGroup(this.reserveIds, this.reserveCount, OrderKind.AttackMove, this.attackX, this.attackZ);

    // Heavy pressure recalls the strike group too. `push` biases this: a Rusher
    // will trade bases, a Turtle comes straight home.
    const recallAt = 1.2 / Math.max(0.3, this.pers.push);
    if (this.basePressure > recallAt && this.strikeCount > 0) {
      this.moveGroup(this.strikeIds, this.strikeCount, OrderKind.AttackMove, this.attackX, this.attackZ);
      this.militaryGoal = 'base under heavy attack — recalling the strike group';
      // Coming home cancels the offensive; the next wave starts from scratch.
      this.regroupUntilTick = s.tick + AI_MILITARY.regroupTicks;
      this.posture = AiPosture.Defending;
    }
  }

  /** True when the wave is beaten and has been ordered home. */
  private shouldRetreat(s: SimContext): boolean {
    const st = this.store;
    if (this.strikeStartCount === 0) return false;

    const lostFrac = 1 - this.strikeCount / this.strikeStartCount;
    let hpSum = 0, hpN = 0;
    for (let k = 0; k < this.strikeCount; k++) {
      const i = st.index(this.strikeIds[k] as EntityId);
      if (i < 0 || st.maxHp[i] <= 0) continue;
      hpSum += st.hp[i] / st.maxHp[i]; hpN++;
    }
    const meanHp = hpN > 0 ? hpSum / hpN : 1;

    if (lostFrac < AI_MILITARY.retreatLossFrac && meanHp > AI_MILITARY.retreatHpFrac) return false;
    // Discipline: a low-difficulty AI often fails to notice it is losing and
    // feeds the rest of the wave in. Deterministic, from the brain's own stream.
    if (!this.rng.chance(this.diff.discipline)) return false;

    this.posture = AiPosture.Retreating;
    this.regroupUntilTick = s.tick + AI_MILITARY.regroupTicks;
    this.waveEscalation = Math.min(AI_SQUAD_MAX, this.waveEscalation + 1);
    this.militaryGoal = `wave beaten (${Math.round(lostFrac * 100)}% lost) — pulling back`;
    this.moveGroup(this.strikeIds, this.strikeCount, OrderKind.Move, this.rallyX, this.rallyZ);
    return true;
  }

  /** Keep the committed group moving, and re-target when the objective dies. */
  private pressAttack(s: SimContext): void {
    if (this.objectiveX < 0 || !this.objectiveStillWorthIt(s)) this.pickObjective();
    this.militaryGoal =
      `attacking with ${this.strikeCount} at ${this.objectiveX.toFixed(0)},${this.objectiveZ.toFixed(0)}`;
    if (s.tick - this.objectiveIssuedTick < AI_MILITARY.reissueTicks) return;
    if (this.moveGroup(this.strikeIds, this.strikeCount, OrderKind.AttackMove,
      this.objectiveX, this.objectiveZ)) {
      this.objectiveIssuedTick = s.tick;
    }
  }

  /**
   * Has the objective been taken, or proven empty?
   *
   * "Proven empty" is again vision-gated: if the AI can see the cell and its
   * memory no longer holds a structure there, the objective is done. It does
   * not get to know that from the entity store.
   */
  private objectiveStillWorthIt(s: SimContext): boolean {
    const cx = clampCell(worldToCell(this.objectiveX));
    const cz = clampCell(worldToCell(this.objectiveZ));
    const cell = cz * MAP_CELLS + cx;
    for (let m = 0; m < this.memCount; m++) if (this.memCell[m] === cell) return true;
    // Not remembered. If we cannot see there, keep going — it may still be
    // standing, we just have not arrived yet.
    if (!this.world.vision.isVisibleAt(this.player, cx, cz)) {
      return s.tick - this.objectiveIssuedTick < AI_MILITARY.reissueTicks * 20;
    }
    return false;
  }

  /**
   * Choose what to hit. Priority is threat, then economy, then production,
   * then anything, then a guess.
   *
   * Threat first because a wave that walks past a tesla coil into a refinery
   * dies to the tesla coil; economy before production because credits are what
   * actually decides a skirmish.
   */
  private pickObjective(): void {
    const sx = this.strikeCount > 0 ? this.groupCentre(true) : this.baseX;
    const sz = this.strikeCount > 0 ? this.groupCentre(false) : this.baseZ;

    let bestScore = -1;
    let bestX = -1, bestZ = -1;

    for (let m = 0; m < this.memCount; m++) {
      const role = this.memRole[m] as BuildRole;
      let value: number;
      switch (role) {
        case BuildRole.Defense:
        case BuildRole.AntiAir: value = 3.0; break;
        case BuildRole.Refinery:
        case BuildRole.Harvester: value = 2.4; break;
        case BuildRole.WarFactory:
        case BuildRole.Barracks: value = 1.8; break;
        case BuildRole.Builder: value = 1.6; break;
        case BuildRole.Power: value = 1.3; break;
        default: value = 0.8; break;
      }
      // Distance discount, in units of "the map is 512 m across".
      const score = value / (1 + dist2(sx, sz, this.memX[m], this.memZ[m]) / 120);
      if (score > bestScore) { bestScore = score; bestX = this.memX[m]; bestZ = this.memZ[m]; }
    }

    // Nothing remembered: aim at the hottest mobile threat we can see, then at
    // the mirrored start position, which is where an RTS map puts the enemy.
    if (bestX < 0) {
      let hot = -1, hotV = 0.01;
      for (let c = 0; c < THREAT_CELLS; c++) {
        if (this.threatGrid[c] > hotV) { hotV = this.threatGrid[c]; hot = c; }
      }
      if (hot >= 0) {
        bestX = ((hot % THREAT_DIM) + 0.5) * THREAT_BUCKET_METRES;
        bestZ = (Math.floor(hot / THREAT_DIM) + 0.5) * THREAT_BUCKET_METRES;
      } else if (this.enemyBaseX >= 0) {
        bestX = this.enemyBaseX; bestZ = this.enemyBaseZ;
      } else {
        bestX = clamp(MAP_SIZE - this.baseX, CELL, MAP_SIZE - CELL);
        bestZ = clamp(MAP_SIZE - this.baseZ, CELL, MAP_SIZE - CELL);
      }
    }

    this.objectiveX = bestX;
    this.objectiveZ = bestZ;
  }

  /** Everything, everywhere, at the nearest enemy thing. */
  private crippledOffensive(s: SimContext): void {
    this.posture = AiPosture.Crippled;
    this.militaryGoal = 'no construction yard — attacking with everything';
    // Collapse the reserve: there is no base left to reserve for.
    for (let a = 0; a < this.armyCount; a++) {
      const i = this.store.index(this.armyIds[a] as EntityId);
      if (i >= 0) this.groupTag.setAt(i, GROUP_STRIKE);
    }
    this.pickObjective();
    if (s.tick - this.objectiveIssuedTick < AI_MILITARY.reissueTicks) return;
    if (this.moveGroup(this.armyIds, this.armyCount, OrderKind.AttackMove,
      this.objectiveX, this.objectiveZ)) {
      this.objectiveIssuedTick = s.tick;
    }
  }

  /** Mean X (`xAxis`) or Z of the live strike group. */
  private groupCentre(xAxis: boolean): number {
    const st = this.store;
    let sum = 0, n = 0;
    for (let k = 0; k < this.strikeCount; k++) {
      const i = st.index(this.strikeIds[k] as EntityId);
      if (i < 0) continue;
      sum += xAxis ? st.posX[i] : st.posZ[i];
      n++;
    }
    if (n > 0) return sum / n;
    return xAxis ? this.baseX : this.baseZ;
  }

  /* ======================================================================
   * 2.8 SCOUTING
   * ====================================================================== */

  private scout(s: SimContext): void {
    if (s.tick < this.nextScoutTick) return;

    const st = this.store;
    let i = st.index(this.scoutId);
    if (i < 0 || (st.flags[i] & ORDERABLE_REJECT) !== 0) {
      this.scoutId = NONE;
      // Once the enemy base is on the map there is nothing left worth scouting
      // for; the unit is better off in a squad.
      if (this.memCount > 0) {
        this.nextScoutTick = s.tick + AI_SCOUT.repeatTicks;
        return;
      }
      if (!this.chooseScout()) {
        this.nextScoutTick = s.tick + AI_CADENCE.scout;
        return;
      }
      this.buildScoutRoute();
      i = st.index(this.scoutId);
      if (i < 0) return;
    }

    if (this.scoutWaypointCount === 0) this.buildScoutRoute();
    if (this.scoutWaypointCount === 0) return;

    const wx = this.scoutWaypointX[this.scoutWaypoint];
    const wz = this.scoutWaypointZ[this.scoutWaypoint];
    const arrived =
      distSq2(st.posX[i], st.posZ[i], wx, wz) < AI_SCOUT.arriveRadius * AI_SCOUT.arriveRadius;

    if (arrived) {
      this.scoutWaypoint++;
      if (this.scoutWaypoint >= this.scoutWaypointCount) {
        // Route done. Fold the survivor back into the army and go again later.
        this.groupTag.setAt(i, GROUP_NONE);
        this.scoutId = NONE;
        this.scoutWaypointCount = 0;
        this.nextScoutTick = s.tick + AI_SCOUT.repeatTicks;
        return;
      }
    }

    // Re-issue on the scout clock; a scout that walks into a pillbox and stops
    // must be nudged rather than left standing there forever.
    if (arrived || st.state[i] === UnitState.Idle) {
      this.issueOrder(
        OrderKind.Move, this.one(this.scoutId), 1,
        this.scoutWaypointX[this.scoutWaypoint], this.scoutWaypointZ[this.scoutWaypoint], NONE,
      );
    }
  }

  /** Cheapest expendable body available. Fast and fragile wins. */
  private chooseScout(): boolean {
    const st = this.store;
    let best = -1;
    let bestScore = -1;
    for (let a = 0; a < this.armyCount; a++) {
      const i = st.index(this.armyIds[a] as EntityId);
      if (i < 0) continue;
      if ((st.flags[i] & ORDERABLE_REJECT) !== 0) continue;
      if (this.groupTag.getAt(i) === GROUP_SCOUT) continue;
      // Speed gets it across the map; low max HP is the proxy for "this is not
      // a unit I want in the battle line".
      const score = st.maxSpeed[i] * 2 - st.maxHp[i] * 0.01;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return false;
    this.scoutId = st.handleOf(best);
    this.groupTag.setAt(best, GROUP_SCOUT);
    // Scouts must not stop to fight; that is what makes them scouts.
    if (this.spend()) {
      this.commands.issueSetStance(this.player, this.one(this.scoutId), 1, Stance.HoldFire);
    }
    return true;
  }

  /**
   * Route: the mirrored start position first (it is right more often than any
   * other single guess), then the four quadrant centres, skipping anything
   * already explored.
   */
  private buildScoutRoute(): void {
    const q = MAP_SIZE * 0.25;
    const cx = MAP_SIZE - this.baseX, cz = MAP_SIZE - this.baseZ;
    const candX = [cx, q, MAP_SIZE - q, q, MAP_SIZE - q];
    const candZ = [cz, q, q, MAP_SIZE - q, MAP_SIZE - q];

    this.scoutWaypointCount = 0;
    this.scoutWaypoint = 0;
    for (let c = 0; c < candX.length && this.scoutWaypointCount < this.scoutWaypointX.length; c++) {
      const x = clamp(candX[c], CELL * 2, MAP_SIZE - CELL * 2);
      const z = clamp(candZ[c], CELL * 2, MAP_SIZE - CELL * 2);
      // Scouting a corner already mapped is pure waste, and the vision port is
      // the only source of that answer.
      if (c > 0 && this.world.vision.isExplored(
        this.player, clampCell(worldToCell(x)), clampCell(worldToCell(z)))) continue;
      this.scoutWaypointX[this.scoutWaypointCount] = x;
      this.scoutWaypointZ[this.scoutWaypointCount] = z;
      this.scoutWaypointCount++;
    }
  }

  /* ======================================================================
   * 2.8b THE NAVY — holding the water, and crossing it
   *
   * WHAT WAS ACTUALLY MISSING, and it was one level below the brain. `grep -n
   * naval src/sim/AI.ts` returned nothing, but so did `grep -n navalYard
   * src/sim/AIStrategy.ts`: the AI's catalog had no row for a dock, a troop
   * hull or a warship, and `bindOracle` only ever resolves a `publicId` for a
   * key that IS in that array. The opponent did not decline to build a navy. It
   * had no word for one, and could not have named a dock in a `ProductionStart`
   * if every heuristic in this file had told it to.
   *
   * THE GEOMETRY, MEASURED, BECAUSE IT DECIDES WHAT THIS LAYER MAY DO.
   * Both shipped sea maps, real generator, real `FlowFieldCache`:
   *
   *                       land regions   A->B on land   water on the A->B line
   *     contested-strait   1 (100%)       68 cells       0
   *     coral-shore        1 (100%)       68 cells       0
   *
   * The land is ONE region: nothing on either map is unreachable on foot, and
   * the straight line between the two openings never touches water. That is not
   * an accident of the seed — `MAP_SEAS` derives its waterline from the
   * perpendicular bisector of the two openings precisely so both armies are
   * equidistant from it, which puts the sea off a FLANK by construction. A
   * measured landing on either map costs 104-113 cells against 68 on foot.
   *
   * So this layer has TWO jobs and only one of them fires today:
   *
   *   HOLD THE WATER   always, where there is water. A quarter of both maps is
   *                    sea that currently belongs to whoever sails on it, which
   *                    is nobody. Escorts deny it. This is live.
   *   CROSS IT         only when crossing is measurably shorter than walking,
   *                    or when walking is impossible outright. On both shipped
   *                    maps this correctly REFUSES, and `amphibVerdict` says so
   *                    in numbers rather than staying silent about it.
   *
   * Gating the crossing on a measured saving is the whole design. An AI that
   * ran a landing on `contested-strait` would be visibly playing badly, and
   * "the feature is in there somewhere" is not worth that.
   *
   * EVERY ORDER BELOW IS THE PLAYER'S ORDER. Boarding is `OrderKind.Enter`
   * addressed to the hull — what `input/Commands.ts` resolves from a
   * right-click on a friendly transport. Unloading is `OrderKind.Unload`
   * carrying the hull as its own target — what the D key issues. The crossing
   * is a plain Move. `sim/Transport.ts` refuses this brain exactly as it
   * refuses a human, and `refusalFor` is the same function both go through.
   * ====================================================================== */

  /**
   * The navy, on the squad clock.
   *
   * Orders only. Everything this layer BUYS is scored in `considerNavy`, on the
   * build clock, through the one queueing path — the same split `deploy` and
   * `build` already keep.
   */
  private navy(s: SimContext): void {
    if (!this.navalMap) {
      this.navalGoal = '';
      this.amphibWanted = false;
      return;
    }
    this.holdTheLane(s);
    // The verdict is computed HERE and cached, not asked at each use. Two
    // callers want it — this layer, to stage an operation, and `considerNavy`
    // on the build clock, to decide whether a 900-credit hull has a job — and
    // the ring search behind it is bounded but not free: a map with no beach
    // near the objective walks every ring of it before answering no.
    if (this.amphib === AmphibState.Idle
      && s.tick - this.amphibEvalTick >= AI_NAVAL.evalTicks) {
      this.amphibEvalTick = s.tick;
      this.amphibWanted = this.amphibiousWanted();
    }
    this.runAmphibious(s);
  }

  /**
   * Count the sea around the base, and find our own beach.
   *
   * Probed ONCE and cached, because water is the one thing on the map that
   * cannot be built, sold or destroyed. It is re-probed only when the base has
   * genuinely moved — a second yard across the map is a different coast — and
   * that is a comparison against the last probe's own anchor rather than a
   * timer, so a stationary base pays for this exactly once per match.
   */
  private probeSea(): void {
    const nav = getNav();
    if (nav === null) { this.seaCells = 0; this.navalMap = false; return; }

    // THE MAP QUESTION IS NOT THE BASE QUESTION, and they are asked separately
    // because they fail differently. `mapSupportsNaval()` is the shared
    // predicate — the largest contiguous body the real `FlowFieldCache` routes
    // `MoveClass.Naval` through — and it is the same answer the build menu is
    // entitled to. It is two array reads over a labelling the cost grid keeps
    // anyway, so it is asked every census and never cached.
    //
    // A map with no sea gets NOTHING: no yard, no hull, no ferry. Buying a dock
    // on `airbase-flats` (0 water cells) is a 1000-credit building whose only
    // output is a warship that sits on dry land, and that is a regression on
    // four shipped maps rather than a missed opportunity on two.
    this.navalMap = mapSupportsNaval(this.world.terrain);
    if (!this.navalMap) {
      this.seaCells = 0;
      this.shoreCx = -1; this.shoreCz = -1;
      return;
    }
    this.seaCells = navigableSeaCells();

    // The BEACH is per-base and does need caching: it is a ring walk, and it
    // only changes when the base does.
    const moved = AI_NAVAL.seaSearchCells * CELL * 0.25;
    if (this.shoreCx >= 0
      && distSq2(this.baseX, this.baseZ, this.seaProbeX, this.seaProbeZ) < moved * moved) return;

    this.seaProbeX = this.baseX;
    this.seaProbeZ = this.baseZ;
    const bx = clampCell(worldToCell(this.baseX));
    const bz = clampCell(worldToCell(this.baseZ));
    if (this.findShore(bx, bz, this.shoreOut)) {
      this.shoreCx = this.shoreOut[0];
      this.shoreCz = this.shoreOut[1];
    } else {
      this.shoreCx = -1; this.shoreCz = -1;
    }
  }

  /**
   * Nearest BEACH to a cell: foot-passable land that touches open sea.
   *
   * Both halves are required and each one alone is a different bug. Land that
   * does not touch water is not a beach, so a squad ordered there waits for a
   * hull that can never reach it. Water that does not touch land is not a beach
   * either — `Transport.place` walks a widening ring asking
   * `isPassable(_, _, Locomotor.Foot)` and refuses the unload when nothing in
   * it is standable, so a hull told to land in open sea keeps its cargo and the
   * operation stalls with the squad still aboard.
   *
   * Rings are walked in a fixed order and the first hit wins, so two runs of
   * one seed choose the same beach.
   */
  private findShore(cx: number, cz: number, out: Int32Array): boolean {
    const nav = getNav();
    if (nav === null) return false;
    for (let r = 0; r <= AI_NAVAL.shoreSearchCells; r++) {
      for (let d = -r; d <= r; d++) {
        if (this.isShore(nav, cx + d, cz - r, out)) return true;
        if (this.isShore(nav, cx + d, cz + r, out)) return true;
      }
      for (let d = -r + 1; d <= r - 1; d++) {
        if (this.isShore(nav, cx - r, cz + d, out)) return true;
        if (this.isShore(nav, cx + r, cz + d, out)) return true;
      }
    }
    return false;
  }

  private isShore(
    nav: NonNullable<ReturnType<typeof getNav>>, cx: number, cz: number, out: Int32Array,
  ): boolean {
    if (cx < 1 || cz < 1 || cx >= MAP_CELLS - 1 || cz >= MAP_CELLS - 1) return false;
    if (!nav.isPassableClass(cx, cz, MoveClass.Foot)) return false;
    // THE WATER IT TOUCHES MUST BE THE SEA, not a pond. `contested-strait`
    // labels 6 naval regions — one body of 3973 cells and 15 cells of puddle
    // spread over five more — and the nearest wet cell to a base is quite
    // capable of being a puddle. A beach on one is a beach no hull can reach,
    // and it made every amphibious evaluation refuse with "the two beaches are
    // not on the same sea" before the measurement that was supposed to decide
    // it ever ran. Refusing for a true reason and refusing for the right reason
    // are different things, and only the second one tells you anything.
    const main = nav.mainRegion(MoveClass.Naval);
    if (main <= 0) return false;
    // BOTH CELLS COME OUT OF THIS, and the second one is the one the hull is
    // actually given. A beach is a LAND cell, so its own naval region is 0 —
    // asking `isReachable(beachA, beachB, MoveClass.Naval)` compares two zeroes
    // and answers false for every pair on the map. That is exactly what it did:
    // every evaluation refused with "the two beaches are not on the same sea"
    // and the measurement that was supposed to decide the operation never ran.
    //
    // Requiring the adjacent water to be the MAIN region makes "same sea" true
    // by construction, so there is no reachability call left to get wrong, and
    // it hands back a wet cell a ship can be ordered to.
    if (nav.regionOf(cx - 1, cz, MoveClass.Naval) === main) { out[2] = cx - 1; out[3] = cz; }
    else if (nav.regionOf(cx + 1, cz, MoveClass.Naval) === main) { out[2] = cx + 1; out[3] = cz; }
    else if (nav.regionOf(cx, cz - 1, MoveClass.Naval) === main) { out[2] = cx; out[3] = cz - 1; }
    else if (nav.regionOf(cx, cz + 1, MoveClass.Naval) === main) { out[2] = cx; out[3] = cz + 1; }
    else return false;
    out[0] = cx; out[1] = cz;
    return true;
  }

  /**
   * Keep the escorts on the water between our coast and the enemy's.
   *
   * `AttackMove`, not `Move`, and not a patrol route: the point of a hull on
   * open water is that anything trying to cross has to go through it, and
   * AttackMove is the order that makes a unit stop and shoot on the way. A
   * route would look busier and deny less.
   *
   * The station is the midpoint of our beach and the objective, snapped to a
   * naval cell. When there is no objective yet it is our own beach, which is
   * the correct default: an escort with nothing to escort belongs where our own
   * coast can be raided.
   */
  private holdTheLane(s: SimContext): void {
    if (this.warshipCount === 0 || this.shoreCx < 0) return;
    const nav = getNav();
    if (nav === null) return;

    const tx = this.objectiveX >= 0 ? this.objectiveX : cellToWorld(this.shoreCx);
    const tz = this.objectiveZ >= 0 ? this.objectiveZ : cellToWorld(this.shoreCz);
    const midCx = clampCell(worldToCell((cellToWorld(this.shoreCx) + tx) * 0.5));
    const midCz = clampCell(worldToCell((cellToWorld(this.shoreCz) + tz) * 0.5));

    // Snap onto water the ships can actually occupy. `nearestInRegion` against
    // the sea's own region is what stops the station landing in a bay the fleet
    // cannot enter from where it is.
    const region = nav.regionOf(this.shoreCx, this.shoreCz, MoveClass.Naval) > 0
      ? nav.regionOf(this.shoreCx, this.shoreCz, MoveClass.Naval)
      : nav.mainRegion(MoveClass.Naval);
    if (!nav.nearestInRegion(midCx, midCz, region, MoveClass.Naval, this.shoreOut)) return;

    this.stationX = cellToWorld(this.shoreOut[0]);
    this.stationZ = cellToWorld(this.shoreOut[1]);
    this.navalGoal = `${this.warshipCount} hull(s) holding the lane`;

    if (s.tick - this.lastStationTick < AI_MILITARY.reissueTicks) return;
    this.lastStationTick = s.tick;
    this.moveGroup(
      this.warshipIds, this.warshipCount, OrderKind.AttackMove, this.stationX, this.stationZ,
    );
  }

  /* ----------------------------------------------------------------------
   * The amphibious operation
   * -------------------------------------------------------------------- */

  /**
   * Is a landing the right answer to the current objective, and where?
   *
   * ONE ARM, and it is the one this whole layer was asked for:
   *
   *   IMPOSSIBLE ON FOOT. `FlowFieldCache.isReachable` is an exact answer, not
   *     an estimate — two cost-grid region labels compared — so "there is no
   *     way there" is decided by the same labelling the pathfinder routes on.
   *     A wave sent at a target in another region does not path badly, it
   *     grinds into the nearest cliff and stays there. This arm is the reason
   *     `deploy` already writes sites off as unreachable, and it is the same
   *     mechanism reused rather than a second one invented.
   *
   * THERE USED TO BE A SECOND ARM AND IT COULD NOT FIRE. "Shorter by sea"
   * compared `|G->O|` — the straight line from the group to the objective —
   * against `|G->E| + |E->L| + |L->O|`, the three legs of the crossing over the
   * SAME TWO ENDPOINTS. The triangle inequality makes the second at least as
   * long as the first for every pair of intermediate points, on every map, at
   * every tick, so `saving` was never positive and `saving < 12` was a constant
   * `true`. It read as a measurement — it even published its numbers into
   * `amphibVerdict` — and it decided nothing. It is deleted rather than tuned,
   * because no value of the threshold makes an always-negative quantity clear
   * it.
   *
   * WHAT A REAL SECOND ARM WOULD NEED is a LAND leg that is a route rather than
   * a chord: a flood fill over `MoveClass` from the group to the objective, so
   * that a walk around a bay can be longer than the crossing that skips it.
   * `FlowFieldCache` labels regions but does not publish a distance, so that is
   * a new capability, not a re-tuning — and until it exists "can I walk there at
   * all" is the only honest question this function can ask.
   *
   * Writes `embarkX/Z` and `landX/Z` on success, and `amphibVerdict` always says
   * what it decided: "the AI did not do an amphibious assault" is a mystery,
   * "the objective is reachable on foot" is an answer.
   */
  private amphibiousWanted(): boolean {
    this.amphibVerdict = '';
    const nav = getNav();
    if (nav === null || this.shoreCx < 0) { this.amphibVerdict = 'no coast'; return false; }
    if (this.objectiveX < 0) { this.amphibVerdict = 'no objective'; return false; }

    const gx = this.strikeCount > 0 ? this.groupCentre(true) : this.baseX;
    const gz = this.strikeCount > 0 ? this.groupCentre(false) : this.baseZ;
    const acx = clampCell(worldToCell(gx));
    const acz = clampCell(worldToCell(gz));
    const ocx = clampCell(worldToCell(this.objectiveX));
    const ocz = clampCell(worldToCell(this.objectiveZ));

    // A beach on the objective's side. Without one there is nowhere to put the
    // squad down, and `Transport.place` would refuse the unload anyway.
    if (!this.findShore(ocx, ocz, this.shoreOut)) {
      this.amphibVerdict = 'no beach near the objective';
      return false;
    }
    // THE TWO ENDS ARE NOT SYMMETRIC, and this is the asymmetry that makes the
    // operation work at all.
    //
    // EMBARK ON THE BEACH — the LAND cell. Every troop hull in the game is
    // `Locomotor.Hover`, so it can sit on the sand, and the squad simply walks
    // up to it. Holding the hull on the water instead put it a cell offshore
    // and the boarding stalled at `0/5` forever: infantry path with
    // `MoveClass.Foot`, their goal snaps back to the last dry cell, and they
    // stand on the beach looking at a ship they never quite reach.
    //
    // UNLOAD FROM THE WATER — the wet cell beside the far beach. That end has
    // to be wet because a hostile shore is defended and a hull that beaches
    // itself is a stationary target; `Transport.place` already walks a widening
    // ring asking `isPassable(_, _, Locomotor.Foot)`, so it finds the sand from
    // there. Both wet cells are in the MAIN naval region by construction (see
    // `isShore`), so the crossing is one sea and there is nothing left to ask.
    this.embarkX = cellToWorld(this.shoreCx);
    this.embarkZ = cellToWorld(this.shoreCz);
    this.landX = cellToWorld(this.shoreOut[2]);
    this.landZ = cellToWorld(this.shoreOut[3]);

    // THE ONE ARM: can the army we would otherwise send even get there?
    const cls = this.strikeMoveClass();
    if (!nav.isReachable(acx, acz, ocx, ocz, cls)) {
      this.amphibVerdict = 'objective unreachable on land — the sea is the only way';
      return true;
    }
    // It can walk. The crossing is still measured and reported, because the
    // distance is what a second arm would one day be built out of and a silent
    // refusal is the thing this verdict string exists to prevent.
    const crossing = dist2(this.embarkX, this.embarkZ, this.landX, this.landZ) / CELL;
    this.amphibVerdict =
      `reachable on foot (${(dist2(gx, gz, this.objectiveX, this.objectiveZ) / CELL).toFixed(0)}`
      + ` cells) — no landing needed; the crossing would be ${crossing.toFixed(0)}`;
    return false;
  }

  /**
   * The move class of the group a landing would replace.
   *
   * Taken from a real member rather than assumed, because "can the army get
   * there" is a different question for infantry, for tracks and for the Pact's
   * entirely amphibious roster — a Meridian brain asking about `Track` would be
   * told it cannot reach ground its own units hover straight over.
   */
  private strikeMoveClass(): MoveClass {
    const st = this.store;
    for (let k = 0; k < this.strikeCount; k++) {
      const i = st.index(this.strikeIds[k] as EntityId);
      if (i >= 0) return moveClassAt(st, i);
    }
    return MoveClass.Track;
  }

  /**
   * Drive one operation from boarding to landing.
   *
   * A STATE MACHINE WITH AN ABANDON CLOCK ON EVERY STATE, which is the same
   * lesson `deploy` records at length: a step that can silently fail forever
   * (a squad that cannot reach the beach, a hull wedged on a headland) has to
   * be able to give up, or the AI spends the rest of the match holding units
   * out of its army for an operation that is never going to happen.
   */
  private runAmphibious(s: SimContext): void {
    const st = this.store;

    if (this.amphib === AmphibState.Idle) {
      if (!this.amphibWanted || this.transportCount === 0) return;
      // The landing party comes OUT of the strike group, so it may only be
      // taken once the group can still reach its threshold without them.
      // Otherwise every hull built guarantees a wave that never launches.
      if (this.strikeCount < AI_NAVAL.minLandingSquad + this.waveThreshold()) return;
      this.stageAmphibious(s);
      return;
    }

    // The hull is the operation. Losing it ends it, and the squad aboard went
    // down with it — `TransportService.killPassengers` already charged them.
    const h = st.index(this.amphibHull);
    if (h < 0) {
      this.navalGoal = 'the transport was sunk — operation over';
      this.abandonAmphibious();
      return;
    }

    switch (this.amphib) {
      case AmphibState.Boarding: this.amphibBoarding(s, h); return;
      case AmphibState.Crossing: this.amphibCrossing(s, h); return;
      case AmphibState.Landing: this.amphibLanding(s, h); return;
      default: return;
    }
  }

  /** Commit a hull and a squad, and send both to the embarkation beach. */
  private stageAmphibious(s: SimContext): void {
    const st = this.store;
    const svc = transportService();
    if (svc === null) return;

    // An empty hull with the most seats. A hull already carrying somebody is
    // mid-operation by definition and must not be restarted underneath itself.
    let hull = NONE;
    let seats = 0;
    for (let k = 0; k < this.transportCount; k++) {
      const id = this.transportIds[k] as EntityId;
      const i = st.index(id);
      if (i < 0 || (st.flags[i] & ORDERABLE_REJECT) !== 0) continue;
      const cap = svc.capacityAt(i);
      if (cap <= seats || svc.passengerCount(id) > 0) continue;
      seats = cap; hull = id;
    }
    if (hull === NONE || seats <= 0) return;

    // Infantry only: `TransportService.refusalFor` answers 'not infantry' for
    // anything else, and asking it here rather than assuming is what keeps this
    // brain's idea of who can board identical to the human's.
    this.amphibSquadCount = 0;
    for (let k = 0; k < this.strikeCount && this.amphibSquadCount < seats; k++) {
      const id = this.strikeIds[k] as EntityId;
      const i = st.index(id);
      if (i < 0 || (st.flags[i] & ORDERABLE_REJECT) !== 0) continue;
      if (svc.refusalFor(hull, i) !== '') continue;
      if (this.amphibSquadCount >= this.amphibSquad.length) break;
      this.amphibSquad[this.amphibSquadCount++] = id as number;
    }
    if (this.amphibSquadCount < AI_NAVAL.minLandingSquad) {
      this.amphibSquadCount = 0;
      this.amphibVerdict = 'no infantry free to land with';
      return;
    }

    // Out of the strike group, so `regroupSquads` leaves them alone and
    // `pressAttack` does not walk them at the land objective mid-boarding.
    for (let k = 0; k < this.amphibSquadCount; k++) {
      const i = st.index(this.amphibSquad[k] as EntityId);
      if (i >= 0) this.groupTag.setAt(i, GROUP_NAVAL);
    }

    this.amphibHull = hull;
    this.amphib = AmphibState.Boarding;
    this.amphibTick = s.tick;
    this.amphibIssuedTick = -1e9;
    this.navalGoal = `staging a landing: ${this.amphibSquadCount} aboard for `
      + `${this.landX.toFixed(0)},${this.landZ.toFixed(0)}`;
  }

  /**
   * Walk the squad onto the hull at the beach.
   *
   * The hull is sent to the embarkation point and the squad is given
   * `OrderKind.Enter` against it. `TransportService.board` then rewrites each
   * man's order point to the hull's CURRENT position every tick, so this does
   * not have to chase a moving ship — that is the one behaviour the transport
   * service has that a garrison does not, and it is why boarding needs one
   * command rather than a re-issue loop.
   */
  private amphibBoarding(s: SimContext, h: number): void {
    const st = this.store;
    const svc = transportService();
    if (svc === null) { this.abandonAmphibious(); return; }

    const aboard = svc.passengerCount(this.amphibHull);
    const waiting = this.liveSquadCount();

    // Everybody who is still alive is aboard: sail.
    if (aboard > 0 && waiting === 0) {
      this.amphib = AmphibState.Crossing;
      this.amphibTick = s.tick;
      this.amphibIssuedTick = -1e9;
      this.navalGoal = `${aboard} aboard — crossing to `
        + `${this.landX.toFixed(0)},${this.landZ.toFixed(0)}`;
      return;
    }

    if (s.tick - this.amphibTick > AI_NAVAL.boardTicks) {
      // Boarding stalled. If anyone made it aboard the operation is still worth
      // running with a short squad; if nobody did, the beach is unreachable and
      // holding the squad out of the army any longer is pure loss.
      if (aboard > 0) {
        this.amphib = AmphibState.Crossing;
        this.amphibTick = s.tick;
        this.amphibIssuedTick = -1e9;
        return;
      }
      this.navalGoal = 'nobody could reach the hull — landing abandoned';
      this.abandonAmphibious();
      return;
    }

    this.navalGoal = `boarding ${aboard}/${aboard + waiting} at the beach`;
    if (s.tick - this.amphibIssuedTick < AI_MILITARY.reissueTicks) return;
    this.amphibIssuedTick = s.tick;

    // THE HULL BRINGS ITSELF IN NOW, and this is where it used to be done by
    // hand. `TransportService.callHullIn` runs off the same `OrderKind.Enter`
    // the squad below is about to receive, so the brain and a player's click go
    // through one mechanism instead of two that can disagree.
    //
    // The old code steered the hull onto `embarkX/embarkZ`, a LAND cell, which
    // was correct only while carriers were amphibious. They are `waterOnly`
    // now — see `BuildEntry.waterOnly` — so that destination is unreachable and
    // the move would have failed silently, every reissue, for the whole
    // `boardTicks` window.

    // One Enter for the whole squad — one command for a group, exactly as a
    // human right-clicking a hull with a box selection produces one.
    let n = 0;
    for (let k = 0; k < this.amphibSquadCount; k++) {
      const i = st.index(this.amphibSquad[k] as EntityId);
      if (i < 0) continue;
      const f = st.flags[i];
      if ((f & ORDERABLE_REQUIRE) !== ORDERABLE_REQUIRE) continue;
      if ((f & ORDERABLE_REJECT) !== 0) continue;
      this.orderScratch[n++] = this.amphibSquad[k];
    }
    if (n > 0) {
      this.issueOrder(
        OrderKind.Enter, this.orderScratch, n, st.posX[h], st.posZ[h], this.amphibHull,
      );
    }
  }

  /** Sail the loaded hull to the hostile beach. */
  private amphibCrossing(s: SimContext, h: number): void {
    const st = this.store;
    const svc = transportService();
    if (svc === null) { this.abandonAmphibious(); return; }

    if (svc.passengerCount(this.amphibHull) === 0) {
      this.navalGoal = 'the squad is gone — crossing abandoned';
      this.abandonAmphibious();
      return;
    }

    const arrive = AI_NAVAL.landingArriveMetres * AI_NAVAL.landingArriveMetres;
    if (distSq2(st.posX[h], st.posZ[h], this.landX, this.landZ) <= arrive) {
      this.amphib = AmphibState.Landing;
      this.amphibTick = s.tick;
      this.amphibIssuedTick = -1e9;
      return;
    }

    if (s.tick - this.amphibTick > AI_NAVAL.crossTicks) {
      // The hull could not get there. Put the squad back on OUR shore rather
      // than sailing forever — an Unload where it stands is refused when there
      // is no standable ground, which is exactly the right failure.
      this.navalGoal = 'the crossing timed out — putting the squad ashore';
      this.amphib = AmphibState.Landing;
      this.landX = st.posX[h];
      this.landZ = st.posZ[h];
      this.amphibTick = s.tick;
      this.amphibIssuedTick = -1e9;
      return;
    }

    this.navalGoal = `crossing — ${svc.passengerCount(this.amphibHull)} aboard`;
    if (s.tick - this.amphibIssuedTick < AI_MILITARY.reissueTicks) return;
    this.amphibIssuedTick = s.tick;
    this.issueOrder(OrderKind.Move, this.one(this.amphibHull), 1, this.landX, this.landZ, NONE);
  }

  /**
   * Put the squad ashore and hand it back to the army.
   *
   * The order carries the hull as its own target, which is the shape
   * `input.system.ts:issueUnload` produces. A refusal is not an error and is
   * deliberately not treated as one: `unloadOrders` leaves the order standing
   * for one more tick when no ring cell is standable, so a hull that arrived a
   * few metres off the beach puts its squad down as soon as it touches one.
   */
  private amphibLanding(s: SimContext, h: number): void {
    const st = this.store;
    const svc = transportService();
    if (svc === null) { this.abandonAmphibious(); return; }

    if (svc.passengerCount(this.amphibHull) === 0) {
      // Everybody is off. THIS is the landing, and it is the only place the
      // counter moves.
      this.landingsMade++;
      this.navalGoal = `landed at ${this.landX.toFixed(0)},${this.landZ.toFixed(0)}`;
      // Straight onto the objective: they are behind whatever was holding the
      // land route, which is the entire point of having sailed.
      let n = 0;
      for (let k = 0; k < this.amphibSquadCount; k++) {
        const i = st.index(this.amphibSquad[k] as EntityId);
        if (i < 0) continue;
        // Back into the ordinary strike group — `regroupSquads` picks up an
        // untagged body on its next pass.
        this.groupTag.setAt(i, GROUP_NONE);
        const f = st.flags[i];
        if ((f & ORDERABLE_REQUIRE) !== ORDERABLE_REQUIRE) continue;
        if ((f & ORDERABLE_REJECT) !== 0) continue;
        this.orderScratch[n++] = this.amphibSquad[k];
      }
      if (n > 0 && this.objectiveX >= 0) {
        this.issueOrder(
          OrderKind.AttackMove, this.orderScratch, n, this.objectiveX, this.objectiveZ, NONE,
        );
      }
      this.amphib = AmphibState.Idle;
      this.amphibHull = NONE;
      this.amphibSquadCount = 0;
      return;
    }

    if (s.tick - this.amphibTick > AI_NAVAL.boardTicks) {
      this.navalGoal = 'no standable beach — the squad rides on';
      this.abandonAmphibious();
      return;
    }

    this.navalGoal = `unloading at ${this.landX.toFixed(0)},${this.landZ.toFixed(0)}`;
    if (s.tick - this.amphibIssuedTick < AI_MILITARY.reissueTicks) return;
    this.amphibIssuedTick = s.tick;
    this.issueOrder(
      OrderKind.Unload, this.one(this.amphibHull), 1,
      st.posX[h], st.posZ[h], this.amphibHull,
    );
  }

  /** Squad members still alive and NOT yet aboard. */
  private liveSquadCount(): number {
    const st = this.store;
    let n = 0;
    for (let k = 0; k < this.amphibSquadCount; k++) {
      const i = st.index(this.amphibSquad[k] as EntityId);
      if (i < 0) continue;
      if ((st.flags[i] & EntityFlag.Garrisoned) !== 0) continue;
      n++;
    }
    return n;
  }

  /** Release everybody back to the army and clear the operation. */
  private abandonAmphibious(): void {
    const st = this.store;
    for (let k = 0; k < this.amphibSquadCount; k++) {
      const i = st.index(this.amphibSquad[k] as EntityId);
      if (i >= 0 && this.groupTag.getAt(i) === GROUP_NAVAL) this.groupTag.setAt(i, GROUP_NONE);
    }
    this.amphib = AmphibState.Idle;
    this.amphibHull = NONE;
    this.amphibSquadCount = 0;
    this.amphibIssuedTick = -1e9;
  }

  /* ======================================================================
   * 2.9 COMMAND PLUMBING — the only exit from this class
   * ====================================================================== */

  /** Spend one action from the APM budget. False when the brain is out. */
  private spend(): boolean {
    if (this.budget < 1) return false;
    this.budget -= 1;
    this.commandsIssued++;
    return true;
  }

  /** One-element order buffer, reused. Never retained by the bus. */
  private one(h: EntityId): Int32Array {
    this.orderScratch[0] = h as number;
    return this.orderScratch;
  }

  private issueOrder(
    order: OrderKind, ids: Int32Array, count: number,
    x: number, z: number, target: EntityId,
  ): boolean {
    if (count <= 0 || !this.spend()) return false;
    this.commands.issueOrder(this.player, order, ids, count, x, z, target, false);
    return true;
  }

  /**
   * Order a whole group. ONE command for the group, exactly like one click from
   * a human with a box selection — the AI does not get N commands for N units.
   */
  private moveGroup(
    ids: Int32Array, count: number, order: OrderKind, x: number, z: number,
  ): boolean {
    const st = this.store;
    let n = 0;
    for (let k = 0; k < count; k++) {
      const i = st.index(ids[k] as EntityId);
      if (i < 0) continue;
      const f = st.flags[i];
      if ((f & ORDERABLE_REQUIRE) !== ORDERABLE_REQUIRE) continue;
      if ((f & ORDERABLE_REJECT) !== 0) continue;
      this.orderScratch[n++] = ids[k];
    }
    return this.issueOrder(order, this.orderScratch, n, x, z, NONE);
  }

  /**
   * Send only the units that are not already going there. This is the
   * difference between an AI that costs 3 commands a second and one that costs
   * 300 — and re-ordering a moving unit every squad tick also makes it stutter.
   */
  private gatherIdle(ids: Int32Array, count: number, x: number, z: number): boolean {
    const st = this.store;
    const arrive = AI_MILITARY.arriveRadius * AI_MILITARY.arriveRadius;
    let n = 0;
    for (let k = 0; k < count; k++) {
      const i = st.index(ids[k] as EntityId);
      if (i < 0) continue;
      const f = st.flags[i];
      if ((f & ORDERABLE_REQUIRE) !== ORDERABLE_REQUIRE) continue;
      if ((f & ORDERABLE_REJECT) !== 0) continue;
      if (st.state[i] !== UnitState.Idle && st.state[i] !== UnitState.Guarding) continue;
      if (distSq2(st.posX[i], st.posZ[i], x, z) < arrive) continue;
      this.orderScratch[n++] = ids[k];
    }
    if (n === 0) return false;
    return this.issueOrder(OrderKind.Move, this.orderScratch, n, x, z, NONE);
  }

  /* ======================================================================
   * 2.10 DIAGNOSTICS
   * ====================================================================== */

  get postureCode(): number { return this.posture as number; }
  get armySize(): number { return this.armyCount; }
  get strikeSize(): number { return this.strikeCount; }
  get reserveSize(): number { return this.reserveCount; }
  get harvesterSize(): number { return this.harvesterCount; }
  /** Undeployed construction vehicles owned. */
  get mcvSize(): number { return this.mcvCount; }
  /** World position the deploy layer is driving to, or -1 when it is idle. */
  get deployTargetX(): number { return this.deployX; }
  get deployTargetZ(): number { return this.deployZ; }
  get refineryCount(): number { return this.roleCount[BuildRole.Refinery]; }
  get pressure(): number { return this.basePressure; }
  get issuedCount(): number { return this.commandsIssued; }
  get memorySize(): number { return this.memCount; }
  get objectiveXPos(): number { return this.objectiveX; }
  get objectiveZPos(): number { return this.objectiveZ; }
  get wave(): number { return this.waveThreshold(); }
  /**
   * Tick an enemy aircraft was first seen, and the tick one was last seen.
   * -1 for never.
   *
   * Exposed because "did the AI notice the gunship" and "did it act on it" are
   * separate failures with the same symptom — no anti-air — and the whole air
   * layer spent its first life failing the first one invisibly.
   */
  get firstAirSightingTick(): number { return this.firstAirTick; }
  get lastAirSightingTick(): number { return this.sawAirTick; }
  /** Anti-air structures owned or under construction. */
  get antiAirCount(): number {
    return this.roleCount[BuildRole.AntiAir] + this.roleBuilding[BuildRole.AntiAir];
  }

  /**
   * The late game, in numbers nothing else can report.
   *
   * All three are otherwise invisible from outside: a fired superweapon leaves
   * a crater and no record on the brain, a called power leaves nothing at all,
   * and an installed upgrade never becomes an entity so it appears in no census
   * and no structure list. "Did the AI build a silo" is answerable from
   * `intent().structures.superweapon`; "did it ever press the button" is only
   * answerable from here.
   */
  get superweaponFireCount(): number { return this.superweaponsFired; }
  get commanderPowerCount(): number { return this.powersCalled; }
  get upgradeRequestCount(): number { return this.upgradesRequested; }
  /**
   * Commander powers this brain has ASKED for. Same reason the upgrade counter
   * exists: a power produces a bit, so nothing else in the world records that
   * the AI ever tried to buy one.
   */
  get powerBuyCount(): number { return this.powersBought; }
  /** Command Posts owned or under construction. */
  get commandPostCount(): number {
    return this.roleCount[BuildRole.CommandPost] + this.roleBuilding[BuildRole.CommandPost];
  }
  /** Superweapon structures owned or under construction. */
  get superweaponCount(): number {
    return this.roleCount[BuildRole.Superweapon] + this.roleBuilding[BuildRole.Superweapon];
  }
  get infantrySize(): number { return this.infantryCount; }
  get vehicleSize(): number { return this.vehicleCount; }

  /**
   * The navy, in numbers nothing else can report.
   *
   * `seaSize` is the one that answers "did this brain even notice the water",
   * which is a different failure from "it noticed and declined" and has the
   * same symptom. `amphibiousVerdict` is the second half of that: a landing
   * that never happens because walking is shorter is a DECISION, and it says so
   * with the measured saving in it rather than leaving the reader to guess
   * whether the code ran at all.
   */
  get seaSize(): number { return this.seaCells; }
  get warshipSize(): number { return this.warshipCount; }
  get transportSize(): number { return this.transportCount; }
  /** Naval yards owned or under construction. */
  get navalYardCount(): number {
    return this.roleCount[BuildRole.NavalYard] + this.roleBuilding[BuildRole.NavalYard];
  }
  /** Landings that actually put a squad on the ground. */
  get landingCount(): number { return this.landingsMade; }
  get amphibiousState(): number { return this.amphib as number; }
  get amphibiousVerdict(): string { return this.amphibVerdict; }

  /**
   * Readable snapshot. Allocates — deliberately: this is called by the console
   * probe and by tests, never by the sim.
   */
  intent(): AiIntent {
    const p = this.world.player(this.player);
    const structures: Record<string, number> = {};
    for (let r = 0; r < this.roleCount.length; r++) {
      if (this.roleCount[r] > 0) structures[BUILD_ROLE_NAMES[r]] = this.roleCount[r];
    }
    const threat: Record<string, number> = {};
    for (let c = 0; c < AI_THREAT_CLASS_COUNT; c++) {
      threat[THREAT_CLASS_NAMES[c]] = Math.round(this.threatMix[c] * 100) / 100;
    }
    return {
      player: this.player as number,
      name: p === undefined ? '?' : p.name,
      faction: FACTION_PALETTE_KEYS[this.faction as number] ?? 'allies',
      difficulty: this.diff.name,
      personality: this.pers.name,
      posture: AI_POSTURE_NAMES[this.posture],
      military: this.militaryGoal,
      economy: this.buildGoal,
      credits: p === undefined ? 0 : Math.round(p.credits),
      power: p === undefined ? 0 : p.powerProduced - p.powerConsumed,
      army: this.armyCount,
      strike: this.strikeCount,
      reserve: this.reserveCount,
      harvesters: this.harvesterCount,
      refineries: this.roleCount[BuildRole.Refinery],
      mcvs: this.mcvCount,
      deploy: this.deployGoal,
      lateGame: this.lateGoal,
      naval: this.navalGoal,
      seaCells: this.seaCells,
      navalYards: this.navalYardCount,
      warships: this.warshipCount,
      transports: this.transportCount,
      landings: this.landingsMade,
      amphibious: this.amphibVerdict,
      superweapons: this.superweaponCount,
      superweaponsFired: this.superweaponsFired,
      powersCalled: this.powersCalled,
      upgradesBought: this.upgradesRequested,
      powersBought: this.powersBought,
      structures,
      threat,
      waveThreshold: this.waveThreshold(),
      objectiveX: Math.round(this.objectiveX),
      objectiveZ: Math.round(this.objectiveZ),
      enemyBaseKnown: this.enemyBaseX >= 0,
      rememberedStructures: this.memCount,
      basePressure: Math.round(this.basePressure * 100) / 100,
      commandsIssued: this.commandsIssued,
      blocked: this.blocked,
    };
  }
}

/* ==========================================================================
 * 3. THE DIRECTOR
 *
 * Owns one brain per non-human player, keeps them in sync with the player list,
 * and is the single object `ai.system.ts` drives.
 * ========================================================================== */

export class AiDirector {
  readonly brains: AiBrain[] = [];
  readonly catalog: BuildCatalog;
  private readonly detachers: (() => void)[] = [];
  private readonly world: World;
  private readonly channels: Channels;
  private oracle: ProductionOracle | null = null;

  constructor(world: World, channels: Channels, catalog = new BuildCatalog()) {
    this.world = world;
    this.channels = channels;
    this.catalog = catalog;
  }

  /**
   * Adopt the production module's tech tree AND its rule engine. This is the
   * preferred binding — see `BuildCatalog.bindOracle`. Returns how many
   * buildables resolved.
   */
  bindProduction(oracle: ProductionOracle): number {
    this.oracle = oracle;
    const n = this.catalog.bindOracle(oracle);
    for (let i = 0; i < this.brains.length; i++) this.brains[i].setOracle(oracle);
    return n;
  }

  /**
   * (Re)build the brain list from `world.players`. Idempotent, and safe to call
   * again after a scenario adds players — an existing brain is kept so its
   * memory survives.
   */
  rebuild(seed: number): void {
    const wanted: number[] = [];
    for (let i = 0; i < this.world.players.length; i++) {
      const p = this.world.players[i];
      if (p.isHuman || p.isLocal) continue;
      // Gaia — the slot that owns rocks, trees and wrecks — is created by
      // `ScenarioBuilder.gaia` as a non-human, non-local player, so "not human"
      // is NOT sufficient. A Neutral player has no faction tech tree, no
      // credits and nothing to command; giving it a brain burns a census sweep
      // per second and publishes an empty opponent to the debug counters.
      if (p.faction === Faction.Neutral) continue;
      wanted.push(p.id as number);
    }
    // Sorted so brain construction order — and therefore RNG stream order — is
    // identical on every machine.
    wanted.sort((a, b) => a - b);

    for (let b = this.brains.length - 1; b >= 0; b--) {
      if (wanted.indexOf(this.brains[b].player as number) >= 0) continue;
      this.detachers[b]();
      this.detachers.splice(b, 1);
      this.brains.splice(b, 1);
    }

    for (let k = 0; k < wanted.length; k++) {
      const id = wanted[k];
      let have = false;
      for (let b = 0; b < this.brains.length; b++) {
        if ((this.brains[b].player as number) === id) { have = true; break; }
      }
      if (have) continue;
      const brain = new AiBrain(
        this.world, this.channels.commands, this.catalog, id as PlayerId, seed,
      );
      brain.setOracle(this.oracle);
      this.detachers.push(brain.attach(this.channels.events));
      this.brains.push(brain);
    }
  }

  /** Adopt a real def table. Safe before or after `rebuild`. */
  bind(lookup: DefLookup | null | undefined): void {
    this.catalog.bind(lookup);
  }

  tick(s: SimContext): void {
    for (let i = 0; i < this.brains.length; i++) this.brains[i].tick(s);
  }

  /** Total commands issued by every brain. */
  get commandsIssued(): number {
    let n = 0;
    for (let i = 0; i < this.brains.length; i++) n += this.brains[i].issuedCount;
    return n;
  }

  /** Readable state for every brain. Allocates; probe/test only. */
  snapshot(): AiIntent[] {
    const out: AiIntent[] = [];
    for (let i = 0; i < this.brains.length; i++) out.push(this.brains[i].intent());
    return out;
  }

  dispose(): void {
    for (let i = 0; i < this.detachers.length; i++) this.detachers[i]();
    this.detachers.length = 0;
    this.brains.length = 0;
  }
}

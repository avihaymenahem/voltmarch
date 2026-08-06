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
 *
 * DETERMINISM: every brain owns a seeded `Rng` derived from the match seed and
 * its player id. No wall clock, no global RNG, no iteration over a Map keyed by
 * anything but insertion order.
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
  BUILD_RADIUS, CELL, MAP_CELLS, MAP_SIZE, MAX_QUEUE_DEPTH, SIM_DT,
} from '../core/config';
import {
  EntityFlag, EntityKind, Faction, FACTION_PALETTE_KEYS, NONE, OrderKind, Stance, UnitState,
} from '../core/types';
import type {
  ArmorClass, EntityId, PlayerId, PlayerState, SimContext,
} from '../core/types';
import { abilities } from './Abilities';
import type { Channels, CommandBus, EventBus } from '../core/events';
import type { EntityStore, World } from '../core/world';
import { PerEntityU32 } from '../core/world';
import { Rng, cellToWorld, clamp, clampCell, dist2, distSq2, hash2i, worldToCell } from '../core/math';
import {
  AI_DEPLOY, BUILD_ROLE_NAMES, BuildCatalog, BuildRole, THREAT_CLASS_NAMES,
  classifyThreat, difficultyProfile, openingFor, personalityProfile, pickUnit,
  prereqsMet,
} from './AIStrategy';
import type {
  CatalogEntry, DefLookup, DifficultyProfile, OpeningStep, PersonalityProfile,
  ProductionOracle,
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
  private readonly inFlight = new Int32Array(4);
  private readonly inFlightTick = new Int32Array(4);
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
  /** Last tick a gather order went out. Rate-limits the rally nudge. */
  private lastGatherTick = -1e9;
  private rallyX = MAP_SIZE * 0.5;
  private rallyZ = MAP_SIZE * 0.5;

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
    this.haveRoleFn = (role: BuildRole) => this.roleCount[role] > 0;
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
      if (t >= 0 && t < 4 && this.inFlight[t] > 0) this.inFlight[t]--;
    }));

    offs.push(events.on('production:cancelled', (e) => {
      if ((e.player as number) !== me) return;
      const t = e.tab as number;
      if (t >= 0 && t < 4 && this.inFlight[t] > 0) this.inFlight[t]--;
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
    // On the squad clock, one slot later: the commander's ability is a combat
    // decision and wants the squad layer's fresh picture of who is near what.
    if (t % AI_CADENCE.squad === 4) this.commanderAbility(s);
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
      if (this.hostilesWithin(st.posX[i], st.posZ[i], spec.radius) < ABILITY_MIN_ENEMIES) continue;

      if (this.issueOrder(
        OrderKind.UseAbility, this.one(id), 1, st.posX[i], st.posZ[i], NONE,
      )) {
        this.abilityIssuedTick = s.tick;
      }
      return;
    }
  }

  /** Living hostiles inside a circle. Counts structures — a base is a target. */
  private hostilesWithin(x: number, z: number, radius: number): number {
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
      hostile++;
    }
    return hostile;
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
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      const kind = st.kind[i];

      if (kind === EntityKind.Building) {
        const role = this.roleOfBuilding(i);
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

      if ((f & EntityFlag.IsHarvester) !== 0) {
        if (this.harvesterCount < this.harvesterIds.length) {
          this.harvesterIds[this.harvesterCount++] = st.handleOf(i) as number;
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
  }

  /**
   * Is this one of ours a construction vehicle that has not unfolded yet?
   *
   * Prefers the catalog, which knows `BuildRole.Mcv` exactly. Without a bound
   * catalog — the state of every headless test — the answer comes from columns
   * that exist regardless of content: a VEHICLE that cannot shoot, does not
   * mine, carries no cargo and is not already deployed. In this game that set is
   * exactly {mcv, mrdCarryall, rclCrawler}: an engineer is Infantry, a
   * harvester carries `IsHarvester`, and a transport has a non-zero `cargoMax`.
   */
  private isUndeployedMcv(i: number, kind: EntityKind, flags: number): boolean {
    if ((flags & EntityFlag.Deployed) !== 0) return false;
    const st = this.store;
    const entry = this.catalog.entryForUnit(st.defId[i]);
    if (entry !== undefined) return entry.role === BuildRole.Mcv;
    return kind === EntityKind.Vehicle
      && (flags & EntityFlag.IsHarvester) === 0
      && st.cargoMax[i] <= 0
      && st.maxSpeed[i] > 0;
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
      if (airborne) this.sawAirTick = s.tick;

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
      AI_ECONOMY.maxHarvesters,
      Math.round(refineries * AI_ECONOMY.harvestersPerRefinery * this.pers.economy),
    );
    // No point buying a harvester with nothing left to mine.
    this.wantHarvesters =
      this.oreStarved && this.expandX < 0 ? 0 : Math.max(0, want - this.harvesterCount);

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
    for (let t = 0; t < 4; t++) {
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

    /* -- 2. anti-air is an interrupt once something has flown over -------- */
    if (this.sawAirTick >= 0 && this.roleCount[BuildRole.AntiAir] < AI_BUILD.maxAntiAir) {
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
    if (refineries < AI_ECONOMY.maxRefineries) {
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

    if (this.bestEntry !== null) {
      this.buildGoal = this.bestGoal;
      return this.bestEntry;
    }

    // Nothing structural is worth building: convert credits into army.
    return this.buildUnits(s, p, false);
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
      this.noteUnavailable(`${entry.key}: ${why === '' ? 'unavailable' : why}`);
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
    if (tab < 0 || tab > 3) return false;
    const p = this.world.player(this.player);
    const queue = p === undefined ? undefined : p.queues[tab];
    const queued = queue === undefined ? 0 : queue.items.length;
    // A structure tab holds one at a time in practice: a second structure
    // cannot be placed until the first one is down.
    const cap = entry.isBuilding ? 1 : AI_BUILD.desiredQueueDepth;
    return queued + this.inFlight[tab] < Math.min(cap, MAX_QUEUE_DEPTH);
  }

  private requestProduction(entry: CatalogEntry, tick: number): void {
    const tab = entry.tab as number;
    if (!this.spend()) return;
    this.commands.issueProductionStart(this.player, entry.tab, entry.defId, 1);
    this.inFlight[tab]++;
    this.inFlightTick[tab] = tick;
    this.blocked = '';
  }

  /* ----------------------------------------------------------------------
   * Structure placement
   * -------------------------------------------------------------------- */

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
    if (role === BuildRole.Refinery && this.expandX >= 0) {
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
        this.waveEscalation = Math.min(AI_SQUAD_MAX, this.waveEscalation + AI_MILITARY.waveEscalation);
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
    const threshold = this.waveThreshold();
    if (this.strikeCount >= threshold) {
      this.pickObjective();
      this.posture = AiPosture.Attacking;
      this.strikeStartCount = this.strikeCount;
      this.objectiveIssuedTick = -1e9;
      this.pressAttack(s);
      return;
    }

    this.posture = this.openingIndex < this.opening.length ? AiPosture.Opening : AiPosture.Massing;
    this.militaryGoal = `massing ${this.strikeCount}/${threshold}`;
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

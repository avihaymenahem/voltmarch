/**
 * ============================================================================
 * VOLTMARCH — src/sim/Harvesting.ts
 * ============================================================================
 * THE HARVESTER LOOP. Idle -> seek -> scoop -> haul -> dock -> unload -> repeat.
 *
 * This is the single most-watched behaviour in the game. A player spends the
 * first ninety seconds of every match doing nothing but looking at harvesters,
 * so every edge here is a visible edge:
 *
 *   - Two harvesters walking to the same cell and one of them arriving to find
 *     nothing reads as broken AI. Hence CLAIMS (see Economy.ts) — a destination
 *     cell is leased, and the lease is time-based so a harvester that explodes
 *     mid-drive cannot leak its reservation.
 *   - A harvester that keeps hauling to a refinery that died two seconds ago
 *     reads as broken AI. Hence the dock target is re-validated every tick, not
 *     cached at departure.
 *   - Two harvesters clipping through each other at one dock reads as broken
 *     rendering. Hence the dock is reserved by exactly one hauler and the
 *     second waits HARVESTER_QUEUE_GAP metres behind it.
 *   - A harvester that stops forever because a wall went up between it and its
 *     cell is the worst of the lot, because nothing on screen explains it.
 *     Hence the stuck detector, which re-plans after HARVESTER_STUCK_SECONDS of
 *     no measurable progress.
 *
 * FILL LEVEL IS FREE TO RENDER
 * ----------------------------
 * `store.cargo / store.cargoMax` is the fill fraction, it is a plain column of
 * the entity store, and it is written here every tick a harvester is scooping.
 * The art module raises the hopper mass, or swaps the emissive, off that number
 * without importing anything from this file.
 *
 * ============================================================================
 * HOW A HARVESTER ACTUALLY MOVES
 * ============================================================================
 * This module decides WHERE, `nav-movement` decides HOW. The seam is
 * `store.orderX/orderZ`: `Steering.seeksGoal()` lists `SeekOre` and
 * `ReturnToRefinery` as goal-consuming states and reads the destination out of
 * those two columns, so publishing a destination there is the whole
 * integration. Nav then owns the flow field, the formation slot, the direct-
 * path shortcut and the arrival park, and its `finishOrder` deliberately
 * refuses to touch `state` for anything but Moving/Fleeing — the harvester FSM
 * stays ours.
 *
 * The ownership table in core/loop.ts assigns orderX/orderZ to Phase.Command.
 * Writing them here is a knowing exception, and it is the same exception nav
 * already documents at its own read site ("we detect the edge by diffing ...
 * so this works no matter who issued it"). The alternative — routing every
 * harvester destination through the CommandBus — would cost a tick of latency
 * per re-target and would put economy intent in the replay log as if a player
 * had clicked it.
 *
 * THE BACKSTOP MOVER
 * ------------------
 * `drive()` is a small point-to-point mover registered separately at
 * Phase.Movement. It has three modes, and the middle one is the important one:
 *
 *   'full'   — no nav module in the registry. This is the only mover, and it
 *              drives every harvester that has somewhere to be.
 *   'assist' — nav is present and owns locomotion. This mover only touches a
 *              harvester nav has stopped asking to move (`velX == velZ == 0`,
 *              which Steering writes explicitly for anything it considers
 *              parked or arrived) while its destination is still further away
 *              than an arrival. That means one specific thing: nav gave up on
 *              this unit. Its stuck detector nudged it three times, decided it
 *              was not getting there, and set AgentFlag.Arrived — which is
 *              sticky until the goal moves. A harvester in that state is
 *              stopped forever, mid-haul, with a full hopper.
 *
 *              THIS PARAGRAPH USED TO SAY "nav has BOTH released
 *              (`navField < 0`) AND stopped asking to move", and the code
 *              matched it. Both were wrong in the same place: a harvester nav
 *              has given up on still reads `navField >= 0`, so the condition
 *              could never be true of the exact unit this mode was written to
 *              rescue, and it never once ran. Measured before the fix: 10 of 12
 *              harvesters parked with full hoppers inside four minutes and
 *              `stats().driven` was 0 for the whole match. See the guard in
 *              `drive()` and `tests/harvester-soak.spec.ts`.
 *
 *              The REASON it reads `>= 0` was mis-stated here as "`finishOrder`
 *              does not release the field". It does release it; the assigner
 *              then re-requests one on the same tick, because the park rung
 *              reports "position unchanged" and the loop falls through to its
 *              own field block. Re-verified on seed 4242 slot 43. The guard in
 *              `drive()` carries the full trace.
 *   'off'    — `setHarvesterDrive(false)`. For when nav wants total ownership.
 *
 * The assist mode is not a workaround for a bug in somebody else's module; it
 * is the answer to a structural question. Giving up on a move order is CORRECT
 * for a tank told to drive into a cliff. It is never correct for a harvester,
 * because the economy is the one loop that must not be allowed to stop. Rather
 * than ask nav to special-case harvesters, the module that owns the harvester
 * owns the guarantee.
 *
 * The mode is chosen once, on the first tick (see economy.system.ts — it cannot
 * be decided from init, because nav registers `sim.movement` from inside its
 * own init, which runs later than this module's).
 *
 * The mover consults `world.terrain.isPassable` and turns at the hull's real
 * turn rate with braking, so it is not "teleport toward the goal". What it
 * deliberately does NOT do is separation, formation or crowd relaxation. Those
 * belong to Steering, and faking them here would be the thing that is genuinely
 * hard to unpick later.
 *
 * ============================================================================
 * §ANCHOR — THE PATCH A HARVESTER IS BOUND TO
 * ============================================================================
 * Reported: "they need to be bound to a specific area, whenever i lead them to
 * some point, they shouldnt go out of a range of it, because sometimes they
 * just suicide and going to enemy camp". Two separate defects were behind it,
 * and both reproduce.
 *
 * DEFECT 1 — THE CHOICE HAD NO MEMORY. `acquireOre` and `rescoreOre` scored the
 * nearest cell within ORE_SEARCH_CELLS (160 m) OF THE HULL, with a
 * `nearestField` fallback that re-centres the search on any field anywhere on
 * the map. Nothing recorded which patch this harvester was supposed to be
 * working, so each re-score was a fresh 160 m step from wherever the last one
 * left it — a memoryless random walk. Measured on the stock skirmish map, seed
 * 1337: a harvester that started at 167,284 reached 148 m from its start and
 * spent 574 ticks inside 70 m of the ENEMY base centre, on a map whose bases are
 * 182 m apart.
 *
 * DEFECT 2 — THE PLAYER'S CLICK WAS DISCARDED. `OrderKind.Harvest` writes
 * `orderX/orderZ` and sets `SeekOre`, and `tickSeek` then republishes the cell
 * it was ALREADY claiming over the top of it, on the very next tick. Measured on
 * a two-patch fixture: harvester at 60,30 seeking the near patch, ordered to a
 * patch 140 m away, order point overwritten within one tick, still on the near
 * patch 60 s later. So the one control the player had over where a harvester
 * works did nothing at all — which is the literal complaint, "whenever i lead
 * them to some point".
 *
 * THE ANCHOR IS THE GUARD POST. `guardX/guardZ` is the column the rest of the
 * game already calls "where this unit belongs when nobody is telling it
 * anything" (see §LEASH in sim/Targeting.ts). It is serialised into every save,
 * hashed into the desync checksum, and — because a harvester is unarmed and
 * `TargetingSystem` skips everything without `CanAttack` — read by nobody. The
 * economy is the one consumer it was missing.
 *
 * REUSING IT REQUIRED TAKING OWNERSHIP OF IT, and that is the part a reader
 * should not skip. `NavAssigner` re-stamps the post on the tick a goal-seeking
 * state ends, and for a harvester that fires TWICE PER ROUND TRIP — SeekOre ->
 * Harvesting, and ReturnToRefinery -> Docked, the only two harvester states
 * `seeksGoal` excludes. Traced over four minutes, one harvester's post read
 * 316,188 | 272,250 | 295,193 | 294,190 | 317,188 | 286,192: it alternates
 * between the ore face and the refinery apron and moves tens of metres a
 * sample. A leash centred on that walks with the unit and is not a leash. Both
 * stamp sites in `sim/Steering.ts` now skip harvesters and say why.
 *
 * WHAT SETS IT
 *   - A Harvest order whose ORDER POINT HOLDS ORE. Detected by diffing
 *     `orderX/orderZ` against our own `destX/destZ`, exactly as `NavAssigner`
 *     detects a new order and for the same reason ("so this works no matter who
 *     issued it") — the AI issues the same order through the same columns. The
 *     test is `oreAt(orderCell) > 0` rather than "which branch of Commands.ts
 *     produced this", so the OTHER Harvest order — right-clicking your own
 *     refinery, which means "go unload" and carries a target instead of a point
 *     — cannot be mistaken for a new patch.
 *   - The first auto-acquire after the anchor was dropped. A harvester that
 *     ships with a refinery, rolls out of a war factory or is posed by a
 *     scenario has never been told anything, and the honest answer is the patch
 *     it picks on its own.
 *   - `HARVESTER_LEASH_PATIENCE` seconds of a dry leash (below).
 * The anchor is SNAPPED TO THE FIELD'S NODE CELL when the point lands in a
 * seeded field, so "that patch" means the patch and not the pixel. Ground with
 * no field takes the point as given.
 *
 * WHAT DROPS IT: any order that is not a Harvest order. A move, an attack-move,
 * a flee — the player has taken the harvester off ore, so the leash it was
 * working under is stale, and the next acquire re-takes an anchor from wherever
 * the hull ended up. That is what makes "send it somewhere far away
 * deliberately" work, and it is why the leash is a default rather than a cage.
 *
 * WHAT IT CONSTRAINS: the two sites that CHOOSE an ore cell, and nothing else.
 * `ReturnToRefinery` is never leashed — a full hopper must always reach a dock,
 * and that decoupling is what lets HARVESTER_LEASH_METRES be sized by the field
 * alone rather than by the round trip.
 *
 * WHEN THE PATCH RUNS DRY. Ore regrows, so dry is usually temporary and the
 * first answer is to WAIT: the harvester banks what it is carrying and idles
 * beside its own patch on the existing `DRY_RETRY`, taking cells back as they
 * come up. `leashDry` counts the seconds it has failed to find anything at all,
 * and past HARVESTER_LEASH_PATIENCE the harvester re-anchors — ONCE,
 * deliberately — on the nearest field that still holds ore TO ITS OWN REFINERY,
 * not to itself. That origin is the whole difference between expanding to the
 * next patch and walking to the enemy: the ore has to end up at the refinery,
 * so the patch worth taking is the one nearest it.
 *
 * The wait is what a player sees. Four harvesters parked ON a stripped patch
 * says "this patch is out" at a glance; the same four scattered across the map,
 * which is what happened before, says nothing. `HarvesterStats.waiting` counts
 * them for the overlay.
 *
 * THE LEASH CAN NEVER BE THE REASON A HARVESTER HAS NOTHING TO DO. If the
 * re-anchor finds no field with ore anywhere, the anchor is DROPPED and the
 * unleashed fallback chain runs unchanged — the same principle
 * `acquireOre`'s "a banned cell beats no cell" escape already states, one level
 * up.
 * ============================================================================
 */

import {
  CELL, HARVEST_ARRIVE_RADIUS, HARVEST_FX_INTERVAL, HARVEST_RATE,
  HARVESTER_DOCK_RADIUS, HARVESTER_DOCK_CLEARANCE, HARVESTER_QUEUE_GAP,
  HARVESTER_DOCK_FALLBACK_TRIES, HARVESTER_DOCK_STANDDOWN,
  HARVESTER_FORCE_DRIVE_SECONDS, HARVESTER_FORCE_DRIVE_TRIES,
  HARVESTER_LEASH_METRES, HARVESTER_LEASH_PATIENCE,
  HARVESTER_NAV_GIVEUP_METRES, HARVESTER_NAV_GIVEUP_SECONDS, HARVESTER_NAV_PARK_GRACE,
  HARVESTER_UNREACHABLE_BAN_CELLS, HARVESTER_UNREACHABLE_BAN_SECONDS,
  HARVESTER_STUCK_SECONDS, MAP_CELLS, MAX_PLAYERS,
  NAV_ARRIVE_SLACK, ORE_MIN_CLAIM,
  ORE_SCORING_INTERVAL, ORE_SEARCH_CELLS, ORE_VALUE, SIM_DT,
  UNDER_ATTACK_COOLDOWN, UNLOAD_SECONDS,
} from '../core/config';
import {
  CreditReason, EntityFlag, EntityKind, EvaLine, FxKind, NONE, OrderKind, UnitState,
  UpgradeLever,
} from '../core/types';
import type { EntityId, Faction, Locomotor, PlayerId, SimContext } from '../core/types';
import { PerEntityF32, PerEntityI16, PerEntityU32, type World } from '../core/world';
import type { Channels } from '../core/events';
import {
  angleDelta, clampCell, clampWorld, dist2, moveToward, turnToward, worldToCell,
} from '../core/math';
import type { Economy, OreField } from './Economy';
import { upgradeGlobalMul } from './Upgrades';

/**
 * Metres from a refinery's CENTRE to the point a harvester parks to unload.
 *
 * Exported and pure so the invariant that matters can actually be asserted:
 * `result - hullRadius > footprint edge along the facing axis`. That is the
 * whole bug this function was extracted for — see the block at its call site.
 *
 * @param halfW      half the footprint's world X extent, metres
 * @param halfH      half the footprint's world Z extent, metres
 * @param fwdX,fwdZ  unit facing vector (sin/cos of the building's yaw)
 * @param hullRadius the DOCKING harvester's collision radius, not a constant
 */
export function dockApronDistance(
  halfW: number, halfH: number, fwdX: number, fwdZ: number, hullRadius: number,
): number {
  // Footprints are stored world-axis-aligned (see `touching()`), so the extent
  // the apron has to clear is the projection of the box onto the facing axis —
  // width when facing along X, depth when facing along Z.
  const edge = Math.abs(fwdX) * halfW + Math.abs(fwdZ) * halfH;
  return edge + hullRadius + HARVESTER_DOCK_CLEARANCE;
}

/** Seconds between full re-evaluations of a harvester's plan. */
const SCORE_PERIOD = ORE_SCORING_INTERVAL * SIM_DT;
/** Seconds a harvester waits before re-searching after finding no ore at all. */
const DRY_RETRY = 2.0;
/** Metres of forward progress that counts as "not stuck". */
const PROGRESS_EPSILON = 0.15;
/** Metres ahead the mover probes for impassable ground. */
const PROBE_METRES = 4.5;
/** Heading offsets, in radians, the mover tries when the probe is blocked. */
const SIDESTEP = [0.52, -0.52, 1.05, -1.05, 1.57, -1.57, 2.09, -2.09];
/**
 * Cells of ring search for open ground when a hull is standing ON a blocked
 * cell. 6 is three hull-lengths of a harvester and comfortably clears the
 * widest scatter prop; past that the unit is not "stranded on a rock", it is
 * inside something structural and `wedgedIn` owns the case.
 */
const UNSTRAND_SEARCH_CELLS = 6;
/**
 * Cell rings outside a refinery's footprint searched for a reachable dock
 * point. Three is twelve metres of apron in every direction — past that the
 * structure is walled in and the honest answer is that it has no dock.
 */
const HARVESTER_DOCK_APPROACH_RINGS = 3;
/**
 * The leash, in whole CELLS, which is the unit the ore grid is indexed in.
 *
 * Rounded DOWN so the disc can never exceed the metre figure it is derived
 * from, and integral so `findFreeOre`'s containment test is exact integer
 * arithmetic — this runs inside `simTick`, where a float comparison that lands
 * differently on two machines is a desync.
 */
const LEASH_CELLS = Math.floor(HARVESTER_LEASH_METRES / CELL);
/**
 * The unreachable-ground ban's radius WHEN THE HARVESTER IS LEASHED, in cells.
 *
 * `HARVESTER_UNREACHABLE_BAN_CELLS` is 20 cells (80 m) and its config comment
 * says exactly why: the re-plan has to "land on a DIFFERENT PATCH, not one cell
 * to the left of the thing that stopped it". That is the correct size for a
 * harvester with the whole map to choose from, and it is fatal for one with a
 * 12-cell leash — a Chebyshev square of 20 cells centred anywhere near the hull
 * covers the entire disc, so the FIRST ban empties the patch and every later
 * search returns nothing.
 *
 * Measured with the full-size ban applied inside the leash: seed 4242 slot 43
 * spent 3382 ticks in SeekOre and 3602 Idle for ONE delivery and 84 m, cycling
 * between banning its patch, waiting out the patience and re-anchoring on the
 * next field 90 m away — 2 crawling harvesters against a ceiling of 1.
 *
 * A THIRD OF THE LEASH, so the bound is stated as the invariant rather than as
 * a number: the exclusion may never take more than a third of the ground the
 * harvester is allowed to work, which leaves the re-plan somewhere real to go.
 * At the shipped leash that is 4 cells — 16 m, about four hull lengths, and a
 * quarter of a home field's 56 m diameter, so a re-plan under it lands on
 * visibly different ground rather than against the same rock.
 *
 * The claim the ban makes is also weaker here, and correctly so. Unleashed it
 * means "this patch defeated me"; leashed it can only mean "this corner did",
 * because the alternative — concluding the patch is unusable — is the caller's
 * decision to make and it already has a better mechanism for it.
 */
const LEASH_BAN_CELLS = Math.min(HARVESTER_UNREACHABLE_BAN_CELLS, Math.floor(LEASH_CELLS / 3));
/**
 * Metres of order-point movement that counts as a NEW harvest order.
 *
 * Same threshold and the same reasoning as `NAV_FORMATION_GOAL_EPS`: the
 * columns are compared against our own last published value, so anything above
 * the noise floor was written by somebody else.
 */
const NEW_ORDER_EPS = 0.6;

/* --------------------------------------------------------------------------
 * `acquireInLeash` outcomes, and the middle one is the whole hysteresis.
 *
 * "IS THIS PATCH DRY" AND "IS THERE ANYTHING TO PICK UP" ARE DIFFERENT
 * QUESTIONS, and answering the first with the second is what would make the
 * dry alert unusable. The second tier accepts a cell holding ONE unit, and
 * regrowth lifts a stripped cell off zero within a single `ORE_REGROW_INTERVAL`
 * (half a second) — so a patch that is finished in every sense a player cares
 * about answers "yes, there is ore" twice a second forever. Keyed on that, the
 * alert would fire, clear and re-fire continuously about a harvester the player
 * can see is working.
 *
 * So the DRY CLOCK is keyed on the first tier only: no cell in the leash holds
 * `ORE_MIN_CLAIM` (25), which is already defined in config as the amount below
 * which "a harvester that drives 90 m for 3 units of ore looks broken". The
 * ACQUIRE still takes the scraps — the patch is 48 m away, so there is no
 * wasted drive and the last few hundred credits still get collected — it simply
 * does not count as the patch being alive.
 *
 * That gives the hysteresis for real rather than by a magic number: clearing
 * the dry state requires regrowth to lift one cell from 0 to 25, which at
 * ORE_REGROW_RATE 0.6/s takes 14 s at the node (ORE_REGROW_NODE_BONUS 3.0).
 * HARVESTER_LEASH_PATIENCE is 30 s, so the node always gets its chance before
 * anyone concludes anything.
 *
 * "AND 42 s ANYWHERE ELSE" WAS THE REST OF THAT SENTENCE AND IT WAS FALSE.
 * 42 s is 25 / ORE_REGROW_RATE — the time a non-node cell takes once it is
 * ALLOWED to grow. It is not allowed to grow at zero seconds: `OreField.regrow`
 * gates every non-node cell on its upstream holding ORE_REGROW_SPREAD of the
 * upstream's own capacity, and the node's capacity is ~460-535 ore, so ring one
 * waits ~140 ore of exclusive node regrowth — 77-89 s — before its 42 s even
 * starts. Measured on the real class, r30 field stripped to zero and left
 * alone: ring one crosses 25 at 2.8 min, the rim at 23.9 min, and the field
 * reaches 95% of capacity at 23.4 min. The single-cell claim (14 s at the node)
 * is the only part of the original sentence that survives measurement, and it
 * is the part this block actually depends on.
 *
 * AND THE SECOND TIER'S CLOCK IS NEVER READ, which looks like it should break
 * all of this and does not. See the block above the LEASH_SCRAPS branch in
 * `acquireOre` for the measurement; the short version is that `takeOre` sweeps
 * a cell to exactly zero and the scraps floor is one unit, so a regrowing patch
 * still reads as LEASH_EMPTY for ~1.7 s after every take and the escape matures
 * through that window instead.
 * ------------------------------------------------------------------------ */
/** Nothing in the leash, at any amount. */
const LEASH_EMPTY = 0;
/** Only cells below ORE_MIN_CLAIM. Taken, but the patch counts as dry. */
const LEASH_SCRAPS = 1;
/** A cell worth the trip. The patch is alive. */
const LEASH_WORTH_A_TRIP = 2;

/**
 * `dryNotified` sentinel. -2 rather than -1 because -1 is a REAL field id here:
 * it is what `fieldAtCell` returns for a harvester anchored on loose scrap
 * outside every seeded field, and that harvester must still be able to report.
 */
const DRY_NOTIFIED_NONE = -2;

export interface HarvesterStats {
  harvesters: number;
  seeking: number;
  harvesting: number;
  returning: number;
  docked: number;
  idle: number;
  /** Ore currently riding around in hoppers. */
  cargo: number;
  cargoCapacity: number;
  /** Lifetime credits delivered through docks. */
  delivered: number;
  /** Harvesters the fallback mover is driving this tick. */
  driven: number;
  /**
   * Harvesters sitting beside an anchored patch that currently has nothing to
   * give. Not a stall — see §ANCHOR — but the number that tells you the
   * difference between "the economy is waiting for regrowth" and "the economy
   * is broken", which is otherwise indistinguishable from `idle`.
   */
  waiting: number;
}

/**
 * How much of the harvester's locomotion this module is responsible for.
 * Module-level so nav can change it with one call and no import cycle.
 */
export type HarvesterDriveMode = 'full' | 'assist' | 'off';

let driveMode: HarvesterDriveMode = 'full';

/**
 * Set the backstop mover's mode. `true`/`false` are accepted as aliases for
 * 'full'/'off' so a caller that only wants to switch it off does not have to
 * know the mode names exist.
 */
export function setHarvesterDrive(mode: HarvesterDriveMode | boolean): void {
  driveMode = mode === true ? 'full' : mode === false ? 'off' : mode;
}

/** Current backstop mode. */
export function harvesterDriveMode(): HarvesterDriveMode {
  return driveMode;
}

export class HarvesterController {
  /* -- per-harvester state, generation-stamped so recycled slots read clean -- */

  /** Packed grid index of the claimed ore cell, or -1. */
  private readonly claimIdx: PerEntityI16;
  /** Current destination in world metres. */
  private readonly destX: PerEntityF32;
  private readonly destZ: PerEntityF32;
  /**
   * The COMMITTED dock approach point for the current haul, world metres.
   *
   * Separate from `destX/destZ` because those are simply "what we published
   * last", written by every state. These two are a decision with a lifetime:
   * they are set by `commitDockPoint` and read unchanged on every intervening
   * tick, which is the property that lets nav's watchdogs accumulate evidence.
   * See `commitDockPoint` for the measured trace of what happens without it.
   */
  private readonly dockX: PerEntityF32;
  private readonly dockZ: PerEntityF32;
  /** Sim time of the next full re-score. */
  private readonly nextScore: PerEntityF32;
  /** Best distance-to-destination seen so far, for the stuck detector. */
  private readonly bestGap: PerEntityF32;
  /** Seconds without measurable progress. */
  private readonly stuckFor: PerEntityF32;
  /**
   * The backstop mover's own scalar speed.
   *
   * Separate from `store.speed` because in assist mode this mover reports zero
   * speed back to the store: `Movement` integrates position from whatever
   * `speed` it finds, so leaving our value there would have it move the unit a
   * second time on the following tick, on top of our own step.
   */
  private readonly driveSpeed: PerEntityF32;
  /**
   * Seconds this harvester has sat at zero velocity, short of its destination,
   * while nav still held a field for it. Reset the instant it moves, arrives or
   * stops hauling; see the guard in `drive()` for why it is a duration and not
   * a boolean.
   */
  private readonly parkedFor: PerEntityF32;
  /**
   * Where this hull was when the give-up watchdog last accepted that it had
   * moved, and how long it has been within HARVESTER_NAV_GIVEUP_METRES of it.
   *
   * RAW DISPLACEMENT AGAINST AN ANCHOR, not per-tick displacement, and the
   * distinction is the whole reason this works. A hull can be moved every tick
   * and pushed back every tick: sampled per tick it looks like it is doing
   * 1.5 m/s, and over eight seconds it has covered nothing. Same shape as
   * `NavAgents.anchorX` and chosen for the same reason.
   *
   * The original producer was `Movement.relax` shoving a hull out of a
   * `BlocksNav` prop — rocks are not solid any more and that branch is deleted,
   * so do not go looking for it. See HARVESTER_NAV_GIVEUP_METRES in config.ts
   * for the case that still produces this, and keep the two in step: this
   * paragraph and that one are the same claim written twice.
   */
  private readonly pinX: PerEntityF32;
  private readonly pinZ: PerEntityF32;
  private readonly pinnedFor: PerEntityF32;
  /**
   * The ore cell nav gave up on, and the sim time the ban lapses. -1 for none.
   *
   * Per harvester and time-limited on purpose — see
   * HARVESTER_UNREACHABLE_BAN_SECONDS. A generation-stamped table, so a
   * recycled slot never inherits the dead hull's grudge.
   */
  private readonly banCx: PerEntityI16;
  private readonly banCz: PerEntityI16;
  private readonly banUntil: PerEntityF32;
  /**
   * The refinery handle nav gave up on approaching, and when that lapses. 0 for
   * none. Same shape and the same reasoning as the ore ban above: an approach
   * this hull cannot drive is not a fact about the refinery, it is a fact about
   * this hull's position relative to it.
   */
  private readonly banRef: PerEntityU32;
  private readonly banRefUntil: PerEntityF32;
  /** Sim time until which this harvester will not contend for its dock. */
  private readonly dockStandDown: PerEntityF32;
  /** Consecutive failed apron approaches; see HARVESTER_DOCK_FALLBACK_TRIES. */
  private readonly dockTries: PerEntityF32;
  /**
   * Seconds of outright backstop control remaining. While positive, `drive()`
   * moves this hull itself and ignores the flow field. Counted down in
   * `drive()` rather than the FSM so it is spent in the phase that spends it.
   */
  private readonly forceDrive: PerEntityF32;
  /** Force-drive windows already spent on the CURRENT destination. */
  private readonly forceTries: PerEntityF32;
  /**
   * 1 while `guardX/guardZ` holds an ore anchor for this harvester. See §ANCHOR.
   *
   * A FLAG AND NOT A SENTINEL IN THE POSITION, because there isn't one:
   * `EntityStore.alloc` seeds `guardX/guardZ` with the spawn point, so every
   * value in that column is a plausible anchor and "unset" cannot be encoded
   * there. Generation-stamped, so a recycled slot starts unanchored rather than
   * inheriting a dead hull's patch.
   *
   * NOT SERIALISED, and that is a deliberate accepted loss: the POSITION is
   * saved (it is `guardX/guardZ`), only the bit saying we own it is not, so a
   * loaded harvester re-anchors on its next acquire and lands on the patch it
   * is standing at. Paying for a save column and a hash slot to skip one
   * re-anchor is not worth it.
   */
  private readonly anchored: PerEntityU32;
  /**
   * Sim time at which this harvester's leash FIRST came up empty, or -1 while
   * it has ore to go at.
   *
   * A TIMESTAMP RATHER THAN AN ACCUMULATOR, because the only code that can
   * observe the condition is `decide()`, which is throttled to `DRY_RETRY` and
   * therefore does not see every tick. A counter fed a `dt` it is only handed
   * every other second measures the number of retries, not the elapsed time,
   * and HARVESTER_LEASH_PATIENCE is written in seconds. Reset by every
   * successful acquire and by every change of anchor, so it measures the
   * CURRENT patch and not the harvester's history.
   */
  private readonly leashDryAt: PerEntityF32;

  /** Per-REFINERY: the harvester currently holding its dock, or 0. */
  private readonly dockHolder: PerEntityU32;

  private readonly lastUnderAttackEva = new Float64Array(MAX_PLAYERS);
  /**
   * Per player, the ore field they have already been told is exhausted, or
   * `DRY_NOTIFIED_NONE`. See `announceDry` — this is the coalescing, and it is
   * keyed on WHAT was announced rather than on when, so it re-arms on the event
   * that matters instead of on a clock.
   */
  private readonly dryNotified = new Int32Array(MAX_PLAYERS);
  /** Sim time of each player's last dry notice. Diagnostics only. */
  private readonly lastDryEva = new Float64Array(MAX_PLAYERS);

  private readonly statsOut: HarvesterStats = {
    harvesters: 0, seeking: 0, harvesting: 0, returning: 0, docked: 0, idle: 0,
    cargo: 0, cargoCapacity: 0, delivered: 0, driven: 0, waiting: 0,
  };
  private deliveredTotal = 0;
  private drivenThisTick = 0;

  private readonly cellOut = new Int32Array(2);
  /** Owned scratch for `nearestOpenCell`; never held across a call. */
  private readonly unstrandOut = new Int32Array(2);
  /** Owned scratch for `reachableDockPoint`; world coords, never held. */
  private readonly dockOut = new Float32Array(2);
  private readonly unsubscribes: (() => void)[] = [];

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly ore: OreField,
    private readonly economy: Economy,
  ) {
    const store = world.store;
    this.claimIdx = new PerEntityI16(store, -1);
    this.destX = new PerEntityF32(store, 0);
    this.destZ = new PerEntityF32(store, 0);
    this.dockX = new PerEntityF32(store, 0);
    this.dockZ = new PerEntityF32(store, 0);
    this.nextScore = new PerEntityF32(store, 0);
    this.bestGap = new PerEntityF32(store, 1e9);
    this.stuckFor = new PerEntityF32(store, 0);
    this.driveSpeed = new PerEntityF32(store, 0);
    this.parkedFor = new PerEntityF32(store, 0);
    this.pinX = new PerEntityF32(store, 0);
    this.pinZ = new PerEntityF32(store, 0);
    this.pinnedFor = new PerEntityF32(store, 0);
    this.banCx = new PerEntityI16(store, -1);
    this.banCz = new PerEntityI16(store, -1);
    this.banUntil = new PerEntityF32(store, 0);
    this.banRef = new PerEntityU32(store, 0);
    this.banRefUntil = new PerEntityF32(store, 0);
    this.dockStandDown = new PerEntityF32(store, 0);
    this.dockTries = new PerEntityF32(store, 0);
    this.forceDrive = new PerEntityF32(store, 0);
    this.forceTries = new PerEntityF32(store, 0);
    this.anchored = new PerEntityU32(store, 0);
    this.leashDryAt = new PerEntityF32(store, -1);
    this.dockHolder = new PerEntityU32(store, 0);
    this.lastUnderAttackEva.fill(-1e9);
    this.dryNotified.fill(DRY_NOTIFIED_NONE);
    this.lastDryEva.fill(-1e9);

    this.unsubscribes.push(
      channels.events.on('entity:damaged', (ev) => this.onDamaged(ev.id, ev.player, ev.x, ev.z)),
    );
  }

  /* ======================================================================
   * THE FSM
   * ====================================================================== */

  simTick(s: SimContext): void {
    const store = this.world.store;
    const st = this.statsOut;
    st.harvesters = 0; st.seeking = 0; st.harvesting = 0;
    st.returning = 0; st.docked = 0; st.idle = 0;
    st.cargo = 0; st.cargoCapacity = 0; st.waiting = 0;

    const n = store.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = store.alive[a];
      const f = store.flags[i];
      if ((f & EntityFlag.IsHarvester) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if (store.cargoMax[i] <= 0) continue;

      st.harvesters++;
      st.cargo += store.cargo[i];
      st.cargoCapacity += store.cargoMax[i];

      const id = store.handleOf(i);
      if (this.anchored.getAt(i) !== 0 && this.leashDryAt.getAt(i) >= 0) st.waiting++;

      // THE ORDER EDGE, AHEAD OF EVERY STATE. It has to be read before the FSM
      // runs, because `tickSeek`'s first act is to republish the cell it is
      // already claiming — which is the whole of defect 2 in §ANCHOR. Reading it
      // here and re-planning turns a Harvest right-click into a redirect
      // instead of a no-op.
      if (this.takeNewOrder(i, id, s.time)) continue;

      switch (store.state[i]) {
        case UnitState.SeekOre:
          st.seeking++;
          this.tickSeek(i, id, s.dt, s.time);
          break;
        case UnitState.Harvesting:
          st.harvesting++;
          this.tickHarvest(i, id, s.dt, s.time, s.tick);
          break;
        case UnitState.ReturnToRefinery:
          st.returning++;
          this.tickReturn(i, id, s.dt, s.time);
          break;
        case UnitState.Docked:
          st.docked++;
          this.tickDock(i, id, s.dt, s.time);
          break;
        case UnitState.Idle:
          st.idle++;
          /* A PLAYER STOP IS NOT "I HAVE NO WORK", AND `Idle` MEANS BOTH.
           *
           * That overload is why Stop did nothing to a harvester: the executor
           * writes `orderKind = None, state = Idle` (Commands.ts's Stop case),
           * this branch read the state as "idle, find something", and
           * `decide()` put it straight back on the ore — inside one second,
           * because `tickHarvest` never refreshes `nextScore` so the throttle
           * has already lapsed. There was no gesture in the game that parked a
           * harvester; Guard appeared to, but only by freezing it in a state
           * nothing could clear, which is a defect rather than a feature and is
           * refused at the executor now.
           *
           * The marker is `OrderKind.Stop` LEFT STANDING IN THE COLUMN, which
           * the executor now does for harvesters only. `None` was tried first
           * and is wrong: `Transport.place` (a harvester rides now),
           * `Garrison.recover`, Chronoshift and `EntityStore.alloc` all produce
           * `None` + `Idle` for their own reasons, so a miner would freeze the
           * moment it stepped off a transport, or roll out of a war factory
           * already parked. `Stop` has exactly one writer.
           *
           * It survives a save, because `orderKind` is a real column — a parked
           * harvester is still parked when the game is loaded, which is what a
           * player who parked it would expect.
           */
          if (store.orderKind[i] === OrderKind.Stop) break;
          this.decide(i, id, s.time, false);
          break;
        default:
          // Some other system owns this unit right now (a player move order, a
          // flee, a death animation). The one thing that pulls it back is an
          // explicit Harvest order.
          if (store.orderKind[i] === OrderKind.Harvest) this.decide(i, id, s.time, true);
          break;
      }
    }
    st.delivered = this.deliveredTotal;
  }

  /**
   * Choose what this harvester should be doing. Full first, ore second, and a
   * throttled retry when the map has nothing left within reach — an idle
   * harvester ring-searching 6000 cells every tick would be the single most
   * expensive thing in the sim.
   */
  private decide(i: number, id: EntityId, time: number, force: boolean): void {
    const store = this.world.store;
    if (!force && time < this.nextScore.getAt(i)) return;
    this.nextScore.setAt(i, time + SCORE_PERIOD);

    if (store.cargo[i] >= store.cargoMax[i] - 0.001) {
      this.beginReturn(i, id, time);
      return;
    }
    if (!this.acquireOre(i, id, time)) {
      if (store.cargo[i] > 0) {
        // Nothing to mine but something in the hopper: bank it rather than
        // parking a full harvester next to an empty field.
        this.beginReturn(i, id, time);
        return;
      }
      this.enterIdle(i, id, time, DRY_RETRY);
    }
  }

  /* -- seeking ----------------------------------------------------------- */

  private tickSeek(i: number, id: EntityId, dt: number, time: number): void {
    const store = this.world.store;
    const packed = this.claimIdx.getAt(i);
    if (packed < 0) { this.decide(i, id, time, true); return; }

    const cx = packed % MAP_CELLS;
    const cz = (packed / MAP_CELLS) | 0;

    // Refresh the lease. A false here means somebody else's claim outlived ours
    // (only possible if we stopped refreshing), so re-plan rather than argue.
    if (!this.ore.claim(cx, cz, id, time)) {
      this.dropClaim(i, id);
      this.decide(i, id, time, true);
      return;
    }
    if (this.ore.oreAt(cx, cz) <= 0) {
      this.dropClaim(i, id);
      this.decide(i, id, time, true);
      return;
    }

    const tx = (cx + 0.5) * CELL;
    const tz = (cz + 0.5) * CELL;
    this.setDest(i, tx, tz);

    const d = dist2(store.posX[i], store.posZ[i], tx, tz);
    if (d <= this.arriveAt(i, HARVEST_ARRIVE_RADIUS)) {
      store.state[i] = UnitState.Harvesting;
      this.resetProgress(i);
      return;
    }

    // EVERYONE HAS GIVEN UP ON THIS CELL, AND THAT IS A DIFFERENT CLAIM FROM
    // "NO PROGRESS". `trackProgress` below measures whether the hull is getting
    // CLOSER; `trackPinned` measures whether it is moving AT ALL, and the
    // conjunction with a spent force-drive budget is what makes it a conclusion:
    // two five-second windows of the backstop — which needs no flow field, no
    // gradient and no clearance — followed by eight seconds in which the hull
    // did not cover one metre in any direction. Congestion does not look like
    // that. A hull queued behind another one shuffles, and a metre of shuffle
    // re-arms the anchor.
    //
    // Acting on it is also the only way the loop TERMINATES. Nav's wedge ladder
    // ends in a park rung, the park sets the sticky `AgentFlag.Arrived`, and
    // exactly one thing clears that flag: the order point moving. The order
    // point is ours. If we keep re-publishing the same cell nobody else can.
    //
    // AND IT IS WHY THE EXCLUSION BELOW IS BACK. An exclusion was tried here
    // once, keyed on `trackProgress`, and measured worse: 3 deliveries lost and
    // stalls from 6/12 to 9/12. The diagnosis recorded at the time was right —
    // "the signal has to distinguish 'cannot get there' from 'did not get there
    // yet', and progress alone cannot" — and this is that signal. On it, the
    // same exclusion is worth +7 deliveries and takes crawling hulls to 0/12.
    // The second reason it failed was its RADIUS; see
    // HARVESTER_UNREACHABLE_BAN_CELLS, where below ten cells is still a loss.
    const pinned = this.trackPinned(i, dt);
    if (pinned && this.forceTries.getAt(i) >= HARVESTER_FORCE_DRIVE_TRIES) {
      this.banCx.setAt(i, cx);
      this.banCz.setAt(i, cz);
      this.banUntil.setAt(i, time + HARVESTER_UNREACHABLE_BAN_SECONDS);
      this.dropClaim(i, id);
      if (!this.acquireOre(i, id, time)) {
        if (store.cargo[i] > 0) this.beginReturn(i, id, time);
        else this.enterIdle(i, id, time, DRY_RETRY);
      }
      return;
    }

    if (time >= this.nextScore.getAt(i)) {
      this.nextScore.setAt(i, time + SCORE_PERIOD);
      this.rescoreOre(i, id, time, d);
    }
    if (this.trackProgress(i, d, dt)) {
      // "CANNOT REACH THAT CELL" IS A CONCLUSION, NOT AN OBSERVATION, and it
      // was being drawn from evidence that only says the hull is not moving.
      // Those are different: a harvester rocking on the corner of its own
      // refinery's footprint is going nowhere while the cell it wants is wide
      // open and forty metres of clear ground away. Idling there and re-planning
      // produced the measured 4 s stall / 2 s idle cycle, thirty-seven times,
      // covering 33 m in four minutes.
      //
      // So spend a force-drive window FIRST — the backstop needs no flow field
      // and no gradient — and only conclude unreachability if that also fails.
      if (this.forceTries.getAt(i) < HARVESTER_FORCE_DRIVE_TRIES) {
        this.forceTries.setAt(i, this.forceTries.getAt(i) + 1);
        this.forceDrive.setAt(i, HARVESTER_FORCE_DRIVE_SECONDS);
        this.resetProgress(i);
        return;
      }
      /* ===================================================================
       * THE FORCE-DRIVE BUDGET IS SPENT. HAND OVER; DO NOT IDLE.
       *
       * This used to `dropClaim` and `enterIdle` here, and that was the whole
       * remaining SeekOre stall — not because idling is wrong in itself, but
       * because of what it does to the module that was about to fix the
       * problem.
       *
       * `seeksGoal(Idle)` is false, so `NavAssigner` takes its `!seeking`
       * branch, releases the field and calls `armWedge` — which ZEROES
       * `escalations`. Two seconds later `DRY_RETRY` re-plans onto the SAME
       * cell (ore is ranked by distance and nothing had changed), the order
       * reads as new, and `armWedge` zeroes the ladder again. The wedge ladder
       * needs NAV_WEDGE_SAMPLE_TICKS * NAV_WEDGE_STRIKES * 4 = 480 consecutive
       * ticks to reach its displacement rung and 600 to reach its park rung;
       * this cycle is ~360 ticks of SeekOre plus 60 of Idle. It could never
       * finish. Measured across the three soak seeds: 0 park rungs reached in
       * twelve minutes of harvesting, and 87/119/57 wedge detections that all
       * came to nothing.
       *
       * It is the same defect `commitDockPoint` documents from the other side —
       * a module resetting the evidence faster than the evidence can
       * accumulate — reached by a different route, and the answer is the same:
       * hold still and let the ladder run. Nav is strictly better equipped
       * here than we are. Its rung N+1 can pick the hull up and put it on the
       * nearest routable cell, which is the ONLY remedy that works on the case
       * this branch actually sees (a `BlocksNav` prop sealing a one-cell
       * corridor — the planner cannot see the prop and the backstop cannot fit
       * past it).
       *
       * Termination does not depend on the ladder succeeding. It ends in a
       * park rung, the park sets `AgentFlag.Arrived`, and the give-up check at
       * the top of this function is what turns that into a new plan. Measured
       * after: 2/1/1 park rungs and 2/2/1 displacements across the same seeds.
       * =================================================================== */
      this.resetProgress(i);
    }
  }

  /**
   * A closer unclaimed cell may have opened up while we were driving (someone
   * else finished theirs, or regrowth crossed ORE_MIN_CLAIM). Only switch on a
   * clear win — 25% closer — or harvesters oscillate between two cells that are
   * a metre apart and never arrive at either.
   */
  private rescoreOre(i: number, id: EntityId, time: number, currentDist: number): void {
    const store = this.world.store;
    const cx = clampCell(worldToCell(store.posX[i]));
    const cz = clampCell(worldToCell(store.posZ[i]));
    // Ground nav gave up on, if the ban is still live; -1 disables it. Applied
    // here as well as in `acquireOre` because a rescore is a fresh choice of
    // destination and must not quietly reintroduce the one we just condemned.
    const bx = this.liveBan(i, time) ? this.banCx.getAt(i) : -1;
    // AND THE LEASH, for the same reason and with more force. A rescore is a
    // re-choice taken from WHEREVER THE HULL HAS GOT TO, every
    // ORE_SCORING_INTERVAL, which makes it the actual engine of the map-crossing
    // drift in §ANCHOR: each one moves the hull a little, and the next one is
    // taken from the new position with the whole 160 m search radius back in
    // play. Confining it to the anchor disc is what turns the walk into a
    // stationary process.
    const leashed = this.anchored.getAt(i) !== 0;
    const kx = leashed ? clampCell(worldToCell(store.guardX[i])) : -1;
    const kz = leashed ? clampCell(worldToCell(store.guardZ[i])) : -1;
    if (!this.ore.findFreeOre(
      cx, cz, leashed ? this.leashSearchCells(i) : ORE_SEARCH_CELLS,
      id, ORE_MIN_CLAIM, time, this.cellOut,
      bx, this.banCz.getAt(i), HARVESTER_UNREACHABLE_BAN_CELLS,
      kx, kz, LEASH_CELLS,
    )) return;

    const nx = (this.cellOut[0] + 0.5) * CELL;
    const nz = (this.cellOut[1] + 0.5) * CELL;
    const nd = dist2(store.posX[i], store.posZ[i], nx, nz);
    if (nd >= currentDist * 0.75) return;
    if (!this.ore.claim(this.cellOut[0], this.cellOut[1], id, time)) return;

    this.dropClaim(i, id);
    this.claimIdx.setAt(i, this.cellOut[1] * MAP_CELLS + this.cellOut[0]);
    this.setDest(i, nx, nz);
    this.resetForceBudget(i);
    this.resetProgress(i);
  }

  /* -- the anchor -------------------------------------------------------- */

  /**
   * Read the order columns and act on anything this module did not write there.
   * True means the caller should skip this harvester's state tick — a re-plan
   * has already happened and the FSM would only undo it.
   *
   * See §ANCHOR. This is `NavAssigner`'s trick applied to the columns from the
   * other side: diff against our own last published value rather than asking
   * for a notification, so a player click and an AI order look identical here,
   * which is what they are.
   */
  private takeNewOrder(i: number, id: EntityId, time: number): boolean {
    const store = this.world.store;

    // ANY OTHER ORDER TAKES THIS HARVESTER OFF ORE, so the patch it was bound
    // to is stale. Dropped on the order rather than on the way back, because a
    // move across the map keeps the unit busy for a minute and an anchor that
    // survived it would drag the harvester back to a patch the player has
    // visibly moved it away from. This is the override.
    if (store.orderKind[i] !== OrderKind.Harvest) {
      this.dropAnchor(i);
      return false;
    }

    const ox = store.orderX[i];
    const oz = store.orderZ[i];
    const dx = ox - this.destX.getAt(i);
    const dz = oz - this.destZ.getAt(i);
    if (dx * dx + dz * dz <= NEW_ORDER_EPS * NEW_ORDER_EPS) return false;

    /* ====================================================================
     * "GO UNLOAD" — A HARVEST ORDER CARRYING A REFINERY.
     *
     * A Harvest order is two orders wearing one kind: a point on ore ("work
     * that patch") and a right-click on your own refinery ("bank what you are
     * carrying"). This used to be told apart by the ORE UNDER THE POINT, on the
     * reasoning that the unload order "carries a target and a point nobody
     * set". That premise was false — `resolveContextOrder` writes `out.x/out.z`
     * for any valid hover before it picks a branch, so the point is the
     * refinery's own centre — but the ore test happened to reject it anyway,
     * for the wrong reason, and the whole order fell on the floor. Read the
     * TARGET, which is the field that actually distinguishes them.
     * ==================================================================== */
    const tgt = store.orderTarget[i];
    if (tgt !== 0) {
      const ri = store.index(tgt as EntityId);
      if (ri >= 0 && this.isUsableRefinery(ri, store.owner[i])) {
        // Already at a dock with the hopper emptying: this order IS what is
        // happening, and yanking the hull off mid-unload is what the executor
        // used to do. Consume the point so the edge does not re-fire.
        if (store.state[i] === UnitState.Docked) { this.consumeOrder(i, ox, oz); return false; }
        // An empty hopper has nothing to deliver. Walking it to a refinery to
        // do nothing would be obedient and useless; leave it on the job.
        if (store.cargo[i] <= 0) { this.consumeOrder(i, ox, oz); return false; }
        // The REFINERY THE PLAYER CLICKED, not the one `pickRefinery` would
        // choose. That function ranks by free dock then distance and reads no
        // order column, so without passing it here "unload at THAT one" — the
        // whole reason to click a specific refinery — could never be honoured.
        this.consumeOrder(i, ox, oz);
        this.beginReturn(i, id, time, ri);
        return true;
      }
    }

    // Otherwise the point is the order. Ore under it is still the test, because
    // a Harvest order with a dead or hostile target must not be read as a
    // mining order for the cell that target happens to stand on.
    const cx = clampCell(worldToCell(ox));
    const cz = clampCell(worldToCell(oz));
    if (this.ore.oreAt(cx, cz) <= 0) return false;

    this.anchorOnField(i, cx, cz);
    // The claim in hand belongs to the OLD patch, and `acquireOre` will not
    // consider anything while a live claim of ours is sitting on the grid.
    // Dropping it here is also the fix for defect 2 on its own: without it
    // `tickSeek` republishes that cell over the player's point on the next line.
    this.dropClaim(i, id);
    this.resetForceBudget(i);
    this.consumeOrder(i, ox, oz);

    /* DELIVER FIRST IF THE HOPPER IS FULL.
     *
     * `decide()` owns the "full first, ore second" rule (see its cargo test),
     * and this path does not go through it — it called `acquireOre` directly,
     * which has no cargo test at all. So a full hull took an ore claim, crossed
     * the map, and `tickHarvest` turned it round on arrival without scooping a
     * single unit because there was no space. Measured: 300/300 standing 21.9 m
     * from its own refinery, redirected to a patch 200 m away, load not banked
     * for 45.2 s against the ~3 s the delivery already under way would have
     * taken.
     *
     * The redirect is NOT discarded — `anchorOnField` above has already
     * recorded the patch, and it survives the round trip, so the next acquire
     * after unloading is leashed to the patch the player pointed at. Obeying
     * the click and banking the load first are not in conflict.
     */
    if (store.cargo[i] >= store.cargoMax[i] - 0.001) {
      this.beginReturn(i, id, time);
      return true;
    }
    if (!this.acquireOre(i, id, time)) {
      if (store.cargo[i] > 0) this.beginReturn(i, id, time);
      else this.enterIdle(i, id, time, DRY_RETRY);
    }
    return true;
  }

  /**
   * Record an order point as HANDLED, so the edge at the top of
   * `takeNewOrder` fires exactly once for it.
   *
   * WITHOUT THIS THE HANDLER LIVELOCKS. That edge is a diff of the order
   * columns against `destX/destZ`, and only `setDest` writes those — so any
   * outcome that does not publish a destination leaves the diff standing and
   * re-runs the whole path on the next tick, forever. `beginReturn` is exactly
   * such an outcome: it chooses a dock but publishes nothing (`tickReturn`
   * does that, on a tick this function's own `return true` skips).
   *
   * Measured before: a part-loaded hull redirected onto a patch whose cells
   * were all claimed by other harvesters sat in ReturnToRefinery with
   * `delivered = 0` for as long as the claims held — 19 s with two real
   * harvesters on a single-node field. Worse, `anchorOnField` resets
   * `leashDryAt` every time it runs, so the HARVESTER_LEASH_PATIENCE escape
   * could never mature and no dry notice ever reached the player. The AI is
   * bound identically, because it issues the same order through the same
   * columns.
   */
  private consumeOrder(i: number, ox: number, oz: number): void {
    this.destX.setAt(i, ox);
    this.destZ.setAt(i, oz);
  }

  /**
   * Anchor this harvester on the patch containing cell `cx,cz`, snapping to the
   * field's NODE when the cell belongs to one.
   *
   * The snap is what makes the leash mean "that patch" rather than "that pixel".
   * `HARVESTER_LEASH_METRES` is derived from a field's live radius measured FROM
   * ITS NODE (28 m against a 48 m leash); anchored on a rim cell instead, the
   * same 48 m would fail to cover the far rim of the very field the player
   * pointed at, and would simultaneously reach 20 m into the next one.
   */
  private anchorOnField(i: number, cx: number, cz: number): void {
    const store = this.world.store;
    const f = this.ore.fieldAtCell(cx, cz);
    const rec = f >= 0 ? this.ore.field(f) : undefined;
    if (rec !== undefined) {
      store.guardX[i] = rec.x;
      store.guardZ[i] = rec.z;
    } else {
      // Scrap ore outside every seeded field. The point as given is the honest
      // answer — there is no patch to snap to.
      store.guardX[i] = (cx + 0.5) * CELL;
      store.guardZ[i] = (cz + 0.5) * CELL;
    }
    this.anchored.setAt(i, 1);
    this.leashDryAt.setAt(i, -1);
  }

  /** Forget the patch. The next acquire is unleashed and re-takes an anchor. */
  private dropAnchor(i: number): void {
    if (this.anchored.getAt(i) === 0) return;
    this.anchored.setAt(i, 0);
    this.leashDryAt.setAt(i, -1);
  }

  /** The seeded field this harvester's anchor sits on, or -1 for open ground. */
  private anchorField(i: number): number {
    if (this.anchored.getAt(i) === 0) return -1;
    const store = this.world.store;
    return this.ore.fieldAtCell(
      clampCell(worldToCell(store.guardX[i])), clampCell(worldToCell(store.guardZ[i])));
  }

  /**
   * Tell this harvester's owner, ONCE, that it has run out of work.
   *
   * COALESCED PER PLAYER AND PER PATCH. Eight harvesters on one exhausted field
   * is one event, not eight: they all report the same fact about the same
   * ground, and the player's response to it is a single decision. The record is
   * the FIELD ID rather than a cooldown, so it says what was announced and not
   * merely when — which is what lets `rearmDryNotice` clear it on the real
   * change (that field became workable again) instead of on a timer that has no
   * relationship to anything.
   *
   * Ground with no seeded field under it (`-1`) is announced under that id like
   * any other, so a harvester anchored on loose scrap still reports.
   */
  private announceDry(i: number, time: number): void {
    const store = this.world.store;
    const p = store.owner[i];
    if (p >= MAX_PLAYERS) return;
    const field = this.anchorField(i);
    if (this.dryNotified[p] === field) return;
    this.dryNotified[p] = field;

    // `eva:line` AND NOT `combat:underAttack`, though the second is tempting:
    // it is the product's only "something needs you, and it is HERE" channel
    // and it carries a minimap ping. It also sets `Hud.lastAttackTime`, whose
    // advice line reads "Base under attack — check the tactical map" for ten
    // seconds. Borrowing the locate affordance would mean lying about why.
    //
    // So this goes down the announcer channel, which is audio AND a HUD toast
    // (`EVA_TOASTS` in ui/Hud.ts) — visible, and coalesced a second time by the
    // toast stack's own six-second merge on top of the per-field record above.
    const eva = this.channels.events.payload('eva:line');
    eva.player = p as PlayerId;
    eva.line = EvaLine.HarvesterIdle;
    this.channels.events.emitPooled('eva:line');
    this.lastDryEva[p] = time;
  }

  /** A field this player was told about is working again; allow a new notice. */
  private rearmDryNotice(player: number, field: number): void {
    if (player < MAX_PLAYERS && this.dryNotified[player] === field) {
      this.dryNotified[player] = DRY_NOTIFIED_NONE;
    }
  }

  /**
   * Cells of ring search needed to see the whole leash disc from where the hull
   * happens to be standing.
   *
   * THE WALK STAYS CENTRED ON THE HULL and is widened instead of re-centred on
   * the anchor, because the cell it picks must be the one nearest the
   * HARVESTER — a hauler rolling off its refinery should take the near rim of
   * its patch, not drive through it to the middle. Every existing tuning
   * decision in this file assumes that ordering.
   *
   * Widening is free in the common case: `searchRings` stops one ring past its
   * first hit, so a harvester standing on its own patch never walks past ~12
   * rings whatever this returns. It only pays when the hull is genuinely far
   * from its anchor, which is the tick after a player clicks a distant patch —
   * exactly when it must.
   */
  private leashSearchCells(i: number): number {
    const store = this.world.store;
    const hx = clampCell(worldToCell(store.posX[i]));
    const hz = clampCell(worldToCell(store.posZ[i]));
    const ax = clampCell(worldToCell(store.guardX[i]));
    const az = clampCell(worldToCell(store.guardZ[i]));
    const dx = hx > ax ? hx - ax : ax - hx;
    const dz = hz > az ? hz - az : az - hz;
    const reach = (dx > dz ? dx : dz) + LEASH_CELLS;
    return reach > ORE_SEARCH_CELLS ? Math.min(reach, MAP_CELLS) : ORE_SEARCH_CELLS;
  }

  /**
   * Move to the nearest field that still holds ore, measured FROM THIS
   * HARVESTER'S OWN REFINERY. False when no field anywhere holds anything, in
   * which case the anchor is dropped and the caller's unleashed fallbacks run.
   *
   * FROM THE REFINERY AND NOT FROM THE HULL, and that one choice is the
   * difference between expanding and suiciding. The ore has to end up at a dock,
   * so the patch worth taking is the one nearest the dock; searching from the
   * hull is how a harvester that had already drifted to the contested patch
   * concluded that the enemy's home field was its nearest option.
   */
  private reanchor(i: number, id: EntityId, time: number): boolean {
    const store = this.world.store;
    const ri = this.pickRefinery(i, time);
    const ox = ri >= 0 ? store.posX[ri] : store.posX[i];
    const oz = ri >= 0 ? store.posZ[ri] : store.posZ[i];

    // A DIFFERENT FIELD IF THERE IS ONE, and this is not `nearestField`'s
    // answer. That helper skips only EXHAUSTED fields, which covers the dry
    // case — a stripped field reads `remaining <= 0` and drops out on its own —
    // and misses the other one entirely: a patch this hull cannot REACH still
    // holds ore, so `nearestField` hands back the field we are trying to leave
    // and the harvester idles beside it forever. The current field is kept as a
    // fallback rather than banned, because staying on a patch that may come
    // back beats having no patch at all.
    const here = this.ore.fieldAtCell(
      clampCell(worldToCell(store.guardX[i])), clampCell(worldToCell(store.guardZ[i])));
    let best = -1;
    let bestD = Infinity;
    let same = -1;
    for (let f = 0; f < this.ore.fieldCount; f++) {
      const r = this.ore.field(f);
      if (r === undefined || r.remaining <= 0) continue;
      if (f === here) { same = f; continue; }
      const dx = r.x - ox;
      const dz = r.z - oz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = f; }
    }
    const pick = best >= 0 ? best : same;
    const rec = pick >= 0 ? this.ore.field(pick) : undefined;
    if (rec === undefined) {
      // Nothing seeded anywhere still holds ore. The leash must never be the
      // reason a harvester has nothing to do — same principle as "a banned cell
      // beats no cell" below, one level up — so give it up entirely and let the
      // scrap-hunting fallbacks have the map.
      this.dropAnchor(i);
      return false;
    }
    this.anchorOnField(i, rec.nodeCx, rec.nodeCz);
    this.dropClaim(i, id);
    this.resetForceBudget(i);
    return true;
  }

  /**
   * Find, lease and target the nearest unclaimed ore cell. Falls back to
   * scraps (any non-empty cell) before giving up, so the last few hundred
   * credits on a map do get collected instead of stranding four harvesters.
   *
   * LEASHED FIRST, UNLEASHED ONLY WHEN THERE IS NO ANCHOR. An anchored
   * harvester that finds nothing on its patch returns FALSE rather than falling
   * through — the caller idles it beside the patch and `decide()` retries every
   * `DRY_RETRY` while regrowth catches up. Falling through would make the leash
   * decorative: the very first stripped cell would put the whole map back in
   * scope, which is the behaviour §ANCHOR exists to stop.
   */
  private acquireOre(i: number, id: EntityId, time: number): boolean {
    if (this.anchored.getAt(i) !== 0) {
      const got = this.acquireInLeash(i, id, time);
      if (got === LEASH_WORTH_A_TRIP) {
        // The patch is alive. Clear this harvester's clock AND re-arm the
        // player's notice for this field — "the situation actually changed" is
        // exactly this, and nothing else.
        this.leashDryAt.setAt(i, -1);
        this.rearmDryNotice(this.world.store.owner[i], this.anchorField(i));
        return true;
      }
      /* ===================================================================
       * SCRAPS RUN THE CLOCK AND NOTHING READS IT. LEAVE IT.
       *
       * `leashDryAt` is set here and read by exactly one site — the
       * `LEASH_EMPTY` branch below, which this `return true` cannot reach. That
       * is write-only state, and on the face of it the whole patience escape
       * (the human's dry notice, the AI's re-anchor) should be unreachable on
       * any patch holding a crumb, which after `OreField.regrow` lifts a
       * stripped source off zero is EVERY seeded patch, forever.
       *
       * IT WAS OPENED, MEASURED AND REVERTED. Do not re-derive it. Two
       * harvesters, one refinery, two r26 fields 90 m apart, 25 sim-minutes,
       * regrowth running on the shipped interval:
       *
       *     escape shut (today)     AI mined 60 595   far field 100% -> 0%
       *     escape open             AI mined 59 631   far field 100% -> 0%
       *
       * The AI already expands, and already comes back to the recovered field
       * — because LEASH_EMPTY still fires. `takeOre` sweeps a cell to exactly
       * zero and the scraps tier's floor is one unit, so for ~1.7 s after every
       * take the source is below it and the patch reads as genuinely empty;
       * `DRY_RETRY` is 2 s, so the retry lands in that window often enough to
       * mature the clock. The unreachable branch is a smell, not a behaviour.
       *
       * Opening it for the HUMAN is worse than neutral: 25 843 ore against
       * 25 844 with it shut — the same ore — plus 24 `EvaLine.HarvesterIdle`
       * notices in 19 sim-minutes against the ONE the coalescing is designed
       * for. `rearmDryNotice` fires on a single LEASH_WORTH_A_TRIP and regrowth
       * lifts the source over ORE_MIN_CLAIM every ~14 s forever, so the patch
       * reads as "recovered, died again" once a minute. Tightening the rearm
       * instead needs a threshold between 25 and 216 that no constant names —
       * `harvester-leash.spec.ts` deliberately revives a patch with 216 ore on
       * one cell and requires the next notice to fire.
       *
       * `tests/ore-regrowth.spec.ts` is the rig that answers this, and it is
       * the only one in the suite that runs the harvester FSM with regrowth on.
       * =================================================================== */
      // Scraps count as a take but NOT as the patch being alive; the clock keeps
      // running underneath them. See the LEASH_* constants.
      if (got === LEASH_SCRAPS) {
        if (this.leashDryAt.getAt(i) < 0) this.leashDryAt.setAt(i, time);
        return true;
      }
      /* ===================================================================
       * NOTHING ON THE PATCH, FOR EITHER OF THE TWO REASONS, GETS THE SAME
       * ANSWER: WAIT, THEN RE-ANCHOR. THERE IS NO UNLEASHED ESCAPE HERE.
       *
       * The reasons really are different — NO ORE is a fact about the field and
       * regrowth undoes it, while NO REACHABLE GROUND is a fact about this hull
       * and a ban blanketing the disc is near-certain (the ban is 20 cells and
       * the leash is 12) — and an earlier draft therefore gave the second one
       * its own door: a live ban sent the acquire unleashed for one trip, on the
       * reasoning that a patch a harvester cannot reach is not its patch.
       *
       * THAT DOOR WAS THE ENTIRE REMAINING BUG. Traced on seed 4242 slot 43,
       * whose anchor was correctly set once at t217 to its own home field node
       * (224,340) and never moved again: at t795 the unleashed acquire published
       * a SeekOre destination of 274,194 — 154 m from the anchor, and 14 m from
       * the ENEMY's home field. The harvester spent the next 1450 ticks driving
       * there, which is the reported suicide with the leash fully working and
       * the anchor perfectly stable. An escape hatch that reaches 160 m from the
       * hull is not a smaller version of the leash; it is the old behaviour with
       * extra steps.
       *
       * Waiting instead costs at most HARVESTER_LEASH_PATIENCE, and the two
       * clocks line up: HARVESTER_UNREACHABLE_BAN_SECONDS is also 30, so a
       * harvester that idles out its patience has also outlived the ban that
       * caused it and gets a clean retry. If the patch is genuinely unreachable
       * rather than momentarily blocked, `reanchor` moves it — to a field chosen
       * from its REFINERY, which is the bound the escape hatch never had.
       * =================================================================== */
      const since = this.leashDryAt.getAt(i);
      if (since < 0) {
        this.leashDryAt.setAt(i, time);
        return false;
      }
      if (time - since < HARVESTER_LEASH_PATIENCE) return false;

      /* ===================================================================
       * THE PATCH IS FINISHED, AND WHO OWNS THE HARVESTER DECIDES WHAT
       * HAPPENS NEXT. This asymmetry will read as an inconsistency, so:
       *
       * A HUMAN'S harvester STOPS AND SAYS SO. That is the player's call to
       * make — "alert the user that the harvester is sitting unemployed, let
       * him send him to a new place" — and it is the only version that keeps
       * the leash honest. Anything that re-anchors on the player's behalf is
       * the module choosing a new patch for them, which is how the original
       * defect worked. The harvester idles ON the exhausted patch, where it is
       * findable, and `announceDry` tells them once.
       *
       * THE AI'S HARVESTER RE-ANCHORS ITSELF, because there is nobody to tell.
       * An AI that sat waiting for an order that will never come would convert
       * a rare suicide into a permanent economy stall in every match against
       * every AI — strictly worse than the bug, and a failure this file's own
       * header records shipping before (hulls parked with full hoppers for
       * 1200+ consecutive ticks). `PlayerState.isHuman` is the split, not
       * `isLocal`: an ally's harvester in a multiplayer match has a human
       * behind it who gets their own alert, and a replay's recorded slots are
       * all `isHuman` precisely so the AI stays shut down.
       * =================================================================== */
      if (this.world.player(this.world.store.owner[i] as PlayerId).isHuman) {
        this.announceDry(i, time);
        return false;
      }
      if (this.reanchor(i, id, time)) {
        return this.acquireInLeash(i, id, time) !== LEASH_EMPTY;
      }
      // `reanchor` gave the anchor up; fall through to the unleashed chain.
    }
    if (!this.acquireAnywhere(i, id, time)) return false;
    /* =====================================================================
     * ADOPT A PATCH ONLY IF WE DID NOT HAVE ONE. This condition is the whole
     * difference between an escape hatch and a trapdoor, and getting it wrong
     * made the reported bug measurably WORSE than doing nothing.
     *
     * A harvester reaches here still anchored only because a ban sent it out
     * for one trip. Re-anchoring it on whatever it could reach instead BINDS it
     * there permanently — and `acquireAnywhere` searches 160 m from the HULL,
     * so a harvester that had drifted as far as the contested patch adopts the
     * ENEMY's home field and settles beside their base for the rest of the
     * match. Measured with this re-anchor unconditional, seeds 4242 and 1337:
     * one harvester on each came within 42 m and 43 m of the enemy base centre
     * and spent 1631 and 1429 ticks inside 70 m of it, against 0 and 574 before
     * any of this existed. Keeping the anchor puts the same harvester back on
     * its own field the moment the ban lapses.
     *
     * The case this DOES fire for is the one it was written for: a harvester
     * nobody has ever told anything — a war-factory rollout, a refinery's free
     * harvester, a scenario spawn — adopting the patch it chose for itself. It
     * also fires after `reanchor` gave the anchor up, correctly and for the
     * same reason: there is no patch left to keep.
     * =================================================================== */
    if (this.anchored.getAt(i) === 0) {
      const packed = this.claimIdx.getAt(i);
      if (packed >= 0) this.anchorOnField(i, packed % MAP_CELLS, (packed / MAP_CELLS) | 0);
    }
    return true;
  }

  /**
   * The leashed search: the first two tiers of the unleashed chain, confined to
   * the anchor disc.
   *
   * THE BAN IS APPLIED AND NEVER DROPPED HERE, unlike the unleashed chain's
   * "a banned cell beats no cell" escape. That escape exists because the ban
   * must never be the reason a harvester has nothing to do — but under a leash
   * it is not: failing here hands the decision back to `acquireOre`, which has
   * a better answer than re-picking ground nav has proved unreachable. Taking
   * the escape here instead was measured at seed 90210 slot 37 spending 7122 of
   * 7200 ticks in SeekOre with 20 in Harvesting, one delivery and 106 m
   * covered: it re-picked the banned cell, failed to reach it, re-banned it and
   * went round again for the whole match.
   *
   * The unleashed chain's THIRD tier is missing for a structural reason rather
   * than a measured one: it re-centres the search on `nearestField`, and
   * "search from a different field" is exactly what a leash forbids.
   */
  private acquireInLeash(i: number, id: EntityId, time: number): number {
    const store = this.world.store;
    const cx = clampCell(worldToCell(store.posX[i]));
    const cz = clampCell(worldToCell(store.posZ[i]));
    const kx = clampCell(worldToCell(store.guardX[i]));
    const kz = clampCell(worldToCell(store.guardZ[i]));
    const reach = this.leashSearchCells(i);
    const bx = this.liveBan(i, time) ? this.banCx.getAt(i) : -1;
    const bz = this.banCz.getAt(i);
    const br = LEASH_BAN_CELLS;

    const worth = this.ore.findFreeOre(
      cx, cz, reach, id, ORE_MIN_CLAIM, time, this.cellOut, bx, bz, br, kx, kz, LEASH_CELLS);
    if (worth) return this.claimAndTarget(i, id, time) ? LEASH_WORTH_A_TRIP : LEASH_EMPTY;

    const scraps = this.ore.findFreeOre(
      cx, cz, reach, id, 1, time, this.cellOut, bx, bz, br, kx, kz, LEASH_CELLS);
    if (!scraps) return LEASH_EMPTY;
    return this.claimAndTarget(i, id, time) ? LEASH_SCRAPS : LEASH_EMPTY;
  }

  /** The original unleashed chain, unchanged. Reached only without an anchor. */
  private acquireAnywhere(i: number, id: EntityId, time: number): boolean {
    const store = this.world.store;
    const cx = clampCell(worldToCell(store.posX[i]));
    const cz = clampCell(worldToCell(store.posZ[i]));
    // Ground nav gave up on, if the ban is still live. -1 disables the
    // exclusion entirely, which is what every call outside a give-up gets.
    const bx = this.liveBan(i, time) ? this.banCx.getAt(i) : -1;
    const bz = this.banCz.getAt(i);
    const br = HARVESTER_UNREACHABLE_BAN_CELLS;

    let found = this.ore.findFreeOre(
      cx, cz, ORE_SEARCH_CELLS, id, ORE_MIN_CLAIM, time, this.cellOut, bx, bz, br);
    if (!found) {
      found = this.ore.findFreeOre(
        cx, cz, ORE_SEARCH_CELLS, id, 1, time, this.cellOut, bx, bz, br);
    }
    if (!found) {
      // Nothing within reach of where we stand — aim at the nearest field that
      // still holds anything and search again from there.
      const f = this.ore.nearestField(store.posX[i], store.posZ[i]);
      if (f >= 0) {
        const rec = this.ore.field(f);
        if (rec !== undefined) {
          found = this.ore.findFreeOre(
            rec.nodeCx, rec.nodeCz, ORE_SEARCH_CELLS, id, 1, time, this.cellOut, bx, bz, br);
        }
      }
    }
    if (!found && bx >= 0) {
      // A BANNED CELL BEATS NO CELL. The exclusion is a preference — "not that
      // ground, if there is any other" — and it must never be the reason a
      // harvester has nothing to do. Without this the ban could strand a hull
      // for HARVESTER_UNREACHABLE_BAN_SECONDS on a map whose only remaining ore
      // is the patch nav could not reach, which is strictly worse than the
      // behaviour it replaces.
      found = this.ore.findFreeOre(cx, cz, ORE_SEARCH_CELLS, id, 1, time, this.cellOut);
    }
    if (!found) return false;
    return this.claimAndTarget(i, id, time);
  }

  /**
   * Lease `cellOut` and drive at it. Extracted so the leashed and unleashed
   * searches commit identically — the two used to be one function and the tail
   * is the part that must not drift between them.
   */
  private claimAndTarget(i: number, id: EntityId, time: number): boolean {
    const store = this.world.store;
    if (!this.ore.claim(this.cellOut[0], this.cellOut[1], id, time)) return false;

    this.dropClaim(i, id);
    this.claimIdx.setAt(i, this.cellOut[1] * MAP_CELLS + this.cellOut[0]);
    this.setDest(i, (this.cellOut[0] + 0.5) * CELL, (this.cellOut[1] + 0.5) * CELL);
    store.state[i] = UnitState.SeekOre;
    this.resetForceBudget(i);
    this.resetProgress(i);
    return true;
  }

  /* -- scooping ---------------------------------------------------------- */

  private tickHarvest(i: number, id: EntityId, dt: number, time: number, tick: number): void {
    const store = this.world.store;
    const packed = this.claimIdx.getAt(i);
    if (packed < 0) { this.decide(i, id, time, true); return; }

    const cx = packed % MAP_CELLS;
    const cz = (packed / MAP_CELLS) | 0;
    this.ore.claim(cx, cz, id, time);

    const space = store.cargoMax[i] - store.cargo[i];
    if (space <= 0.001) { this.beginReturn(i, id, time); return; }

    const want = Math.min(HARVEST_RATE * dt, space);
    const got = this.ore.takeOre(cx, cz, want);

    if (got <= 0) {
      // This cell is finished. Hop straight to the next one without a trip
      // home — that hop is what makes a field visibly erode outward.
      this.dropClaim(i, id);
      if (!this.acquireOre(i, id, time)) {
        if (store.cargo[i] > 0) this.beginReturn(i, id, time);
        else this.enterIdle(i, id, time, DRY_RETRY);
      }
      return;
    }

    store.cargo[i] += got;

    // Sparkle, offset per entity so 8 harvesters do not all pop on one tick.
    if (((tick + i) % HARVEST_FX_INTERVAL) === 0) {
      this.channels.fx.push(
        FxKind.OreSparkle,
        store.posX[i], store.posY[i] + 1.2, store.posZ[i],
        0, 1, 0, 1, id, store.faction[i] as Faction,
      );
    }

    if (store.cargo[i] >= store.cargoMax[i] - 0.001) {
      store.cargo[i] = store.cargoMax[i];
      this.beginReturn(i, id, time);
    }
  }

  /* -- hauling ----------------------------------------------------------- */

  /**
   * Haul the load home.
   *
   * `preferRi` is a refinery the PLAYER named, by right-clicking it. It is
   * honoured over `pickRefinery`'s answer whenever it is still a usable dock —
   * that function ranks by free dock then by distance and reads no order
   * column, so it cannot express "that one". Re-validated rather than trusted,
   * because a refinery can die between the click and this call.
   */
  private beginReturn(i: number, id: EntityId, time: number, preferRi = -1): void {
    const store = this.world.store;
    this.dropClaim(i, id);
    const ri = preferRi >= 0 && this.isUsableRefinery(preferRi, store.owner[i])
      ? preferRi
      : this.pickRefinery(i, time);
    if (ri < 0) {
      store.dockTarget[i] = NONE as number;
      this.enterIdle(i, id, time, DRY_RETRY);
      return;
    }
    store.dockTarget[i] = store.handleOf(ri) as number;
    store.state[i] = UnitState.ReturnToRefinery;
    this.nextScore.setAt(i, time + SCORE_PERIOD);
    // A fresh haul is a fresh approach: neither the stand-down nor the failed
    // -approach count from the PREVIOUS trip should decide this one.
    this.dockStandDown.setAt(i, 0);
    this.dockTries.setAt(i, 0);
    this.forceTries.setAt(i, 0);
    this.resetProgress(i);
    this.resetPin(i);
    // Choose the approach ONCE, here, while the try counter and the lock are
    // both freshly reset. Every later tick reads it; only a counted escalation
    // replaces it.
    this.commitDockPoint(i, ri, this.tryHoldDock(store.handleOf(ri), id));
  }

  /**
   * Where this harvester is driving for THIS approach, in world metres, written
   * into `dockOut`.
   *
   * ============================ THE CHURN ==================================
   * This used to be computed inline in `tickReturn`, every tick, from three
   * things that all move: whether we currently hold the dock lock (worth 9 m of
   * goal displacement), whether the fallback try-count had been reached, and —
   * worst — `reachableDockPoint`, which returns the ring cell nearest to THE
   * HULL and therefore slid the goal along with the hull as it drove.
   *
   * `NavAssigner` treats any goal movement over `NAV_FORMATION_GOAL_EPS` (0.6 m)
   * as a brand-new order: it drops the formation slot, re-requests the flow
   * field, restarts the progress watchdog and — the part that actually broke
   * the unit — re-arms the wedge anchor. The wedge ladder needs
   * `NAV_WEDGE_SAMPLE_TICKS * NAV_WEDGE_STRIKES` = 180 consecutive ticks of
   * evidence before it may lift a jammed hull out.
   *
   * Measured on seed 4242 slot 83: 20 goal changes in 3000 ticks, one every
   * ~150 ticks. The ladder could never reach 180. It was not that the rescue
   * failed — it was never allowed to start, for the whole match, because the
   * module asking for the rescue was resetting the evidence faster than the
   * evidence could accumulate.
   *
   * So the approach point is COMMITTED: chosen once per approach, held in
   * `dockX/dockZ`, and re-chosen only by an explicit counted escalation. A
   * harvester that changes its mind must do so as a decision, not as a side
   * effect of having moved.
   * =========================================================================
   */
  private commitDockPoint(i: number, ri: number, mine: boolean): void {
    const store = this.world.store;
    const yaw = store.yaw[ri];
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const reach = dockApronDistance(
      Math.max(1, store.footprintW[ri]) * CELL * 0.5,
      Math.max(1, store.footprintH[ri]) * CELL * 0.5,
      fwdX, fwdZ, store.radius[i],
    );

    // AFTER ENOUGH FAILED APPROACHES, STOP AIMING AT THE APRON. The apron is a
    // fixed point in front of the refinery and a base layout is free to bury it
    // — measured on the stock skirmish map, a refinery at yaw -0.87 aims its
    // dock into a pocket ringed by three of its owner's own structures. Aiming
    // at open ground touching the footprint instead lets nav park the hull
    // against whichever face it can reach, and `touching(i, ri)` then docks it.
    if (mine && this.dockTries.getAt(i) >= HARVESTER_DOCK_FALLBACK_TRIES
        && this.reachableDockPoint(i, ri, this.dockOut)) {
      this.dockX.setAt(i, this.dockOut[0]);
      this.dockZ.setAt(i, this.dockOut[1]);
      return;
    }

    /* Not holding the dock: take a QUEUE SLOT, indexed, so haulers form a line
     * instead of all aiming at one point and shoving each other off it. The
     * index is this harvester's rank among everyone waiting on the same
     * refinery, ordered by handle so both clients of a lockstep match agree.
     *
     * THAT PARAGRAPH WAS HERE FOR A RELEASE BEFORE THE CODE WAS. The line under
     * it read `mine ? reach : reach + HARVESTER_QUEUE_GAP` — one point, for
     * every waiter — while `queueRank` sat twenty lines below computing exactly
     * the index described, called once and collapsed to a boolean for an
     * unrelated stand-down test. Reported as "Ore harvesters: They keep
     * clashing each other", which is precisely what N hulls converging on one
     * coordinate looks like: they settle about `radius[i] + radius[j]` = 7.7 m
     * apart by `Movement.relax` and shove each other the whole way in, and
     * again every time the dock lock changes hands.
     *
     * THE RANK IS TAKEN ONCE PER COMMIT, never per tick, and that is the part
     * that is easy to get wrong. `commitDockPoint`'s own header exists because
     * a goal that moves every tick starves nav's watchdogs of the stable
     * evidence they accumulate; re-ranking on every tick would move the goal
     * by a whole `HARVESTER_QUEUE_GAP` each time a hauler ahead docked or died,
     * which is fifteen times `NAV_FORMATION_GOAL_EPS` and re-arms the wedge
     * ladder. The existing call sites — `beginReturn`, the refinery re-pick,
     * the lock hand-over and the counted escalations — are already exactly the
     * set of moments at which re-ranking is correct.
     *
     * THE LATERAL STAGGER is what makes it a queue rather than a column. A pure
     * line along the approach axis puts every waiter on the lane the docked
     * hauler has to drive OUT along; alternating half a gap left and right by
     * rank parity keeps the lane clear and reads as a car park rather than a
     * traffic jam. `rank & 1` is integer arithmetic, so it is bit-identical
     * across machines.
     */
    if (mine) {
      this.dockX.setAt(i, store.posX[ri] + fwdX * reach);
      this.dockZ.setAt(i, store.posZ[ri] + fwdZ * reach);
      return;
    }
    const rank = this.queueRank(i, ri);
    const out = reach + HARVESTER_QUEUE_GAP * (rank + 1);
    // Perpendicular to the approach axis, in the ground plane.
    const sideX = fwdZ;
    const sideZ = -fwdX;
    const lateral = ((rank & 1) === 0 ? 1 : -1) * HARVESTER_QUEUE_GAP * 0.5 * (rank === 0 ? 0 : 1);
    this.dockX.setAt(i, clampWorld(store.posX[ri] + fwdX * out + sideX * lateral, 2));
    this.dockZ.setAt(i, clampWorld(store.posZ[ri] + fwdZ * out + sideZ * lateral, 2));
  }

  /**
   * How many OTHER harvesters with a lower handle are waiting on refinery `ri`.
   *
   * Handle order rather than arrival order: it needs no extra state, it is
   * stable while the queue is stable, and it is identical on every machine —
   * arrival order would need a timestamp per hauler and would reshuffle the
   * whole line every time one of them docked.
   */
  private queueRank(i: number, ri: number): number {
    const store = this.world.store;
    const refId = store.handleOf(ri) as number;
    const me = store.handleOf(i) as number;
    let rank = 0;
    const n = store.aliveCount;
    for (let a = 0; a < n; a++) {
      const j = store.alive[a];
      if (j === i) continue;
      if ((store.flags[j] & EntityFlag.IsHarvester) === 0) continue;
      if (store.state[j] !== UnitState.ReturnToRefinery) continue;
      if (store.dockTarget[j] !== refId) continue;
      if ((store.handleOf(j) as number) < me) rank++;
    }
    return rank;
  }

  private tickReturn(i: number, id: EntityId, dt: number, time: number): void {
    const store = this.world.store;
    let ri = store.index(store.dockTarget[i] as EntityId);
    if (ri < 0 || !this.isUsableRefinery(ri, store.owner[i])) {
      ri = this.pickRefinery(i, time);
      if (ri < 0) {
        store.dockTarget[i] = NONE as number;
        this.enterIdle(i, id, time, DRY_RETRY);
        return;
      }
      store.dockTarget[i] = store.handleOf(ri) as number;
      this.resetProgress(i);
      this.resetPin(i);
      this.commitDockPoint(i, ri, this.tryHoldDock(store.handleOf(ri), id));
    }

    const refId = store.handleOf(ri);
    // A harvester that has just given up on this dock does NOT contend for it.
    // Without the stand-down the release below is a livelock rather than a
    // yield: see HARVESTER_DOCK_STANDDOWN for the measured trace.
    //
    // STANDING DOWN FOR NOBODY IS PURE CHURN. The stand-down is a yield, and a
    // yield with no one to yield TO costs a goal change (9 m, so a new order to
    // nav) and buys nothing. Only honour it while somebody else is actually
    // waiting on this refinery.
    const contended = this.queueRank(i, ri) > 0 || this.dockHolder.get(refId) !== (id as number);
    const standing = contended && time < this.dockStandDown.getAt(i);
    const held = this.dockHolder.get(refId) === (id as number);
    const mine = !standing && this.tryHoldDock(refId, id);
    // The lock changing hands is a real decision and the one legitimate reason
    // to move the goal mid-approach: re-commit once, here, rather than letting
    // every tick recompute it.
    if (mine !== held) this.commitDockPoint(i, ri, mine);

    // The committed point, chosen by `commitDockPoint` on entry or on an
    // explicit escalation. Read, never recomputed — see that function's header.
    const tx = this.dockX.getAt(i);
    const tz = this.dockZ.getAt(i);
    this.setDest(i, tx, tz);

    const d = dist2(store.posX[i], store.posZ[i], tx, tz);
    // Docked if we reached the apron, OR if the hull is simply touching the
    // refinery. The second test is not laziness — a harvester can end up
    // overlapping the structure (spawned there by a scenario, shoved there by
    // crowd relaxation) and once it is inside a blocked footprint the
    // pathfinder has no valid direction to give it and will never extract it.
    // A full harvester frozen against the side of its own refinery is the most
    // visible way this system can fail, so touching counts.
    if (mine && (d <= this.arriveAt(i, HARVESTER_DOCK_RADIUS) || this.touching(i, ri))) {
      store.state[i] = UnitState.Docked;
      store.speed[i] = 0;
      store.velX[i] = 0;
      store.velZ[i] = 0;
      this.dockTries.setAt(i, 0);
      this.dockStandDown.setAt(i, 0);
      this.resetProgress(i);
      return;
    }

    // THE SAME GIVE-UP THE SEEK PATH USES, and it has to live here too because
    // the two halves fail differently. A hauler that cannot reach its dock is
    // the worse of the pair — it is carrying a full hopper, so the credits are
    // mined and simply never arrive. Measured on seed 1337 slot 83: 7076 of
    // 7200 ticks in `ReturnToRefinery`, pinned at 308,203, ZERO deliveries in
    // four minutes, with its committed dock point alternating between two
    // refineries 27 m apart while the hull covered 74 m in total.
    //
    // Unlike the seek path this is checked for a QUEUED hauler as well as the
    // one holding the lock. Standing still in a queue is legitimate, but it is
    // legitimate at the queue point, and `trackPinned` is anchored on POSITION:
    // a hauler that has reached its queue slot is docked or moving up within
    // seconds, and one that has not moved a metre in eight while its own
    // backstop was driving is not queuing, it is stuck.
    if (this.trackPinned(i, dt) && this.forceTries.getAt(i) >= HARVESTER_FORCE_DRIVE_TRIES) {
      // THE APRON BEFORE THE REFINERY. An unreachable dock POINT and an
      // unreachable REFINERY are different diagnoses, and the cheap one is far
      // more common: `HARVESTER_DOCK_FALLBACK_TRIES` already documents a stock
      // layout that aims a refinery's apron into a pocket of its owner's own
      // buildings. So spend that escalation first — it aims at open ground
      // touching the footprint instead, and `touching()` then docks the hull
      // against whichever face it can reach — and only condemn the whole
      // structure if a hull that is already using the fallback still cannot
      // move. Measured across all three seed sets, condemning the refinery
      // immediately instead cost 3, 3 and 8 deliveries.
      if (this.dockTries.getAt(i) < HARVESTER_DOCK_FALLBACK_TRIES) {
        this.dockTries.setAt(i, HARVESTER_DOCK_FALLBACK_TRIES);
        this.forceTries.setAt(i, 0);
        this.resetProgress(i);
        this.commitDockPoint(i, ri, this.tryHoldDock(refId, id));
        return;
      }
      this.releaseDock(refId, id);
      this.banRef.setAt(i, refId as number);
      this.banRefUntil.setAt(i, time + HARVESTER_UNREACHABLE_BAN_SECONDS);
      const alt = this.pickRefinery(i, time);
      if (alt < 0) {
        store.dockTarget[i] = NONE as number;
        this.enterIdle(i, id, time, DRY_RETRY);
        return;
      }
      store.dockTarget[i] = store.handleOf(alt) as number;
      // A different refinery is a fresh approach, so it gets a fresh budget —
      // the try counter that ran out belonged to the dock we have just left.
      this.dockTries.setAt(i, 0);
      this.dockStandDown.setAt(i, 0);
      this.forceTries.setAt(i, 0);
      this.resetProgress(i);
      this.commitDockPoint(i, alt, this.tryHoldDock(store.handleOf(alt), id));
      return;
    }

    // Only the harvester actually holding the dock can be "stuck": one that is
    // queued is supposed to be sitting still.
    if (mine && this.trackProgress(i, d, dt)) {
      // YIELD, DO NOT RE-CONTEND. `dockTarget` is deliberately KEPT: clearing
      // it sent the next tick through `pickRefinery`, which picked the same
      // refinery straight back and made the release a no-op that had already
      // cost the other hauler its path. Releasing the hold plus standing down
      // for longer than the other one's stuck window is what turns this into a
      // real yield — and the try counter is what eventually stops it aiming at
      // an apron it has now failed to reach twice.
      // Same reasoning as `tickSeek`: try actually driving it before deciding
      // the approach is at fault. A hauler that cannot round its own base is
      // not a hauler that needs a different dock.
      if (this.forceTries.getAt(i) < HARVESTER_FORCE_DRIVE_TRIES) {
        this.forceTries.setAt(i, this.forceTries.getAt(i) + 1);
        this.forceDrive.setAt(i, HARVESTER_FORCE_DRIVE_SECONDS);
        this.resetProgress(i);
        return;
      }
      this.releaseDock(refId, id);
      this.dockTries.setAt(i, this.dockTries.getAt(i) + 1);
      this.dockStandDown.setAt(i, time + HARVESTER_DOCK_STANDDOWN);
      this.resetProgress(i);
      // THIS is the counted escalation the committed point exists for: the
      // approach has now demonstrably failed, so choosing a different one is a
      // decision rather than churn. Recommitting here — and only here — is what
      // keeps the goal still for the 180 ticks nav's wedge ladder needs.
      this.commitDockPoint(i, ri, false);
    }
  }

  /* ==========================================================================
   * §DEED — ORE IS SOLD WHERE IT IS UNLOADED, AND THE DEED-HOLDER IS PAID
   *
   * Reported as "Occupying an enemy ore building should give me his income".
   * The full audit of what does and does not follow a captured building is at
   * `captureBuilding` in `src/sim/Capture.ts`. What changed is one guard and
   * one deposit here, plus the split of `isUsableRefinery` below that gives the
   * guard something to call.
   *
   * WHAT WAS TRUE BEFORE, AND IT WAS NOT SO MUCH WRONG AS UNFALSIFIABLE. The
   * deposit was keyed on `store.owner[i]` — the HAULER. `isUsableRefinery`
   * requires `areAllied`; the only alliance this game has is with yourself and
   * with Gaia (`createPlayerState` seeds `allyMask` with the self bit and
   * `Scenarios.addGaia` adds one more — nothing else writes that field); and no
   * Gaia structure carries `EntityFlag.IsRefinery`. So "hauler's owner" and
   * "refinery's owner" named the same player in every state the game could
   * reach, and the requested feature had nowhere to live.
   *
   * THE RULE NOW: a load is sold at the dock that takes it, and the money goes
   * to whoever holds that building's deed. That is the same argument
   * `src/sim/civilian.system.ts` makes for a drip over a lump — the payout is a
   * function of who holds the deed at the moment ore moves, and of nothing else
   * — and it buys the same property: THERE IS NO CAPTURE EDGE TO FARM. Every
   * credit paid here is a credit of ore `takeOre` removed from the ground, so
   * capture on its own mints exactly zero and flipping a building back and
   * forth pays nothing however fast it is done. A lump on `building:captured`
   * would have been farmable through `GarrisonService.enter`/`releaseEmptied`,
   * which is why Civilians.ts refuses one.
   *
   * THE GUARD IS `refineryCanTakeOre`, NOT `isUsableRefinery`, AND ONLY HERE.
   * `UnitState.Docked` is entered by `tickReturn` alone and only ever at a
   * refinery this harvester was ALLOWED to choose, so widening the test here
   * cannot make anything drive anywhere: it grandfathers a hull already parked
   * with its hopper emptying into a bay that changed hands underneath it. That
   * ore is physically inside the building. It belongs to the building.
   *
   * DO NOT WIDEN IT TO `tickReturn` — §ANCHOR is the reason, in the file's own
   * words ("sometimes they just suicide and going to enemy camp"). The victim's
   * other miners re-pick and go home, which is what they should do.
   *
   * WHAT IT IS WORTH, MEASURED. One hopper, minus whatever was already banked
   * before the flip: HARVESTER_CAPACITY 700 at ORE_VALUE 1.0 for the Allies and
   * Soviets, 600 Reclamation, 450 Meridian. In `tests/capture-economy.spec.ts`
   * a full Soviet hopper docked at the instant of capture pays the captor 700
   * and the victim 0; before this change it paid the victim 700 and the captor
   * 0. The rest of the swing is the building itself — `recomputeStorage` moves
   * REFINERY_STORAGE (2000) of cap from one bank to the other on the capture
   * tick — and the drive the victim's remaining miners now have to make.
   *
   * THE YIELD MULTIPLIER FOLLOWS THE BUYER, for the same reason the credits do:
   * it is a property of the refinery doing the selling, not of the truck.
   * `Economy.deposit` reads `resourceBonus` off the player it is paying, so the
   * AI difficulty handicap follows on its own without a second decision here.
   * ========================================================================== */
  private tickDock(i: number, id: EntityId, dt: number, time: number): void {
    const store = this.world.store;
    const refId = store.dockTarget[i] as EntityId;
    const ri = store.index(refId);
    if (ri < 0 || !this.refineryCanTakeOre(ri)) {
      // The refinery died under us mid-unload. Keep whatever is left in the
      // hopper and find another one. NOTE the structural guard: a refinery that
      // merely changed HANDS is still a working dock and we finish the load
      // into it — see §DEED. Only a dead, pending or unfinished one ends this.
      this.releaseDock(refId, id);
      store.dockTarget[i] = NONE as number;
      store.state[i] = UnitState.ReturnToRefinery;
      this.resetProgress(i);
      return;
    }

    this.tryHoldDock(refId, id);
    store.speed[i] = 0;
    store.velX[i] = 0;
    store.velZ[i] = 0;

    const rate = store.cargoMax[i] / UNLOAD_SECONDS;
    let moved = rate * dt;
    if (moved > store.cargo[i]) moved = store.cargo[i];
    if (moved > 0) {
      store.cargo[i] -= moved;
      // THE PURCHASED YIELD MULTIPLIER, read at the instant the ore is sold.
      //
      // On the CREDITS, not on `cargoMax` and not on the scoop rate. Scaling
      // the hopper would change how long a harvester spends at the ore face and
      // at the dock, which is a pathing and traffic change dressed up as an
      // economy one; scaling the payout is exactly and only "every load is
      // worth more", which is what the blurb promises.
      //
      // AND THE BUYER IS THE REFINERY'S OWNER, NOT THE HAULER'S. See §DEED.
      const buyer = store.owner[ri] as PlayerId;
      const credits = moved * ORE_VALUE
        * upgradeGlobalMul(this.world.players[buyer as number], UpgradeLever.Yield);
      this.economy.deposit(buyer, credits, CreditReason.Harvest);
      this.deliveredTotal += credits;
    }

    if (store.cargo[i] <= 0.001) {
      store.cargo[i] = 0;
      this.releaseDock(refId, id);
      this.channels.fx.push(
        FxKind.DustPuff,
        store.posX[i], store.posY[i] + 0.4, store.posZ[i],
        0, 1, 0, 1.2, id, store.faction[i] as Faction,
      );
      this.decide(i, id, time, true);
    }
  }

  /* -- refineries and docks ---------------------------------------------- */

  /**
   * Nearest usable refinery, by slot index, or -1. Buildings are few, so a
   * linear scan of the per-kind dense list beats a spatial query that would
   * have to sweep half the bucket grid to find one at map scale.
   */
  private pickRefinery(i: number, time: number): number {
    const store = this.world.store;
    const owner = store.owner[i];
    const list = store.byKind[EntityKind.Building];
    const count = store.byKindCount[EntityKind.Building];
    const px = store.posX[i];
    const pz = store.posZ[i];

    let best = -1;
    let bestD = Infinity;
    let bestFree = false;
    const id = store.handleOf(i);
    // A refinery nav gave up on approaching, if the ban is still live. Skipped
    // on the first pass and accepted on the second: a banned refinery beats no
    // refinery, exactly as a banned ore cell beats no ore cell, because a
    // harvester with a full hopper and nowhere to take it is the failure this
    // whole module exists to prevent.
    const banned = time < this.banRefUntil.getAt(i) ? this.banRef.getAt(i) : 0;

    for (let pass = 0; pass < 2; pass++) {
      const skip = pass === 0 ? banned : 0;
      for (let k = 0; k < count; k++) {
        const ri = list[k];
        if (!this.isUsableRefinery(ri, owner)) continue;
        if (skip !== 0 && (store.handleOf(ri) as number) === skip) continue;
        const dx = store.posX[ri] - px;
        const dz = store.posZ[ri] - pz;
        const d = dx * dx + dz * dz;

        // Prefer a refinery whose dock is free even if it is a little further:
        // queueing behind a full hauler costs more than the extra drive.
        const holder = this.dockHolder.get(store.handleOf(ri));
        const free = holder === 0 || holder === (id as number)
          || !this.holderStillDocking(holder, ri);
        if (best < 0 || (free && !bestFree) || (free === bestFree && d < bestD)) {
          best = ri;
          bestD = d;
          bestFree = free;
        }
      }
      if (best >= 0 || banned === 0) break;
    }
    return best;
  }

  /** True if unit `i`'s hull circle overlaps building `bi`'s footprint rect. */
  private touching(i: number, bi: number): boolean {
    const store = this.world.store;
    const halfW = Math.max(1, store.footprintW[bi]) * CELL * 0.5;
    const halfH = Math.max(1, store.footprintH[bi]) * CELL * 0.5;
    let dx = Math.abs(store.posX[i] - store.posX[bi]) - halfW;
    let dz = Math.abs(store.posZ[i] - store.posZ[bi]) - halfH;
    if (dx < 0) dx = 0;
    if (dz < 0) dz = 0;
    const r = store.radius[i];
    return dx * dx + dz * dz <= r * r;
  }

  /**
   * The STRUCTURAL half of "can ore be unloaded here": a finished, live
   * refinery, with no question of whose it is.
   *
   * Split out of `isUsableRefinery` because the two halves are asked at
   * different moments and they stopped being one question the day capture
   * shipped. CHOOSING a dock is an ownership question. Being ALREADY PARKED at
   * one, with the hopper emptying into its bay, is not. See §DEED at `tickDock`
   * — this is its guard, and it has exactly that one caller.
   */
  private refineryCanTakeOre(ri: number): boolean {
    const store = this.world.store;
    const f = store.flags[ri];
    if ((f & EntityFlag.IsRefinery) === 0) return false;
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) return false;
    return store.buildProgress[ri] >= 1;
  }

  /**
   * ...plus the ownership half. This is the CHOOSING test — `pickRefinery`,
   * `beginReturn`, `tickReturn` and `takeNewOrder` all go through it — and it
   * must go on refusing an enemy refinery outright, for the reason §ANCHOR
   * exists: a harvester that keeps hauling to a dock the enemy now holds is a
   * harvester driving into the enemy base, which is the reported defect that
   * whole section answers.
   */
  private isUsableRefinery(ri: number, owner: number): boolean {
    if (!this.refineryCanTakeOre(ri)) return false;
    return this.world.areAllied(owner as PlayerId, this.world.store.owner[ri] as PlayerId);
  }

  /** True if `holder` is still a live harvester actively using `ri`'s dock. */
  private holderStillDocking(holder: number, ri: number): boolean {
    const store = this.world.store;
    const hi = store.index(holder as EntityId);
    if (hi < 0) return false;
    if ((store.flags[hi] & EntityFlag.PendingDestroy) !== 0) return false;
    const s = store.state[hi];
    if (s !== UnitState.Docked && s !== UnitState.ReturnToRefinery) return false;
    return store.dockTarget[hi] === (store.handleOf(ri) as number);
  }

  /** Take the dock if it is free (or already ours). Returns true if we hold it. */
  private tryHoldDock(refId: EntityId, id: EntityId): boolean {
    const holder = this.dockHolder.get(refId);
    if (holder === (id as number)) return true;
    const ri = this.world.store.index(refId);
    if (holder !== 0 && ri >= 0 && this.holderStillDocking(holder, ri)) return false;
    this.dockHolder.set(refId, id as number);
    return true;
  }

  private releaseDock(refId: EntityId, id: EntityId): void {
    if (this.dockHolder.get(refId) === (id as number)) this.dockHolder.set(refId, 0);
  }

  /* -- shared helpers ----------------------------------------------------- */

  /**
   * Publish where this harvester wants to be.
   *
   * `orderX/orderZ` is what nav reads (see the header); `destX/destZ` is the
   * private copy the fallback mover uses, kept separate so that if a Command
   * system ever overwrites the order columns the fallback follows the player's
   * intent rather than fighting it. `orderKind` is stamped Harvest so a
   * selection panel, an AI or an idle-unit scan can all tell at a glance that
   * this vehicle is busy and not awaiting instructions.
   */
  private setDest(i: number, x: number, z: number): void {
    const store = this.world.store;
    this.destX.setAt(i, x);
    this.destZ.setAt(i, z);
    store.orderX[i] = x;
    store.orderZ[i] = z;
    store.orderKind[i] = OrderKind.Harvest;
  }

  /**
   * Arrival distance for this hull. A slack over the unit's own radius, never
   * an absolute — nav parks a unit at `radius + NAV_ARRIVE_SLACK` and releases
   * its field, so a tighter test here would strand a harvester a few metres
   * short of a cell nothing was going to drive it any closer to.
   */
  private arriveAt(i: number, slack: number): number {
    return this.world.store.radius[i] + slack;
  }

  private dropClaim(i: number, id: EntityId): void {
    const packed = this.claimIdx.getAt(i);
    if (packed < 0) return;
    this.ore.release(packed % MAP_CELLS, (packed / MAP_CELLS) | 0, id);
    this.claimIdx.setAt(i, -1);
  }

  private enterIdle(i: number, id: EntityId, time: number, retryIn: number): void {
    const store = this.world.store;
    this.dropClaim(i, id);
    store.state[i] = UnitState.Idle;
    store.speed[i] = 0;
    store.velX[i] = 0;
    store.velZ[i] = 0;
    // PUBLISHED, NOT JUST RECORDED. This used to write `destX/destZ` alone and
    // leave `orderX/orderZ` holding the cell we gave up on, which is a lie in
    // the one direction that matters now: `takeNewOrder` reads a difference
    // between those two pairs as "somebody else wrote an order", so every idle
    // harvester would have re-read its own abandoned cell as a fresh player
    // click — re-anchoring on it and resetting the patience clock every
    // `DRY_RETRY`, so the clock could never reach HARVESTER_LEASH_PATIENCE.
    // Publishing the hull's own position is also what `OrderKind.Stop` does,
    // and it is honest: an idle harvester has nowhere to be but here.
    this.setDest(i, store.posX[i], store.posZ[i]);
    this.nextScore.setAt(i, time + retryIn);
    this.resetProgress(i);
  }

  private resetProgress(i: number): void {
    this.bestGap.setAt(i, 1e9);
    this.stuckFor.setAt(i, 0);
  }

  /** True while this harvester still holds a live unreachable-ground ban. */
  private liveBan(i: number, time: number): boolean {
    return this.banCx.getAt(i) >= 0 && time < this.banUntil.getAt(i);
  }

  /**
   * Has this hull failed to physically move for HARVESTER_NAV_GIVEUP_SECONDS?
   *
   * Call it EVERY tick of a goal-seeking state, whatever you intend to do with
   * the answer — the anchor is only fresh if it is sampled continuously, and a
   * watchdog that is only read once the caller already suspects trouble is
   * measuring the wrong window.
   *
   * Deliberately NOT folded into `trackProgress`. That one resets on its own
   * firing, every HARVESTER_STUCK_SECONDS, so a counter sharing its state could
   * never reach a longer horizon; and the two ask different questions — see the
   * block in `tickSeek` that consumes this.
   */
  private trackPinned(i: number, dt: number): boolean {
    const store = this.world.store;
    const dx = store.posX[i] - this.pinX.getAt(i);
    const dz = store.posZ[i] - this.pinZ.getAt(i);
    if (dx * dx + dz * dz >= HARVESTER_NAV_GIVEUP_METRES * HARVESTER_NAV_GIVEUP_METRES) {
      this.resetPin(i);
      return false;
    }
    const t = this.pinnedFor.getAt(i) + dt;
    if (t < HARVESTER_NAV_GIVEUP_SECONDS) {
      this.pinnedFor.setAt(i, t);
      return false;
    }
    this.resetPin(i);
    return true;
  }

  /** Re-anchor the give-up watchdog here, and restart its clock. */
  private resetPin(i: number): void {
    const store = this.world.store;
    this.pinX.setAt(i, store.posX[i]);
    this.pinZ.setAt(i, store.posZ[i]);
    this.pinnedFor.setAt(i, 0);
  }

  /**
   * A new destination gets a new force-drive budget. Kept separate from
   * `resetProgress` on purpose: that is called every time the watchdog re-arms,
   * including from inside a force-drive window, and resetting the budget there
   * would make `HARVESTER_FORCE_DRIVE_TRIES` unbounded.
   */
  private resetForceBudget(i: number): void {
    this.forceTries.setAt(i, 0);
    this.forceDrive.setAt(i, 0);
    // A new destination is a new question for the give-up watchdog too: the
    // hull may have been standing still very sensibly, right on top of the
    // thing it was told to go to.
    this.resetPin(i);
  }

  /**
   * Stuck detection: the distance to the destination has to keep setting new
   * lows. Measuring "did we move" instead would call a harvester healthy while
   * it slid endlessly along a wall.
   */
  private trackProgress(i: number, dist: number, dt: number): boolean {
    const best = this.bestGap.getAt(i);
    if (dist < best - PROGRESS_EPSILON) {
      this.bestGap.setAt(i, dist);
      this.stuckFor.setAt(i, 0);
      return false;
    }
    const t = this.stuckFor.getAt(i) + dt;
    if (t < HARVESTER_STUCK_SECONDS) {
      this.stuckFor.setAt(i, t);
      return false;
    }
    this.resetProgress(i);
    return true;
  }

  /* ======================================================================
   * UNDER ATTACK
   * ====================================================================== */

  private onDamaged(id: EntityId, player: PlayerId, x: number, z: number): void {
    const store = this.world.store;
    const i = store.index(id);
    if (i < 0) return;
    if ((store.flags[i] & EntityFlag.IsHarvester) === 0) return;

    const p = player as number;
    if (p >= MAX_PLAYERS) return;
    if (this.world.time - this.lastUnderAttackEva[p] < UNDER_ATTACK_COOLDOWN) return;
    this.lastUnderAttackEva[p] = this.world.time;

    const attack = this.channels.events.payload('combat:underAttack');
    attack.player = player;
    attack.x = x;
    attack.z = z;
    attack.isBuilding = false;
    this.channels.events.emitPooled('combat:underAttack');

    const eva = this.channels.events.payload('eva:line');
    eva.player = player;
    eva.line = EvaLine.OreMinerUnderAttack;
    this.channels.events.emitPooled('eva:line');
  }

  /* ======================================================================
   * BACKSTOP LOCOMOTION — see the file header before editing
   * ====================================================================== */

  /**
   * Drive every harvester this module is still responsible for. Runs at
   * Phase.Movement (registered as a separate module by economy.system.ts) so
   * position is written from the phase that owns position.
   */
  drive(dt: number): void {
    this.drivenThisTick = 0;
    if (driveMode === 'off') return;
    const assist = driveMode === 'assist';

    const w = this.world;
    const store = w.store;
    const n = store.aliveCount;

    for (let a = 0; a < n; a++) {
      const i = store.alive[a];
      const f = store.flags[i];
      if ((f & EntityFlag.IsHarvester) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Immobilized)) !== 0) continue;

      const state = store.state[i];
      const hauling = state === UnitState.SeekOre || state === UnitState.ReturnToRefinery;

      // WEDGED: the hull is INSIDE a structure's footprint. No flow field can
      // extract it, because every cell it is standing in is blocked, so all
      // THREE guards below are bypassed — including "nav holds a field for this
      // unit". Holding a field is not the same as being helped by one: the
      // integration never reached a blocked cell, so `sample` has no direction
      // to give and the unit sits inside the wall at full throttle. This check
      // used to sit BELOW the field guard, which meant the one case it was
      // written for — a harvester overlapping the refinery it is docking at,
      // which still has a live field — fell straight through it.
      //
      // Self-clearing: the moment the hull is outside the rect this stops
      // firing and normal handling resumes.
      // Idle is in here as well as the two hauling states. A harvester stranded
      // on a blocked cell while Idle never becomes un-stranded on its own — it
      // re-scores, picks a cell, publishes a destination and then cannot move
      // toward it — so excluding Idle would leave the recovery unable to reach
      // the state its own retry loop drops into. Docked is deliberately NOT
      // here: that hull is parked against a refinery on purpose.
      const recoverable = hauling || state === UnitState.Idle;
      if (recoverable) {
        const wedged = this.wedgedIn(i);
        if (wedged >= 0) {
          this.drivenThisTick++;
          this.driveEscape(i, dt, wedged, assist);
          continue;
        }
        // Not inside a structure, but standing on ground no field integrated
        // into. Same dead end, different cause — see `strandedOnBlockedGround`.
        if (this.strandedOnBlockedGround(i)) {
          this.drivenThisTick++;
          this.driveUnstrand(i, dt, assist);
          continue;
        }
      }

      // The real pathfinder holds a field for this unit. That USED to end the
      // discussion — `if (store.navField[i] >= 0) continue;` — on the stated
      // premise that holding a field means being driven by one.
      //
      // THE PREMISE IS FALSE IN EXACTLY THE CASE THIS MODULE EXISTS FOR, and
      // the header of this file describes that case without the code ever
      // testing for it. `NavAssigner`'s give-up path calls `finishOrder`: it
      // sets `AgentFlag.Arrived` and zeroes `velX/velZ`, and a harvester nav
      // has abandoned still reads `navField >= 0`, so this guard skipped it
      // forever and the rescue two lines below could never fire. Traced:
      // parked at 308.0,203.1 with a full hopper 15 m from its refinery,
      // `aflags=14` (Arrived|HasSlot|Displaced), `spd=0`, unchanged for 1200
      // consecutive ticks, while `stats().driven` read 0 for the whole match.
      //
      // THE ROUTE TO `navField >= 0` IS NOT THE ONE THIS USED TO CLAIM. It said
      // `finishOrder` "does NOT release `navField`", and it does — first line of
      // the function. What puts the field straight back is the CALLER: the
      // wedge ladder's park rung returns false from `unwedge`, meaning "the
      // position did not change", so `NavAssigner`'s loop does not `continue`
      // and falls through to its own field block, which sees `navField < 0`,
      // calls that a missing field and re-requests one on the same tick.
      // Re-verified on seed 4242 slot 43: `aflags=14`, `escalations=3`,
      // `navField=6`, for 2100 consecutive ticks. The conclusion below is
      // unchanged and so is the code; only the mechanism was mis-stated. It
      // matters because it rules out `navField < 0` as a give-up signal for the
      // FSM — see `trackPinned`.
      //
      // The honest question is "is nav MOVING it", and the honest signal is
      // velocity: Steering writes velX/velZ to zero for precisely the units it
      // is not asking Movement to move. So a field is only a reason to keep
      // hands off while the unit is actually being moved by it, or while it is
      // close enough that stopping is the right answer.
      // A force-drive window outranks every guard below it. It is only ever
      // opened by the FSM's own progress watchdog, which has by then watched
      // this hull fail to move for HARVESTER_STUCK_SECONDS while nav reported
      // it under control. See HARVESTER_FORCE_DRIVE_SECONDS.
      const forced = this.forceDrive.getAt(i);
      if (recoverable && forced > 0) {
        this.forceDrive.setAt(i, Math.max(0, forced - dt));
        this.drivenThisTick++;
        this.driveOne(i, dt, assist);
        continue;
      }

      if (store.navField[i] >= 0) {
        const moving = store.velX[i] !== 0 || store.velZ[i] !== 0;
        const gap = Math.hypot(
          this.destX.getAt(i) - store.posX[i], this.destZ.getAt(i) - store.posZ[i]);
        if (!hauling || moving || gap <= this.arriveAt(i, NAV_ARRIVE_SLACK)) {
          this.parkedFor.setAt(i, 0);
          continue;
        }
        // Zero velocity, still far from the destination, nav holding a field it
        // is not using. Wait out the grace so a field that is merely still
        // expanding is not mistaken for one that has been abandoned.
        const held = this.parkedFor.getAt(i) + dt;
        this.parkedFor.setAt(i, held);
        if (held < HARVESTER_NAV_PARK_GRACE) continue;
        this.drivenThisTick++;
        this.driveOne(i, dt, assist);
        continue;
      }
      this.parkedFor.setAt(i, 0);

      if (!hauling) {
        this.driveSpeed.setAt(i, 0);
        if (!assist) {
          store.speed[i] = 0;
          store.velX[i] = 0;
          store.velZ[i] = 0;
        }
        continue;
      }

      // Assist mode: Steering runs at Phase.Steering, well before this, and
      // zeroes velX/velZ for exactly the units it is not asking Movement to
      // move. Non-zero velocity therefore means "nav is on it, its field is
      // just not ready yet" — leave it alone. Zero means nav has parked it,
      // and a parked harvester with a destination is the case this exists for.
      if (assist && (store.velX[i] !== 0 || store.velZ[i] !== 0)) continue;

      this.drivenThisTick++;
      this.driveOne(i, dt, assist);
    }
    // Published here rather than from simTick: drive() runs at Phase.Movement,
    // four phases after the FSM, so a counter copied in simTick would always be
    // reporting the previous tick's answer.
    this.statsOut.driven = this.drivenThisTick;
  }

  private driveOne(i: number, dt: number, assist: boolean): void {
    const w = this.world;
    const store = w.store;
    const px = store.posX[i];
    const pz = store.posZ[i];
    const tx = this.destX.getAt(i);
    const tz = this.destZ.getAt(i);

    let dx = tx - px;
    let dz = tz - pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.05) {
      this.driveSpeed.setAt(i, 0);
      store.speed[i] = 0;
      store.velX[i] = 0;
      store.velZ[i] = 0;
      return;
    }
    dx /= d;
    dz /= d;

    const loco = store.locomotor[i] as Locomotor;
    let heading = Math.atan2(dx, dz);

    // Local avoidance: probe ahead, and if the ground there is impassable fan
    // out in fixed steps until something is clear. Fixed steps rather than a
    // random jitter, because a deterministic sim cannot roll dice here.
    if (!this.probeClear(px, pz, heading, loco)) {
      for (let k = 0; k < SIDESTEP.length; k++) {
        const h = heading + SIDESTEP[k];
        if (this.probeClear(px, pz, h, loco)) { heading = h; break; }
      }
    }

    store.desiredYaw[i] = heading;
    const turn = Math.max(0.6, store.turnRate[i]) * dt;
    const yaw = turnToward(store.yaw[i], heading, turn);
    store.yaw[i] = yaw;

    // A tracked vehicle that has not come round yet should crawl, not slide
    // sideways at full speed — this is most of what makes a heavy hauler read
    // as heavy without any animation at all.
    const err = Math.abs(angleDelta(yaw, heading));
    let want = store.maxSpeed[i];
    if (err > 0.6) want *= 0.2;
    else if (err > 0.25) want *= 0.6;

    // Brake into the destination so arrival is a stop, not an overshoot.
    const accel = Math.max(1.5, store.accel[i]);
    const brakeDist = d - 0.4;
    if (brakeDist > 0) {
      const brake = Math.sqrt(2 * accel * brakeDist);
      if (want > brake) want = brake;
    } else {
      want = 0;
    }

    let speed = moveToward(this.driveSpeed.getAt(i), want, accel * dt);

    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const stepX = fwdX * speed * dt;
    const stepZ = fwdZ * speed * dt;

    let nx = clampWorld(px + stepX, 1.5);
    let nz = clampWorld(pz + stepZ, 1.5);
    if (!this.cellOpen(nx, nz, loco)) {
      // Slide: keep whichever single axis is legal rather than stopping dead in
      // front of a rock the hull is already half past.
      if (this.cellOpen(nx, pz, loco)) {
        nz = pz;
      } else if (this.cellOpen(px, nz, loco)) {
        nx = px;
      } else {
        nx = px;
        nz = pz;
        speed = 0;
      }
    }

    this.driveSpeed.setAt(i, speed);
    store.posX[i] = nx;
    store.posZ[i] = nz;
    store.posY[i] = w.terrain.heightAt(nx, nz);
    store.cellX[i] = clampCell(worldToCell(nx));
    store.cellZ[i] = clampCell(worldToCell(nz));
    store.treadPhase[i] += speed * dt;
    // In assist mode the store's speed/velocity columns belong to nav, which
    // has already decided this unit is parked. Reporting our own speed there
    // would have Movement integrate it a second time next tick.
    store.speed[i] = assist ? 0 : speed;
    store.velX[i] = assist ? 0 : fwdX * speed;
    store.velZ[i] = assist ? 0 : fwdZ * speed;
    // Harvesters are unarmed, so nothing else writes turretYaw and a scoop that
    // "follows the turret" would otherwise stay frozen at the spawn heading.
    if ((store.flags[i] & EntityFlag.CanAttack) === 0) store.turretYaw[i] = yaw;
  }

  /**
   * Open ground touching refinery `ri`, nearest to harvester `i`, written into
   * `out` as world coordinates. False when the structure is completely walled
   * in, which is a real state (a player can brick their own refinery) and the
   * honest answer is then "no dock point", not a made-up one.
   *
   * Walks the cell rings just outside the footprint, nearest ring first, and
   * takes the passable cell closest to the hull. Deterministic scan order, no
   * allocation, no RNG. `HARVESTER_DOCK_APPROACH_RINGS` bounds the work at a
   * few dozen cells for the largest structure in the game.
   */
  private reachableDockPoint(i: number, ri: number, out: Float32Array): boolean {
    const store = this.world.store;
    const terrain = this.world.terrain;
    const loco = store.locomotor[i] as Locomotor;
    const fw = Math.max(1, store.footprintW[ri]);
    const fh = Math.max(1, store.footprintH[ri]);
    // Same derivation `Damage.buildingDeath` uses to release the nav grid, so
    // the rect this walks is exactly the rect the terrain marked occupied.
    const cx0 = Math.round(store.posX[ri] / CELL - fw * 0.5);
    const cz0 = Math.round(store.posZ[ri] / CELL - fh * 0.5);
    const px = store.posX[i];
    const pz = store.posZ[i];

    for (let r = 1; r <= HARVESTER_DOCK_APPROACH_RINGS; r++) {
      let bestX = 0;
      let bestZ = 0;
      let bestD = Infinity;
      const x0 = cx0 - r;
      const x1 = cx0 + fw - 1 + r;
      const z0 = cz0 - r;
      const z1 = cz0 + fh - 1 + r;
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          // The ring only; the interior is the footprint plus closer rings.
          if (gx !== x0 && gx !== x1 && gz !== z0 && gz !== z1) continue;
          if (gx < 0 || gz < 0 || gx >= MAP_CELLS || gz >= MAP_CELLS) continue;
          if (!terrain.isPassable(gx, gz, loco)) continue;
          const wx = (gx + 0.5) * CELL;
          const wz = (gz + 0.5) * CELL;
          const d = (wx - px) * (wx - px) + (wz - pz) * (wz - pz);
          if (d < bestD) { bestD = d; bestX = wx; bestZ = wz; }
        }
      }
      if (bestD < Infinity) { out[0] = bestX; out[1] = bestZ; return true; }
    }
    return false;
  }

  /**
   * True when the cell under the hull is impassable for this hull.
   *
   * THE SAME UNRECOVERABLE CONDITION `wedgedIn` DESCRIBES, ARRIVED AT WITHOUT A
   * BUILDING. `wedgedIn`'s own doc states the principle exactly — "every cell
   * under the unit is blocked, so there is no gradient to follow out" — and
   * then tests for it by scanning `byKind[Building]`, which is one of the ways
   * that principle can be true and not the only one. A scatter rock blocks a
   * cell just as completely as a War Factory does.
   *
   * Traced: a harvester parked at 308.0,203.1 with a full hopper for 900+ ticks
   * with NO building within twenty metres. Its own cell was impassable and its
   * eight neighbours were open, so nav sampled a flow field that had never
   * integrated into the cell it was standing in, reported `speed = 5.0` and
   * `vel = 3.55,3.52`, and the hull did not move one millimetre. `wedgedIn`
   * returned -1 the whole time.
   *
   * How it gets there is not one bug: nav's wedge displacement picks a
   * neighbouring cell without requiring it to be passable, crowd relaxation
   * shoves hulls sideways, and a scatter prop can be authored under a unit.
   * Each of those is worth its own fix; none of them is a reason for the
   * economy to stop, which is why the recovery is here and is about the STATE
   * rather than about any one cause.
   */
  private strandedOnBlockedGround(i: number): boolean {
    const store = this.world.store;
    return !this.cellOpen(store.posX[i], store.posZ[i], store.locomotor[i] as Locomotor);
  }

  /**
   * Nearest passable cell to this hull, by Chebyshev ring. Written into `out`
   * as cell coordinates; false when nothing within `UNSTRAND_SEARCH_CELLS` is
   * open, which means the recovery has nowhere to put it and the caller should
   * leave it alone rather than shuffle it deeper in.
   *
   * Ring-by-ring with a fixed scan order inside each ring, so two machines pick
   * the same cell. No allocation, no RNG — this runs inside the sim.
   */
  private nearestOpenCell(i: number, out: Int32Array): boolean {
    const store = this.world.store;
    const terrain = this.world.terrain;
    const loco = store.locomotor[i] as Locomotor;
    const cx = clampCell(worldToCell(store.posX[i]));
    const cz = clampCell(worldToCell(store.posZ[i]));

    for (let r = 1; r <= UNSTRAND_SEARCH_CELLS; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // The ring only — the interior was covered by a smaller r.
          if (dx !== -r && dx !== r && dz !== -r && dz !== r) continue;
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= MAP_CELLS || gz >= MAP_CELLS) continue;
          if (!terrain.isPassable(gx, gz, loco)) continue;
          out[0] = gx;
          out[1] = gz;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Walk a stranded hull to the nearest open cell centre.
   *
   * Straight-line and unsteered, for the reason `driveEscape` gives: this is an
   * extraction, and spending a second turning the hull leaves it on the blocked
   * cell for that second while nav re-parks it. It deliberately does NOT consult
   * `cellOpen` on the way — the unit is already standing on a closed cell, so
   * every such test would fail and the extraction could never start.
   */
  private driveUnstrand(i: number, dt: number, assist: boolean): void {
    const w = this.world;
    const store = w.store;
    if (!this.nearestOpenCell(i, this.unstrandOut)) return;

    const tx = (this.unstrandOut[0] + 0.5) * CELL;
    const tz = (this.unstrandOut[1] + 0.5) * CELL;
    let dx = tx - store.posX[i];
    let dz = tz - store.posZ[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-4) return;
    dx /= d;
    dz /= d;

    const speed = Math.max(1.5, store.maxSpeed[i] * 0.6);
    const step = Math.min(d, speed * dt);
    const nx = clampWorld(store.posX[i] + dx * step, 1.5);
    const nz = clampWorld(store.posZ[i] + dz * step, 1.5);

    store.posX[i] = nx;
    store.posZ[i] = nz;
    store.posY[i] = w.terrain.heightAt(nx, nz);
    store.cellX[i] = clampCell(worldToCell(nx));
    store.cellZ[i] = clampCell(worldToCell(nz));
    // Face the way out, or the hull reads as sliding sideways out of a rock.
    store.yaw[i] = Math.atan2(dx, dz);
    store.desiredYaw[i] = store.yaw[i];
    store.treadPhase[i] += step;
    this.driveSpeed.setAt(i, 0);
    this.parkedFor.setAt(i, 0);
    // The FSM has been watching a unit that could not move; do not let it
    // re-plan the instant it can.
    this.resetProgress(i);
    if (assist) {
      store.speed[i] = 0;
      store.velX[i] = 0;
      store.velZ[i] = 0;
    } else {
      store.speed[i] = speed;
      store.velX[i] = dx * speed;
      store.velZ[i] = dz * speed;
    }
    if ((store.flags[i] & EntityFlag.CanAttack) === 0) store.turretYaw[i] = store.yaw[i];
  }

  /**
   * The slot index of a structure whose footprint this unit's hull is inside,
   * or -1.
   *
   * A unit can end up here without anyone doing anything wrong: a scenario
   * poses a harvester flush against its refinery, crowd relaxation shoves one
   * into a wall, or a structure finishes construction on top of it. What makes
   * it worth special-casing is that it is unrecoverable by pathfinding —
   * every cell under the unit is blocked, so there is no gradient to follow out.
   */
  private wedgedIn(i: number): number {
    const store = this.world.store;
    const list = store.byKind[EntityKind.Building];
    const count = store.byKindCount[EntityKind.Building];
    const px = store.posX[i];
    const pz = store.posZ[i];

    for (let k = 0; k < count; k++) {
      const bi = list[k];
      const f = store.flags[bi];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.BlocksNav) === 0) continue;
      const halfW = Math.max(1, store.footprintW[bi]) * CELL * 0.5;
      const halfH = Math.max(1, store.footprintH[bi]) * CELL * 0.5;
      // Strictly INSIDE the rect, not merely touching it: a hull resting
      // against a wall is fine and must not be shoved every tick.
      if (Math.abs(px - store.posX[bi]) < halfW && Math.abs(pz - store.posZ[bi]) < halfH) {
        return bi;
      }
    }
    return -1;
  }

  /**
   * Push a wedged unit straight out of the structure it is standing in, along
   * the shortest axis. Deliberately not a steered drive: this is an extraction,
   * and turning the hull first would keep it inside the rect for another second
   * while nav re-parks it.
   */
  private driveEscape(i: number, dt: number, bi: number, assist: boolean): void {
    const w = this.world;
    const store = w.store;
    const halfW = Math.max(1, store.footprintW[bi]) * CELL * 0.5;
    const halfH = Math.max(1, store.footprintH[bi]) * CELL * 0.5;
    const dx = store.posX[i] - store.posX[bi];
    const dz = store.posZ[i] - store.posZ[bi];

    // Shortest way out: whichever face is nearer. Ties break to +X so the
    // result is identical on every machine.
    const outX = halfW - Math.abs(dx);
    const outZ = halfH - Math.abs(dz);
    let ex = 0;
    let ez = 0;
    if (outX <= outZ) ex = dx >= 0 ? 1 : -1;
    else ez = dz >= 0 ? 1 : -1;

    const speed = Math.max(1.5, store.maxSpeed[i] * 0.6);
    const nx = clampWorld(store.posX[i] + ex * speed * dt, 1.5);
    const nz = clampWorld(store.posZ[i] + ez * speed * dt, 1.5);

    store.posX[i] = nx;
    store.posZ[i] = nz;
    store.posY[i] = w.terrain.heightAt(nx, nz);
    store.cellX[i] = clampCell(worldToCell(nx));
    store.cellZ[i] = clampCell(worldToCell(nz));
    store.treadPhase[i] += speed * dt;
    this.driveSpeed.setAt(i, 0);
    // Reset the FSM's patience: it has been watching a unit that could not
    // move, and it should not immediately re-plan the moment it can.
    this.resetProgress(i);
    if (!assist) {
      store.speed[i] = speed;
      store.velX[i] = ex * speed;
      store.velZ[i] = ez * speed;
    } else {
      store.speed[i] = 0;
      store.velX[i] = 0;
      store.velZ[i] = 0;
    }
  }

  private probeClear(x: number, z: number, heading: number, loco: Locomotor): boolean {
    const px = x + Math.sin(heading) * PROBE_METRES;
    const pz = z + Math.cos(heading) * PROBE_METRES;
    return this.cellOpen(px, pz, loco);
  }

  private cellOpen(x: number, z: number, loco: Locomotor): boolean {
    return this.world.terrain.isPassable(
      clampCell(worldToCell(x)), clampCell(worldToCell(z)), loco,
    );
  }

  /* ====================================================================== */

  /** Live counts for the debug overlay and the boot log. Never allocates. */
  stats(): Readonly<HarvesterStats> {
    return this.statsOut;
  }

  dispose(): void {
    for (let i = 0; i < this.unsubscribes.length; i++) this.unsubscribes[i]();
    this.unsubscribes.length = 0;
  }
}

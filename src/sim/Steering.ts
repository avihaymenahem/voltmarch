/**
 * ============================================================================
 * VOLTMARCH — src/sim/Steering.ts
 * ============================================================================
 * TWO PHASES LIVE HERE.
 *
 *   NavAssigner   (Phase.PathRequest, 500) — decides WHERE each unit is going:
 *                 detects new orders, hands out formation slots, requests and
 *                 releases flow fields, declares arrival, and unsticks units.
 *   SteeringSolver(Phase.Steering,    600) — decides WHICH WAY each unit leans
 *                 THIS tick: flow-field follow, separation, obstacle
 *                 avoidance, arrival damping and queueing, blended into
 *                 `velX/velZ` + `desiredYaw`.
 *
 * They share `NavAgents`, a generation-stamped per-entity side table. Nothing
 * in either class allocates after construction.
 *
 * WHY BOIDS AND NOT RVO
 * ---------------------
 * ORCA/RVO solves a linear program per agent per tick to guarantee
 * collision-free velocities. We do not need that guarantee: units are allowed
 * to touch, the Movement pass relaxes residual overlap directly, and the RTS
 * failure mode we actually care about is *shoving*, not interpenetration. A
 * four-term weighted blend (flow + separation + obstacle avoidance + head-on
 * pass) plus an explicit queue brake costs ~4% of the sim budget at 200 units
 * and produces the behaviour RA3 actually shows: columns that form up and
 * follow, not a crowd that flows around each other like fluid.
 *
 * WHAT RVO WOULD HAVE GIVEN US FOR FREE, AND WHAT IT COST TO SKIP IT
 * ------------------------------------------------------------------
 * Reciprocity. RVO's whole point is that both agents solve the SAME program and
 * therefore agree on who goes where. A weighted blend has no such agreement, and
 * the bill came due exactly where you would predict: two units meeting head-on
 * each braked to the other's speed and neither ever leaned aside, so they
 * decayed to a dead stop and parked there for the rest of the match
 * (`tests/clash.spec.ts`, and the two paragraphs above STEER_QUEUE_MIN_FRAC in
 * core/config for the measured trace). The cheap substitute for reciprocity is
 * a rule both parties can apply from local state alone and still agree on:
 * BOTH KEEP RIGHT, plus a floor under the brake so a stopped unit is never left
 * without the velocity it needs to act on that rule. Neither costs a solver.
 *
 * THE ONE-TICK-STALE SPATIAL INDEX
 * --------------------------------
 * `Phase.SpatialRebuild` (800) runs AFTER Movement (700), so the hash we query
 * here holds end-of-previous-tick positions. At 8 m/s and 1/30 s that is 27 cm
 * of error against separation radii of 2-6 m. Rebuilding it a second time here
 * would cost more than the error is worth.
 *
 * FORMATIONS
 * ----------
 * A group order does NOT funnel everyone to one point. When several units of
 * one player receive the same order point on the same tick, their offsets from
 * the group centroid are frozen as formation slots. All of them still share
 * ONE flow field — that comes from the field being requested at `goalX/goalZ`,
 * never at the slot, and it is what keeps the goal bucketing working. The slot
 * is what makes a line of tanks arrive as a line.
 *
 * ONE DEFINITION OF "WHERE THIS UNIT IS GOING"
 * --------------------------------------------
 * `agentTarget()` at the bottom of this file, and nothing else. Both phases
 * call it. That is not tidiness, it is the fix for a real defect: the solver
 * used to gate the slot on a distance threshold and the assigner did not, so
 * for every unit more than 22 m from its order point the assigner was measuring
 * arrival, giving up, sampling progress and probing for a direct path against
 * `goal + slot` while the solver drove at `goal`. Two phases, one unit, two
 * different destinations, permanently. If you ever need the target point again,
 * call the function; do not re-derive it.
 * ============================================================================
 */

import {
  CELL, MAX_ENTITIES, MAX_QUERY_RESULTS, SEPARATION_NEIGHBOURS,
  NAV_ARRIVE_SLACK, NAV_SLOWDOWN_RADIUS, NAV_MIN_APPROACH_SPEED,
  NAV_DIRECT_RANGE, NAV_DIRECT_RECHECK_TICKS, NAV_REPATH_TICKS,
  NAV_STUCK_TICKS, NAV_STUCK_MOVED_EPSILON, NAV_STUCK_GIVEUP_RADIUS,
  NAV_STUCK_MAX_NUDGES,
  NAV_WEDGE_SAMPLE_TICKS, NAV_WEDGE_METRES, NAV_WEDGE_STRIKES,
  NAV_WEDGE_MAX_NUDGES, NAV_WEDGE_SEARCH_CELLS,
  NAV_FORMATION_SPACING, NAV_FORMATION_MAX_OFFSET, NAV_FORMATION_GOAL_EPS,
  STEER_SEPARATION_WEIGHT, STEER_SEPARATION_RANGE_MUL, STEER_STATIC_PUSH_MUL,
  STEER_AVOID_WEIGHT, STEER_AVOID_LOOKAHEAD, STEER_AVOID_SIDE,
  STEER_QUEUE_COS, STEER_QUEUE_RANGE_MUL, STEER_QUEUE_BRAKE,
  STEER_QUEUE_MIN_FRAC, STEER_PASS_COS, STEER_PASS_STALL_FRAC, STEER_PASS_WEIGHT,
  STEER_FLOW_WEIGHT, STEER_NUDGE_WEIGHT,
} from '../core/config';
import { EntityFlag, EntityKind, NONE, UnitState } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import { clampCell, hash2f, isInMap, worldToCell, wrapAngle } from '../core/math';
import { sliceForEntity } from '../core/loop';
import {
  MoveClass, NAV_POCKET_MAX_CELLS, NAV_REGION_SEARCH_CELLS, type FlowFieldCache,
} from './Flowfield';
import { moveClassAt } from './Movement';
import { crushPassesThrough } from './Crush';

/* --------------------------------------------------------------------------
 * THE STUCK WATCHDOG'S OWN TUNABLES
 *
 * `NAV_STUCK_*` in core/config already covers "the speedometer says zero" —
 * a unit wedged against a wall or nose-to-nose with a neighbour. It cannot see
 * the failure this module was extended for: a unit CIRCLING inside a pocket,
 * or sliding along a cliff face, at full throttle and getting nowhere. Its
 * speed never drops, so that counter never fires and the unit orbits its hole
 * for the rest of the match.
 *
 * So progress is also measured directly, against the BEST distance the unit
 * has ever achieved toward its current order. Best-so-far, not last-tick
 * distance: a unit detouring around a building legitimately moves AWAY from
 * its goal for a while, and comparing consecutive samples would call that a
 * failure. Best-so-far only stops improving when the unit genuinely cannot
 * make ground.
 *
 * The window is long (nine seconds) and the consequence is deliberately mild:
 * this signal only ever asks `rescue()`, which then has to PROVE the unit is
 * region-isolated before it moves anything. It can never cancel an order on
 * its own, so a slow convoy or a congested chokepoint cannot be punished by
 * it. That is also how the brief's "while not blocked by a transient
 * neighbour" clause is honoured: a transient neighbour cannot change which
 * connected region you are standing in.
 * -------------------------------------------------------------------------- */

/** Ticks between progress samples. 45 = 1.5 s at the fixed 30 Hz sim rate. */
const NAV_PROGRESS_TICKS = 45;
/** Metres of closing per window that still counts as making ground. */
const NAV_PROGRESS_METRES = 1.5;
/** Consecutive barren windows before the rescue check runs. 6 = 9 seconds. */
const NAV_PROGRESS_STRIKES = 6;

/* --------------------------------------------------------------------------
 * THE WEDGE WATCHDOG — THE THIRD AND LAST MEASURE OF "STUCK"
 *
 * There are now three, and they are three because they measure three different
 * things and each one is blind to the others' failure:
 *
 *   NAV_STUCK_*        the SPEEDOMETER. Fires in 0.8 s. Catches a unit grinding
 *                      nose-first into something. Blind to a unit circling.
 *   NAV_PROGRESS_*     DISTANCE TO GOAL, best-so-far. Fires in 9 s. Catches the
 *                      circler. Blind to a unit that is legitimately detouring,
 *                      by design — and it may only ever ask for a region
 *                      rescue, so it cannot help a unit that is wedged inside
 *                      the region it is supposed to be in.
 *   NAV_WEDGE_*        RAW DISPLACEMENT. Fires in 6 s. Catches the one thing
 *                      neither of the others can see: a unit that has not
 *                      physically moved, at all, while it still holds an order,
 *                      in a place the region test says is perfectly fine.
 *
 * The third is the one a player reports, because it is the only one that is
 * visible from the top of the map: "it is just sitting there". It is also the
 * only one whose remedy is allowed to move the unit without proving that the
 * ground is disconnected, so it is deliberately the slowest to fire and it
 * climbs a ladder rather than jumping to the end:
 *
 *   rung 0            RE-PLAN. Drop the field, clear Arrived (which is sticky
 *                     and is how a unit ends up parked mid-haul forever) and
 *                     ask for a fresh one. Fixes every case where the unit is
 *                     free and the plan is stale.
 *   rung 1..N         NUDGE. A deterministic sideways shove — a steering term,
 *                     see `armNudge` — strong enough to clear a hull. Fixes the
 *                     case where two units are leaning on each other in a
 *                     doorway.
 *   rung N+1          DISPLACE. Put the unit on the nearest ROUTABLE cell
 *                     within NAV_WEDGE_SEARCH_CELLS, preferring the region its
 *                     goal is in. Only reached after ~24 s of a unit not moving
 *                     a single metre, which no legitimate behaviour does.
 *   rung N+2          PARK. Nothing worked; end the order the way the older
 *                     ladder does. This rung is what makes the whole thing
 *                     TERMINATE — without it a unit that walks straight back
 *                     into its own jam is displaced again every six seconds for
 *                     the rest of the match and the counter climbs forever.
 *
 * WHY IT LIVES HERE AND NOT IN Movement.ts
 * ----------------------------------------
 * The brief asked for it "in movement", and the first two rungs are pure nav
 * state — the field handle, the Arrived flag, the formation slot, the region
 * labelling. A watchdog in the integrator would need all four passed to it and
 * would then be a SECOND authority racing the escalation ladder that already
 * lives in this class, on the same unit, in the same tick. One ladder, one
 * owner. NavAssigner runs at Phase.PathRequest, which is before Steering and
 * Movement, so the position it samples is the settled end-of-last-tick pose —
 * exactly the right thing to difference.
 *
 * WHAT IT MUST NOT DO
 * -------------------
 * Displace a unit that is standing still on purpose. Three guards, all cheap:
 * arrived units never reach it (the caller skips them, which is what excludes a
 * harvester waiting its turn at a dock), immobilised units are skipped, and a
 * unit with a live target is skipped so a tank that halted to shoot is never
 * shoved out of its firing position.
 * -------------------------------------------------------------------------- */

/** Scratch for the rescue ring search. Module level: `simTick` never allocates. */
const RESCUE_CELL = new Int32Array(2);

/**
 * Bearings the unwedge shove tries before it settles for the hashed one. Eight
 * across a half-plane is 22.5 degrees apart, which is finer than the 4 m cell
 * grid the probe reads, so a ninth would ask the same cells twice.
 */
const NUDGE_PROBES = 8;

/* --------------------------------------------------------------------------
 * RESCUE REPORTING
 *
 * A rescue is a bug report, not a feature. Every one of them means something
 * put a unit somewhere it could not leave — a generator regression, a new
 * biome, a scenario that skipped the placement helper. Silent correction is
 * how the reported bug survived to a real match in the first place, so the
 * first one is always logged and the rest are counted and logged sparsely,
 * because a hundred trapped units must not become a hundred console lines
 * inside one tick.
 * -------------------------------------------------------------------------- */

let rescueTotal = 0;

/** Total pocket rescues since boot. Read by the diagnostic and by tests. */
export function navRescueCount(): number { return rescueTotal; }

/** Zero the counter. Between matches, and between test cases. */
export function resetNavRescueCount(): void { rescueTotal = 0; }

/**
 * What the wedge watchdog has had to do, since boot.
 *
 * All four numbers matter and they matter as a RATIO. `detections` climbing
 * while `displaced` stays at zero is the system working: units get stuck for a
 * moment, a re-plan frees them. `displaced` climbing is the prevention layer —
 * the nav clearance rule in Flowfield §4c — failing, and the watchdog papering
 * over it. That is the number to watch after a change to base layout, unit
 * radii or cell size.
 */
export interface NavWedgeCounters {
  /** Windows in which a unit under orders had not moved. */
  detections: number;
  /** Rung 0: fields dropped and re-requested. */
  repaths: number;
  /** Rung 1..N: sideways shoves. */
  nudges: number;
  /** Rung N+1: units picked up and put on the nearest routable cell. */
  displaced: number;
  /**
   * Past the last rung: orders ended because nothing above worked. This is the
   * ladder terminating rather than churning, and a steady trickle of it is a
   * crowd pressed against a goal nobody can stand on — a formation problem, not
   * a wedge.
   */
  parked: number;
}

const wedgeCounters: NavWedgeCounters = {
  detections: 0, repaths: 0, nudges: 0, displaced: 0, parked: 0,
};

/** Live wedge counters. The object is stable; read it, do not keep a copy. */
export function navWedgeCounters(): Readonly<NavWedgeCounters> { return wedgeCounters; }

/** Zero them. Between matches, and between test cases. */
export function resetNavWedgeCounters(): void {
  wedgeCounters.detections = 0;
  wedgeCounters.repaths = 0;
  wedgeCounters.nudges = 0;
  wedgeCounters.displaced = 0;
  wedgeCounters.parked = 0;
}

/* ==========================================================================
 * 1. PER-ENTITY NAV STATE
 * ========================================================================== */

const enum AgentFlag {
  /** The last direct-path probe said "just drive at it". */
  DirectPath = 1 << 0,
  /** Order satisfied; the unit is parked and will not re-path on its own. */
  Arrived = 1 << 1,
  /** A formation slot has been assigned for the current order. */
  HasSlot = 1 << 2,
  /**
   * The wedge watchdog has already picked this unit up and put it down once
   * for the CURRENT order. One displacement per order is the whole budget:
   * without it a unit that walks straight back into its own jam is displaced
   * again every six seconds forever. Measured over a 6-minute AI match, the
   * difference was 146 displacements against 11 units versus one each.
   */
  Displaced = 1 << 3,
}

/**
 * Generation-stamped side table. Written by NavAssigner, read by
 * SteeringSolver and Movement. Same contract as `PerEntityF32`: a recycled
 * slot reads as absent rather than inheriting the dead unit's goal, which is
 * exactly the bug a raw parallel array would give you (a fresh tank driving to
 * where the previous occupant of its slot was going).
 */
export class NavAgents {
  readonly stamp = new Uint16Array(MAX_ENTITIES);
  /** The order point this agent is currently pathing to. */
  readonly goalX = new Float32Array(MAX_ENTITIES);
  readonly goalZ = new Float32Array(MAX_ENTITIES);
  /** Formation offset from the order point, metres. */
  readonly slotX = new Float32Array(MAX_ENTITIES);
  readonly slotZ = new Float32Array(MAX_ENTITIES);
  /** Consecutive ticks spent barely moving while under a move order. */
  readonly stuck = new Uint8Array(MAX_ENTITIES);
  /**
   * Where the SPEED watchdog last saw this unit, so it can tell "not moving"
   * from "moving, but not by a route that updates `st.speed`".
   *
   * `st.speed` is a REPORTED column, and `Harvesting.driveEscape` deliberately
   * writes 0 to it while physically advancing `posX/posZ` — it has to, because
   * `MovementIntegrator` integrates position FROM `st.speed`, so a truthful
   * value there would be integrated a second time next tick. Reading the column
   * alone therefore counts an active rescue as a stall.
   */
  readonly watchX = new Float32Array(MAX_ENTITIES);
  readonly watchZ = new Float32Array(MAX_ENTITIES);
  /** How many times we have shoved this unit sideways to unstick it. */
  readonly nudges = new Uint8Array(MAX_ENTITIES);
  /**
   * Closest this unit has come to its current order point, metres. -1 before
   * the first sample. Only ever decreases while the order stands, which is
   * what makes it a safe progress measure around a detour.
   */
  readonly bestDist = new Float32Array(MAX_ENTITIES);
  /** Consecutive progress windows that failed to improve `bestDist`. */
  readonly noProgress = new Uint8Array(MAX_ENTITIES);
  /**
   * Position at the last accepted wedge sample. Differenced against the live
   * position every NAV_WEDGE_SAMPLE_TICKS; this is RAW displacement, with no
   * reference to the goal, which is what makes it see a wedge the other two
   * detectors are structurally unable to see.
   */
  readonly anchorX = new Float32Array(MAX_ENTITIES);
  readonly anchorZ = new Float32Array(MAX_ENTITIES);
  /**
   * The tick the current wedge window opened, so the sample can ask whether a
   * shove was still live when it did.
   *
   * WHY THE LADDER NEEDS THIS TO TERMINATE. A good sample refunds a rung
   * (`anchorWedge`), and after a shove ends the unit does not stop — it coasts,
   * turns back, and drifts to where it was. That tail clears NAV_WEDGE_METRES
   * on the very next window and hands the rung back, so the ladder cycles
   * between rungs 2 and 3 for the rest of the match and never reaches the
   * displacement rung. Measured on the sealed alcove: six detections, five
   * shoves, zero displacements, 2.76 m of net travel in sixty seconds.
   *
   * A window that OPENED while we were still shoving therefore does not count
   * as the unit moving under its own power. It still re-anchors — no unit is
   * punished for moving — it just does not pay the rung back.
   */
  readonly anchorTick = new Uint32Array(MAX_ENTITIES);
  /** Consecutive sample windows in which the unit did not move. */
  readonly frozen = new Uint8Array(MAX_ENTITIES);
  /** How far up the unwedge ladder this unit has climbed on this order. */
  readonly escalations = new Uint8Array(MAX_ENTITIES);
  /**
   * The unwedge shove: a unit-length lateral steering direction, and the tick
   * it stops being applied. Deliberately NOT the formation slot — see the
   * measured account above STEER_NUDGE_WEIGHT in core/config. A tick DEADLINE
   * rather than a countdown so nothing has to decrement it: both phases skip
   * units for half a dozen reasons and a counter would decay at a rate that
   * depended on which branch the unit took.
   */
  readonly nudgeX = new Float32Array(MAX_ENTITIES);
  readonly nudgeZ = new Float32Array(MAX_ENTITIES);
  readonly nudgeUntil = new Uint32Array(MAX_ENTITIES);
  readonly flags = new Uint8Array(MAX_ENTITIES);

  /** True if this slot's state belongs to the CURRENT occupant. */
  valid(i: number, gen: number): boolean { return this.stamp[i] === gen; }

  /** Claim the slot for the current occupant and clear stale state. */
  claim(i: number, gen: number): void {
    this.stamp[i] = gen;
    this.goalX[i] = 0; this.goalZ[i] = 0;
    this.slotX[i] = 0; this.slotZ[i] = 0;
    this.stuck[i] = 0; this.nudges[i] = 0;
    this.watchX[i] = 0; this.watchZ[i] = 0;
    this.bestDist[i] = -1; this.noProgress[i] = 0;
    this.anchorX[i] = 0; this.anchorZ[i] = 0; this.anchorTick[i] = 0;
    this.frozen[i] = 0; this.escalations[i] = 0;
    this.clearNudge(i);
    this.flags[i] = 0;
  }

  /**
   * Arm the unwedge shove: lean along the unit vector `(dx,dz)` for `hold`
   * ticks. A dumb setter — `NavAssigner.shove` chooses the direction, because
   * choosing it well needs the terrain and this table has none.
   *
   * DURATION is however long the detector that asked for it takes to look
   * again, which is why callers pass their own window rather than a shared
   * constant. A shove that expires before the next sample is a shove nobody
   * measures; one that outlives it stacks with its own successor.
   */
  armNudge(i: number, dx: number, dz: number, tick: number, hold: number): void {
    this.nudgeX[i] = dx;
    this.nudgeZ[i] = dz;
    this.nudgeUntil[i] = tick + hold;
  }

  /** Cancel any live shove. On a new order, a rescue, a displacement. */
  clearNudge(i: number): void {
    this.nudgeX[i] = 0; this.nudgeZ[i] = 0; this.nudgeUntil[i] = 0;
  }

  /**
   * True when a shove was still live at the instant the current wedge window
   * opened, i.e. this window's movement is movement we caused. See `anchorTick`.
   */
  shoveDrove(i: number): boolean {
    return this.nudgeUntil[i] !== 0 && this.nudgeUntil[i] >= this.anchorTick[i];
  }

  /** Forget progress history. Called whenever the order point changes. */
  restartProgress(i: number): void {
    this.bestDist[i] = -1;
    this.noProgress[i] = 0;
  }

  /**
   * Re-anchor the wedge watchdog at (x,z) and put the unit back at the bottom
   * of the ladder. Called on a new order, on arrival, on a rescue, and every
   * time the unit demonstrably moved.
   */
  armWedge(i: number, x: number, z: number): void {
    this.anchorX[i] = x;
    this.anchorZ[i] = z;
    this.anchorTick[i] = 0;
    this.frozen[i] = 0;
    this.escalations[i] = 0;
  }

  /**
   * Re-anchor and step the ladder DOWN by one rung instead of resetting it.
   *
   * This is what a good sample does, and the difference from `armWedge` is the
   * whole reason the ladder terminates. A unit grinding along a wall at full
   * throttle does not stand still: it creeps, and it will eventually creep the
   * NAV_WEDGE_METRES that counts as movement. Zeroing the rung there put the
   * unit back at the bottom every time, and the measured result was a unit in a
   * sealed alcove taking 42 s to be displaced and cycling re-plan/nudge forever
   * in between. A decay instead means sustained real movement walks the ladder
   * back down over several windows, while a twitch cannot undo a climb.
   *
   * `finishOrder` uses it for the same reason from the other side: the older
   * speed watchdog parks the unit, rung 0 un-parks it, and a reset there would
   * deadlock the two against each other.
   */
  anchorWedge(i: number, x: number, z: number): void {
    this.anchorX[i] = x;
    this.anchorZ[i] = z;
    this.anchorTick[i] = 0;
    this.frozen[i] = 0;
    if (this.escalations[i] > 0) this.escalations[i]--;
  }

  /**
   * The live wedge counters, reachable from a console session or a harness
   * through `__vmNav.agents.watchdog()`. The numbers are module-level (one
   * match, one sim) and this is simply where a debugger can find them.
   */
  watchdog(): Readonly<NavWedgeCounters> { return wedgeCounters; }
}

/* ==========================================================================
 * 2. WHAT COUNTS AS "TRYING TO GET SOMEWHERE"
 * ========================================================================== */

/**
 * The behavioural states that consume a flow field. Deliberately a switch and
 * not a bitmask on `flags`: `state` is the FSM every other module already
 * writes, and adding a parallel "is moving" bit would immediately drift out of
 * sync with it.
 *
 * WHY `Attacking` IS IN THIS LIST — THE BUG THAT PUT IT HERE
 * ----------------------------------------------------------
 * `core/types.ts` has always documented `UnitState.Attacking` as "stationary or
 * CLOSING ON targetId", and `OrderExecutor.write()` puts a right-clicked attack
 * order into exactly that state. This switch omitted it, so `NavAssigner` took
 * the `!seeking` branch, RELEASED the unit's flow field, and the unit never
 * moved. An attack order on something already in weapon range still worked —
 * the unit fires from where it stands — so every unit test passed while the
 * player reported, twice, "when right click attack on enemy building, my army
 * doesnt attack!". You right-click an enemy BASE from across the map, and
 * across the map was the one case that did nothing at all.
 *
 * WHAT MAINTAINS THE GOAL, AND WHY IT IS NOT THIS FILE
 * ---------------------------------------------------
 * Nothing here knows about weapons, so nothing here can know where to STOP.
 * Left alone, an attacking unit paths to its target's centre, which would send
 * a 42 m artillery piece all the way to the wall and throw its entire range
 * advantage away — a worse bug than the one being fixed, and an invisible one.
 *
 * So `sim/Targeting.ts` owns the goal for an explicit Attack/ForceAttack order,
 * the same way `sim/Capture.ts` owns it for Capture and `sim/Garrison.ts` for
 * Enter: it refreshes `orderX/orderZ` onto the target while the target is out
 * of weapon range, and parks the goal on the unit's own position once it is
 * inside. That is what makes "closing on targetId" terminate at a firing
 * position instead of at the target's footprint.
 *
 * WHY `Guarding` IS IN THIS LIST — THE SECOND HALF OF THE SAME BUG
 * ---------------------------------------------------------------
 * `UnitState.Guarding` has always been documented as "holding position,
 * engages anything in range, RETURNS TO GUARD POINT", and it was omitted here
 * too. A unit given `OrderKind.Guard` therefore did not drive to the point it
 * was told to guard, could not leave it to engage, and had nothing to come back
 * from — the state existed, three scenarios spawned units into it, and no
 * module read it for behaviour at all.
 *
 * Its goal is owned by `sim/Targeting.ts` for exactly the reason `Attacking`'s
 * is: the outbound leg has to stop at a firing position, which needs a weapon
 * range this file cannot see. The RETURN leg's goal is `guardX/guardZ`, which
 * is why that column exists and why nothing else may write it mid-excursion.
 */
export function seeksGoal(state: number): boolean {
  switch (state) {
    case UnitState.Moving:
    case UnitState.AttackMoving:
    case UnitState.Attacking:
    case UnitState.Guarding:
    case UnitState.SeekOre:
    case UnitState.ReturnToRefinery:
    case UnitState.Fleeing:
    case UnitState.Capturing:
    case UnitState.Repairing:
      return true;
    default:
      return false;
  }
}

/** Entities this module is allowed to move at all. */
function isMover(flags: number, kind: number): boolean {
  if ((flags & EntityFlag.Alive) === 0) return false;
  if ((flags & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) return false;
  if ((flags & EntityFlag.CanMove) === 0) return false;
  return kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
}

/* ==========================================================================
 * 3. NAV ASSIGNER — Phase.PathRequest
 * ========================================================================== */

/** Scratch: indices of units that received a new order this tick. */
const NEW_ORDERS = new Int32Array(MAX_ENTITIES);
/** Scratch: group membership marks for the formation pass. */
const GROUPED = new Uint8Array(MAX_ENTITIES);
/** Scratch: one group's members. */
const GROUP = new Int32Array(MAX_ENTITIES);
/**
 * Scratch for `agentTarget`. One buffer for both phases: every caller reads it
 * on the next two lines and never retains it, and the two phases do not run at
 * the same time. Module level because `simTick` never allocates.
 */
const TARGET = new Float32Array(2);

export class NavAssigner {
  /** Units currently holding a field. Diagnostics only. */
  public assigned = 0;
  public repaths = 0;
  public arrivals = 0;
  /** Units lifted out of a disconnected pocket, this match. */
  public rescues = 0;
  /** Orders ended because nothing near the goal was reachable at all. */
  public unreachableOrders = 0;
  /** Units the wedge watchdog had to pick up and put down again, this match. */
  public displacements = 0;

  constructor(
    private readonly world: World,
    private readonly nav: FlowFieldCache,
    private readonly agents: NavAgents,
  ) {}

  simTick(s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const ag = this.agents;

    // 1. Budgeted flow-field expansion. Do this FIRST so a field requested on
    //    the previous tick can become ready before anybody samples it.
    this.nav.update();

    let newCount = 0;
    let assigned = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if (!isMover(st.flags[i], st.kind[i])) continue;
      const gen = st.gen[i];
      if (!ag.valid(i, gen)) {
        ag.claim(i, gen);
        // `claim` zeroes the anchor, and (0,0) is a real map corner — a unit
        // spawned anywhere else would read as having teleported on its first
        // sample. Anchor it where it actually is.
        ag.armWedge(i, st.posX[i], st.posZ[i]);
      }

      const seeking = seeksGoal(st.state[i]);
      if (!seeking) {
        // -- the post ----------------------------------------------------
        // THE ONE EDGE ON WHICH "WHERE THIS UNIT BELONGS" IS RE-TAKEN.
        // `guardX/guardZ` is the point a stance walks back to, and it is only
        // honest if it tracks the player's intent: a unit ordered across the
        // map belongs at the far end, not at the factory it rolled out of.
        //
        // EDGE-TRIGGERED, and `HasSlot` is the edge. Re-taking the post every
        // tick a unit stands idle would defeat the whole return behaviour —
        // shove a Defensive unit off its post and the post would follow it, so
        // it would never be displaced and never walk back. Taking it once, on
        // the tick a goal-seeking state ends, captures exactly the moment an
        // order finished (arrival, `Stop`, or a give-up park) and nothing else.
        //
        // A unit under `OrderKind.Guard` never reaches this branch while the
        // order stands: `Guarding` is a seeking state, and `finishOrder`
        // deliberately does not clear it on arrival.
        if ((ag.flags[i] & AgentFlag.HasSlot) !== 0) {
          st.guardX[i] = st.posX[i];
          st.guardZ[i] = st.posZ[i];
        }
        // Order finished or superseded by combat/economy: give the field back
        // so the LRU can reuse the slot.
        if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
        ag.flags[i] &= ~(AgentFlag.HasSlot | AgentFlag.Arrived | AgentFlag.DirectPath
          | AgentFlag.Displaced);
        ag.stuck[i] = 0; ag.nudges[i] = 0;
        ag.restartProgress(i);
        ag.clearNudge(i);
        ag.armWedge(i, st.posX[i], st.posZ[i]);
        continue;
      }

      // 2. New order? The Command phase writes orderX/orderZ; we detect the
      //    edge by diffing against our own cached copy rather than asking for
      //    a notification, so this works no matter who issued it.
      const ox = st.orderX[i], oz = st.orderZ[i];
      const dx = ox - ag.goalX[i], dz = oz - ag.goalZ[i];
      if (dx * dx + dz * dz > NAV_FORMATION_GOAL_EPS * NAV_FORMATION_GOAL_EPS
          || (ag.flags[i] & AgentFlag.HasSlot) === 0) {
        ag.goalX[i] = ox; ag.goalZ[i] = oz;
        ag.slotX[i] = 0; ag.slotZ[i] = 0;
        ag.stuck[i] = 0; ag.nudges[i] = 0;
        ag.restartProgress(i);
        ag.clearNudge(i);
        ag.armWedge(i, st.posX[i], st.posZ[i]);
        ag.flags[i] = (ag.flags[i] & ~(AgentFlag.Arrived | AgentFlag.DirectPath
          | AgentFlag.Displaced)) | AgentFlag.HasSlot;
        NEW_ORDERS[newCount++] = i;
      }
      assigned++;
    }

    // 3. Formation slots for everything that was re-ordered this tick.
    if (newCount > 1) this.assignFormations(newCount);

    // 4. Field bookkeeping, arrival and stuck handling.
    this.arrivals = 0;
    this.repaths = 0;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if (!isMover(st.flags[i], st.kind[i])) continue;
      if (!seeksGoal(st.state[i])) continue;

      // -- parked, and not necessarily because it got there --------------
      // `Arrived` is set by two very different things. Reaching the goal is
      // one. The other is `finishOrder` being called from a GIVE-UP: three
      // nudges spent, still not moving, park it. `Arrived` is sticky until the
      // order point moves, and a harvester's FSM keeps re-publishing the same
      // dock apron forever — so the second kind of Arrived is precisely the
      // "stopped forever, mid-haul, with a full hopper" state that Harvesting's
      // own header describes, and skipping it here is what made it permanent.
      //
      // A unit parked FAR from its target therefore gets exactly one more go:
      // it falls through (the solver still holds it still, because that reads
      // `Arrived` too), the watchdog below watches it not move, and rung 0
      // clears the flag. `escalations === 0` is what makes it exactly one — by
      // the time the ladder has parked it again the rung is spent, and it stays
      // parked instead of cycling.
      if ((ag.flags[i] & AgentFlag.Arrived) !== 0) {
        if (ag.escalations[i] !== 0) continue;
        agentTarget(ag, i, TARGET);
        const rx = TARGET[0] - st.posX[i];
        const rz = TARGET[1] - st.posZ[i];
        const give = NAV_STUCK_GIVEUP_RADIUS + st.radius[i];
        if (rx * rx + rz * rz <= give * give) continue;
      }

      const cls = moveClassAt(st, i);
      agentTarget(ag, i, TARGET);
      const tx = TARGET[0], tz = TARGET[1];
      const px = st.posX[i], pz = st.posZ[i];
      const ddx = tx - px, ddz = tz - pz;
      const d2 = ddx * ddx + ddz * ddz;

      // -- arrival ---------------------------------------------------------
      const arrive = st.radius[i] + NAV_ARRIVE_SLACK;
      if (d2 <= arrive * arrive) { this.finishOrder(i); continue; }

      // -- trapped ---------------------------------------------------------
      // Cheapest and most certain of the three checks below, so it runs first
      // and it runs every tick: two array reads say whether this unit is
      // standing in a scrap of ground that is not joined to the map. There is
      // nothing to wait for — no amount of steering fixes a hole — so a unit
      // in one is lifted out on the spot rather than after nine seconds of
      // grinding.
      if (this.rescue(i, cls, true)) continue;

      // -- progress watchdog -----------------------------------------------
      // Sampled on a per-entity slice so the whole army never checks in on the
      // same tick. See the note at the top of the file for why this measures
      // BEST distance rather than last distance, and why it may only ever ask
      // for a rescue and never cancel an order.
      const dist = Math.sqrt(d2);
      if (sliceForEntity(s.tick, i, NAV_PROGRESS_TICKS)) {
        const best = ag.bestDist[i];
        if (best < 0 || dist < best - NAV_PROGRESS_METRES) {
          ag.bestDist[i] = dist;
          ag.noProgress[i] = 0;
        } else if (ag.noProgress[i] < 255) {
          ag.noProgress[i]++;
        }
        if (ag.noProgress[i] >= NAV_PROGRESS_STRIKES) {
          // Nine seconds under a move order without ever getting closer. If
          // the region test can explain that, act on it; if it cannot, this
          // is ordinary congestion and the speed counter below owns it.
          ag.noProgress[i] = 0;
          if (this.rescue(i, cls, false)) continue;
        }
      }

      // -- wedge watchdog ---------------------------------------------------
      // Raw displacement, sliced per entity like everything else in this loop.
      // Immobilised units and units with a live target are exempt: neither is
      // stuck, both are standing still for a reason. Arrived units never get
      // here at all — the `continue` at the top of the loop is what keeps a
      // harvester queued behind another one at a dock out of this.
      if (sliceForEntity(s.tick, i, NAV_WEDGE_SAMPLE_TICKS)
          && (st.flags[i] & EntityFlag.Immobilized) === 0
          && st.targetId[i] === (NONE as number)) {
        const wdx = px - ag.anchorX[i], wdz = pz - ag.anchorZ[i];
        const shoveDrove = ag.shoveDrove(i);
        if (wdx * wdx + wdz * wdz >= NAV_WEDGE_METRES * NAV_WEDGE_METRES) {
          if (shoveDrove) {
            // Movement WE caused. Re-anchor — the unit is not punished for it —
            // but do not refund the rung it just climbed. See `anchorTick` for
            // the measured account of what happens when it is refunded.
            ag.anchorX[i] = px; ag.anchorZ[i] = pz; ag.frozen[i] = 0;
          } else {
            // Moved on its own. Step DOWN one rung rather than resetting — see
            // anchorWedge.
            ag.anchorWedge(i, px, pz);
          }
        } else if (ag.frozen[i] < 255) {
          ag.frozen[i]++;
        }
        ag.anchorTick[i] = s.tick;
        if (ag.frozen[i] >= NAV_WEDGE_STRIKES) {
          ag.frozen[i] = 0;
          wedgeCounters.detections++;
          // `unwedge` returns true only when it MOVED the unit; everything
          // below this point in the loop would then be operating on a stale
          // position, so the tick ends here for this entity.
          if (this.unwedge(i, cls, px, pz, s.tick)) continue;
        }
      }

      // -- stuck -----------------------------------------------------------
      // ONE LADDER, ONE OWNER. The wedge ladder above is the slow, thorough one
      // and it owns the outcome from the moment it takes its first rung, so
      // this faster one stands down until it comes back to earth.
      //
      // They used to run concurrently and it did not show, because the shove
      // did nothing and the speed ladder's own remedy therefore never changed
      // anything either. With a shove that works they fight: this ladder's
      // 24-tick shove overwrites the wedge ladder's 60-tick one mid-window, and
      // — the part that actually broke a unit — its give-up parks the order
      // outright after three shoves, four seconds into a climb the wedge ladder
      // needs thirty-six to finish. `finishOrder` puts a plain move order into
      // `Idle`, `seeksGoal(Idle)` is false, and the loop above skips the unit
      // entirely from then on: the wedge ladder never gets to finish, never
      // reaches its displacement rung, and the unit is parked in the hole for
      // the rest of the match. Measured: parked at t=600 where the same
      // scenario used to be displaced out at t=1080.
      //
      // Termination is not lost by deferring: the wedge ladder ends in its own
      // park rung.

      /*
       * MEASURE MOTION, NOT THE REPORT OF MOTION.
       *
       * This tested `st.speed[i]` alone, and `st.speed` is a column another
       * system deliberately falsifies. `Harvesting.driveEscape` — the ONLY
       * force in the game that ejects a hull from a building footprint — moves
       * the unit at ~2.6 m/s while writing `speed = velX = velZ = 0`, because
       * `MovementIntegrator` integrates position from `st.speed` and a truthful
       * value would be integrated a second time on the next tick.
       *
       * So a unit being actively rescued read as stalled, and this watchdog
       * burned all three NAV_STUCK_MAX_NUDGES before the hull was even clear.
       * It then called `finishOrder`, which sets the sticky `AgentFlag.Arrived`
       * AND — in the same call — `navField = -1` and `velX = velZ = 0`. That
       * triple is exactly the harvester backstop's arming predicate, so the
       * backstop jumped the hull, which made nav re-request a field, which
       * disarmed the backstop, which stalled again 24 ticks later.
       *
       * Measured: a period of exactly NAV_STUCK_TICKS, one 0.029 m lurch every
       * 24 ticks forever, with `speed`, `velX` and `velZ` all reading 0 the
       * whole time — so no animation played and the hull never turned. 1.25 Hz
       * of visible twitch. Reported as "they also jitter when they stuck into
       * other buildings". Over 1400 ticks the unit travelled 0.44 m and twitched
       * 55 times; with the backstop disabled entirely it completed the same haul
       * in 470 ticks with zero nudges.
       *
       * Real displacement answers the question this watchdog is actually
       * asking, and is immune to WHO did the moving. Giving up progress
       * detection costs nothing: the `bestDist` progress watchdog above already
       * measures advance toward the goal directly, which is the case this one
       * cannot see anyway — see the note at the head of this file.
       *
       * The shape matches the guard on the line below it: `escalations > 0`
       * already suppresses this ladder while the wedge ladder owns the unit.
       */
      const mdx = st.posX[i] - ag.watchX[i];
      const mdz = st.posZ[i] - ag.watchZ[i];
      const movedSq = mdx * mdx + mdz * mdz;
      ag.watchX[i] = st.posX[i];
      ag.watchZ[i] = st.posZ[i];

      /*
       * DISPLACEMENT IS THE WHOLE TEST. THE SPEEDOMETER IS NOT A SECOND OPINION.
       *
       * This used to increment only when `st.speed` ALSO read slow, with a final
       * `else` that reset the counter. That final branch says: "it did not move,
       * but it says it is going full speed, therefore it is fine." It is the
       * exact opposite of fine — it is a hull grinding nose-first into a blocked
       * cell at max throttle, which is the one stall a player actually watches
       * happen.
       *
       * Measured on seed 4242 slot 83 (`ReturnToRefinery`, full hopper): pinned
       * at cell 78,50 from tick 800 to 2600 with `spd` reading 5.00 — exactly
       * `maxSpeed`, so `speed < maxSpeed * 0.16` was false on every one of those
       * 1800 ticks and `stuck` never once left 0. The ladder above never ran, no
       * nudge was ever spent, and the hull was freed at tick 2800 only because
       * crowd relaxation happened to shove it round the corner. 60 seconds.
       *
       * The comment on the block above is still right about WHY `st.speed`
       * cannot be trusted — `Harvesting.driveEscape` deliberately falsifies it —
       * but the conclusion was half-applied: displacement replaced the speed test
       * as the RESET and was never made the INCREMENT. Both halves now come from
       * the same measurement, so there is no state the two can disagree about.
       *
       * `NAV_STUCK_MOVED_EPSILON` is 0.01 m per tick, i.e. 0.3 m/s. Nothing that
       * is genuinely under way is below it, and everything parked on purpose
       * (arrived, queued at a dock) left this loop at the `Arrived` check.
       */
      if (ag.escalations[i] > 0) {
        ag.stuck[i] = 0;
      } else if (movedSq > NAV_STUCK_MOVED_EPSILON * NAV_STUCK_MOVED_EPSILON) {
        // It moved. Whoever moved it, it is not stuck.
        ag.stuck[i] = 0;
      } else if (ag.stuck[i] < 255) {
        ag.stuck[i]++;
      }
      if (ag.stuck[i] >= NAV_STUCK_TICKS) {
        ag.stuck[i] = 0;
        if (d2 <= NAV_STUCK_GIVEUP_RADIUS * NAV_STUCK_GIVEUP_RADIUS
            || ag.nudges[i] >= NAV_STUCK_MAX_NUDGES) {
          /*
           * GIVING UP IS THIS LADDER'S RIGHT, EXCEPT ON THE OTHER LADDER'S CASE.
           *
           * `finishOrder` parks the order, `seeksGoal(Idle)` is false, and this
           * whole loop then skips the unit forever — so the wedge ladder never
           * reaches its displacement rung. The block above already explains that
           * hazard and defers this ladder while `escalations > 0`. That guard is
           * not enough on its own: the wedge ladder needs
           * NAV_WEDGE_SAMPLE_TICKS * NAV_WEDGE_STRIKES = 180 ticks before it
           * takes its FIRST rung, and this one gives up after
           * NAV_STUCK_TICKS * NAV_STUCK_MAX_NUDGES = 72. It parks the unit
           * during the window where `escalations` is still 0.
           *
           * That was invisible while the counter above could not fire for a hull
           * grinding at full throttle. Fixing the counter exposed it, and
           * `tests/wedge.spec.ts` caught it immediately: the unit sealed in an
           * alcove moved 2.2 m instead of the 40 m the displacement rung gets it.
           *
           * So: a unit that has not physically moved since its wedge anchor IS
           * the wedge ladder's case, and this ladder hands it over rather than
           * ending it. Termination is not lost — the wedge ladder finishes with
           * a park rung of its own.
           */
          const adx = px - ag.anchorX[i], adz = pz - ag.anchorZ[i];
          const wedgeCase = adx * adx + adz * adz < NAV_WEDGE_METRES * NAV_WEDGE_METRES;
          if (!wedgeCase) {
            // Close enough, or we have shoved it enough times: parking here
            // beats grinding against a wall forever, which is what every RTS
            // that does NOT give up looks like.
            this.finishOrder(i);
            continue;
          }
          // Hand over, and shove no further: the nudge budget stays spent so
          // this ladder is not still pushing underneath the one that now owns
          // the unit. Falling through to the shove here is what the first
          // version of this guard did, and two ladders shoving one hull in
          // different directions is the fight the block above describes.
        } else {
          // Deterministic sideways shove, held until this same watchdog is next
          // able to fire (NAV_STUCK_TICKS of continued stalling).
          this.shove(i, px, pz, ddx, ddz, cls, s.tick, NAV_STUCK_TICKS);
          ag.nudges[i]++;
        }
      }

      // -- field -----------------------------------------------------------
      // Re-request when we have none, or periodically in case the LRU evicted
      // ours while it sat at refcount 0.
      const need = st.navField[i] < 0
        || (!this.nav.isReady(st.navField[i]) && sliceForEntity(s.tick, i, NAV_REPATH_TICKS))
        || sliceForEntity(s.tick, i, NAV_REPATH_TICKS * 4);
      if (need) {
        const gcx = clampCell(worldToCell(ag.goalX[i]));
        const gcz = clampCell(worldToCell(ag.goalZ[i]));
        // Pass where we ARE, not just where we are going. That is what lets
        // the cache notice a goal in another region and pull it back to the
        // nearest cell this unit can actually reach — a move order that stops
        // at the edge of the gorge, which is what a player expects, instead of
        // a column parked nose-first against it.
        const fid = this.nav.requestFieldClass(
          gcx, gcz, cls, clampCell(worldToCell(px)), clampCell(worldToCell(pz)),
        );
        const old = st.navField[i];
        if (fid < 0 && old < 0) {
          // Refused outright: nothing this unit can reach is anywhere near the
          // order point. Park it rather than letting Steering's direct-seek
          // fallback drive it into the obstacle for the rest of the match.
          this.unreachableOrders++;
          this.finishOrder(i);
          continue;
        }
        if (fid === old) {
          this.nav.release(fid);          // undo the ref this request added
        } else {
          if (old >= 0) this.nav.release(old);
          st.navField[i] = fid;
          this.repaths++;
        }
      }

      // -- direct-path shortcut --------------------------------------------
      // String pulling: on open ground a unit ignores the grid entirely, which
      // is what removes the last of the 8-way stair-stepping.
      if (sliceForEntity(s.tick, i, NAV_DIRECT_RECHECK_TICKS)) {
        const near = d2 <= NAV_DIRECT_RANGE * NAV_DIRECT_RANGE;
        const clear = near && this.nav.isDirectPathClearClass(px, pz, tx, tz, cls);
        if (clear) ag.flags[i] |= AgentFlag.DirectPath;
        else ag.flags[i] &= ~AgentFlag.DirectPath;
      }
    }

    this.assigned = assigned;
  }

  /**
   * Pick a direction for the unwedge shove and arm it.
   *
   * THE HALF-PLANE. `(tdx,tdz)` is the bearing to the unit's target — the one
   * bearing that has just been disproved, because the unit has spent seconds
   * driving along it and got nowhere. Every candidate therefore lies in the
   * OTHER half-plane: a quarter turn off at one end, dead away in the middle,
   * the other quarter turn at the far end.
   *
   * The bearing to the TARGET and not the hull's yaw, though yaw looks
   * equivalent while a unit is grinding nose-first and is what the first draft
   * used. It is not equivalent: the moment a shove turns the hull, yaw becomes
   * the SHOVE's direction, so the next attempt excludes the half-plane the last
   * one chose — including, for a unit halfway out of a dead end, the way out.
   *
   * WHY IT PROBES INSTEAD OF DRAWING. A single hashed draw is a lottery, and
   * the geometry that produces wedges is exactly the geometry that makes the
   * lottery unfair: a unit sealed in a slot between two walls has one escape
   * bearing out of a half-plane, and a shove into either wall does nothing at
   * all — the avoidance term is already pushing that way and Movement's wall
   * slide eats the rest. So walk NUDGE_PROBES bearings across the half-plane,
   * starting at the hashed offset so successive attempts are not the same
   * sweep, and take the first whose probe point is ground the hull could
   * actually stand on. Cheap: this runs only when a ladder rung fires, which is
   * once per unit per six seconds in the worst case and never in a healthy
   * match.
   *
   * The hash keeps it honest when NOTHING probes clear — two units leaning on
   * each other in a doorway have open ground in every direction and terrain
   * cannot tell them apart — and the hash is `hash2f`, a pure integer hash of
   * (slot, tick), NOT a draw from `s.rng`: a unit coming unstuck must not shift
   * the RNG stream and desync every replay downstream of it.
   */
  private shove(
    i: number, px: number, pz: number, tdx: number, tdz: number,
    cls: MoveClass, tick: number, hold: number,
  ): void {
    const st = this.world.store;
    const ag = this.agents;
    const base = Math.atan2(tdx, tdz) + Math.PI * 0.5;
    const h = hash2f(i, tick);
    // One cell past the hull: far enough that the answer is about the next
    // cell rather than about the one we are standing in.
    const reach = st.radius[i] + CELL;
    let fx = 0, fz = 0;
    for (let k = 0; k < NUDGE_PROBES; k++) {
      let t = h + k / NUDGE_PROBES;
      if (t >= 1) t -= 1;
      const ang = base + Math.PI * t;
      const dx = Math.sin(ang), dz = Math.cos(ang);
      if (k === 0) { fx = dx; fz = dz; }        // the fallback is the hashed one
      if (cls === MoveClass.Air) break;
      const cx = worldToCell(px + dx * reach);
      const cz = worldToCell(pz + dz * reach);
      if (isInMap(cx, cz) && this.nav.isStandable(cx, cz, cls)) {
        ag.armNudge(i, dx, dz, tick, hold);
        return;
      }
    }
    ag.armNudge(i, fx, fz, tick, hold);
  }

  /**
   * Lift a unit out of a passable region it cannot leave, onto the nearest
   * cell of the map proper.
   *
   * WHY A TELEPORT IS THE RIGHT ANSWER
   * ----------------------------------
   * There is no steering solution to a hole. The alternatives are to let the
   * unit climb terrain it is not allowed to climb (which makes cliffs
   * meaningless everywhere else), to carve the terrain at runtime (which
   * desynchronises the heightfield from the mesh the player is looking at), or
   * to leave an army standing in a pit for the rest of the match. A short,
   * bounded relocation onto the nearest connected cell is the only one of the
   * four that is both honest and recoverable, and it is bounded twice over:
   * the unit must be in a region it demonstrably cannot leave, and the
   * destination must be within NAV_REGION_SEARCH_CELLS.
   *
   * `proven` is the strict tier, run every tick: only pockets — regions at or
   * under NAV_POCKET_MAX_CELLS — qualify, because a small stranded scrap is
   * never anything but a generation artefact. The loose tier runs only after
   * the progress watchdog has watched the unit fail for nine seconds, and then
   * accepts a stranded region of any size, because by then being cut off has
   * been demonstrated rather than assumed. An island the unit is HAPPY on
   * never reaches either tier: both require an order whose goal lies outside
   * the unit's own region.
   *
   * Fully deterministic — a ring search over a labelled grid, no RNG draw, so
   * it cannot perturb `s.rng` and desync everything downstream.
   */
  private rescue(i: number, cls: MoveClass, proven: boolean): boolean {
    if (cls === MoveClass.Air) return false;
    const st = this.world.store;
    const ag = this.agents;
    const nav = this.nav;

    const cx = clampCell(worldToCell(st.posX[i]));
    const cz = clampCell(worldToCell(st.posZ[i]));
    const mine = nav.regionOf(cx, cz, cls);
    // Region 0 means the unit is standing on a cell the cost grid calls
    // closed — under a building that landed on it, most often. That is a
    // different bug with a different owner; do not paper over it here.
    if (mine === 0) return false;
    const main = nav.mainRegion(cls);
    if (main === 0 || mine === main) return false;
    if (proven && nav.regionSize(mine, cls) > NAV_POCKET_MAX_CELLS) return false;

    // The order must actually lead out of here. A unit ordered to a point
    // inside its own pocket is doing fine and must be left alone.
    const gcx = clampCell(worldToCell(ag.goalX[i]));
    const gcz = clampCell(worldToCell(ag.goalZ[i]));
    if (nav.regionOf(gcx, gcz, cls) === mine) return false;

    if (!nav.nearestInRegion(cx, cz, main, cls, RESCUE_CELL, NAV_REGION_SEARCH_CELLS)) return false;

    const nx = (RESCUE_CELL[0] + 0.5) * CELL;
    const nz = (RESCUE_CELL[1] + 0.5) * CELL;
    const ny = nav.rideHeight(cls, nx, nz);
    st.posX[i] = nx; st.posY[i] = ny; st.posZ[i] = nz;
    // Drag the interpolation source with it. `GameLoop.stepSim` snapshots prev
    // before any system runs, so leaving these behind would make the render
    // SLIDE the unit through the cliff over one frame — which reads as a bug
    // even though the fix is correct.
    st.prevX[i] = nx; st.prevY[i] = ny; st.prevZ[i] = nz;
    st.cellX[i] = RESCUE_CELL[0]; st.cellZ[i] = RESCUE_CELL[1];
    st.speed[i] = 0; st.velX[i] = 0; st.velZ[i] = 0;
    // The guard point is where a unit returns to after chasing something. If
    // it still points into the pocket the unit will drive straight back in.
    st.guardX[i] = nx; st.guardZ[i] = nz;

    // Everything about the old order's path is now wrong.
    if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
    ag.stuck[i] = 0; ag.nudges[i] = 0;
    ag.slotX[i] = 0; ag.slotZ[i] = 0;
    ag.restartProgress(i);
    ag.clearNudge(i);
    ag.armWedge(i, nx, nz);
    ag.flags[i] &= ~AgentFlag.DirectPath;

    this.rescues++;
    rescueTotal++;
    // First one always, then sparsely: a hundred trapped units must not become
    // a hundred console lines inside one tick, and a count is what tells you
    // whether this is one bad spawn or a whole broken map.
    if (rescueTotal === 1 || rescueTotal % 32 === 0) {
      console.warn(
        `[nav] unstuck a unit from a ${nav.regionSize(mine, cls)}-cell pocket ` +
        `at cell ${cx},${cz} -> ${RESCUE_CELL[0]},${RESCUE_CELL[1]} ` +
        `(${rescueTotal} rescue${rescueTotal === 1 ? '' : 's'} so far — ` +
        `something is placing units on ground they cannot leave)`,
      );
    }
    return true;
  }

  /**
   * One rung of the unwedge ladder. Returns true only when the unit's POSITION
   * changed, which tells the caller the rest of this tick's bookkeeping is
   * operating on stale numbers and must be skipped.
   *
   * Deterministic throughout: `hash2f` is a pure integer hash of (slot, tick)
   * and the displacement is a ring search over a labelled grid. Neither draws
   * from `s.rng`, so a unit coming unstuck cannot shift the RNG stream and
   * desync everything downstream of it — the same rule `rescue` follows and for
   * the same reason.
   */
  private unwedge(i: number, cls: MoveClass, px: number, pz: number, tick: number): boolean {
    const st = this.world.store;
    const ag = this.agents;
    const rung = ag.escalations[i];
    if (rung < 255) ag.escalations[i] = rung + 1;

    // -- rung 0: RE-PLAN ----------------------------------------------------
    // The cheapest and by far the most common fix. Note `Arrived` in the mask:
    // it is sticky until the order point moves, and a harvester whose FSM keeps
    // re-publishing the same dock apron never moves it — so a unit that nav
    // gave up on stays given up on for the rest of the match. This is the one
    // thing that clears it.
    if (rung === 0) {
      if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
      ag.flags[i] &= ~(AgentFlag.DirectPath | AgentFlag.Arrived);
      ag.stuck[i] = 0;
      ag.nudges[i] = 0;
      ag.restartProgress(i);
      wedgeCounters.repaths++;
      return false;
    }

    // -- rungs 1..N: NUDGE --------------------------------------------------
    // Held for a full sample window, so the next window measures a unit that
    // was actually being shoved for the whole of it rather than one that was
    // shoved for a moment and then left where it was.
    if (rung <= NAV_WEDGE_MAX_NUDGES) {
      agentTarget(ag, i, TARGET);
      this.shove(
        i, px, pz, TARGET[0] - px, TARGET[1] - pz, cls, tick, NAV_WEDGE_SAMPLE_TICKS,
      );
      ag.flags[i] &= ~(AgentFlag.DirectPath | AgentFlag.Arrived);
      ag.stuck[i] = 0;
      ag.restartProgress(i);
      wedgeCounters.nudges++;
      return false;
    }

    // -- past the last rung: PARK -------------------------------------------
    // The unit has been re-planned, shoved twice and physically picked up and
    // put down, and it is STILL not moving. Measured in a 4-minute AI match,
    // that shape is almost always a crowd pressed against the wall in front of
    // an order point nobody can stand on — twenty infantry at full throttle,
    // 4 m from where they were told to be, none of them able to give way. There
    // is nothing left to try, and the honest answer is the one the older
    // speed-based ladder already gives: park it. `finishOrder` deliberately
    // leaves a harvester's own FSM state alone, so the economy re-plans rather
    // than stopping.
    //
    // This rung is also what makes the ladder TERMINATE. Displacement used to
    // reset the rung, so a unit that walked straight back into its own jam was
    // displaced again every six seconds forever; the counter climbed while
    // nothing improved.
    if ((ag.flags[i] & AgentFlag.Displaced) !== 0) {
      this.finishOrder(i);
      wedgeCounters.parked++;
      return false;
    }

    // -- rung N+1: DISPLACE -------------------------------------------------
    if (cls === MoveClass.Air) return false;
    const cx = clampCell(worldToCell(px));
    const cz = clampCell(worldToCell(pz));
    // Prefer the region the GOAL is in — putting the unit somewhere routable
    // that still cannot reach its order would only start the ladder again.
    const gcx = clampCell(worldToCell(ag.goalX[i]));
    const gcz = clampCell(worldToCell(ag.goalZ[i]));
    let want = this.nav.regionOf(gcx, gcz, cls);
    if (want === 0) want = this.nav.mainRegion(cls);
    if (want === 0) return false;
    if (!this.freeCellNear(cx, cz, cls, want, RESCUE_CELL)) return false;

    const nx = (RESCUE_CELL[0] + 0.5) * CELL;
    const nz = (RESCUE_CELL[1] + 0.5) * CELL;
    const ny = this.nav.rideHeight(cls, nx, nz);
    st.posX[i] = nx; st.posY[i] = ny; st.posZ[i] = nz;
    // Drag the interpolation source with it, or the renderer slides the unit
    // THROUGH the building it was wedged against over a single frame.
    st.prevX[i] = nx; st.prevY[i] = ny; st.prevZ[i] = nz;
    st.cellX[i] = RESCUE_CELL[0]; st.cellZ[i] = RESCUE_CELL[1];
    st.speed[i] = 0; st.velX[i] = 0; st.velZ[i] = 0;

    if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
    ag.stuck[i] = 0; ag.nudges[i] = 0;
    ag.slotX[i] = 0; ag.slotZ[i] = 0;
    ag.restartProgress(i);
    ag.clearNudge(i);
    // Re-anchor at the new spot but KEEP the rung: if this did not free the
    // unit, the next window has to reach the park rung, not start over.
    ag.anchorX[i] = nx; ag.anchorZ[i] = nz; ag.anchorTick[i] = tick; ag.frozen[i] = 0;
    ag.flags[i] = (ag.flags[i] & ~(AgentFlag.DirectPath | AgentFlag.Arrived))
      | AgentFlag.Displaced;

    this.displacements++;
    wedgeCounters.displaced++;
    // Loud the first time, sparse after. A displacement is a bug report: the
    // clearance rule is supposed to make it impossible to get in there.
    if (wedgeCounters.displaced === 1 || wedgeCounters.displaced % 16 === 0) {
      console.warn(
        `[nav] a unit was wedged and had to be displaced from cell ${cx},${cz} ` +
        `-> ${RESCUE_CELL[0]},${RESCUE_CELL[1]} (kind ${st.kind[i]}, state ${st.state[i]}) ` +
        `— ${wedgeCounters.displaced} displacement${wedgeCounters.displaced === 1 ? '' : 's'}, ` +
        `${wedgeCounters.repaths} re-plans, ${wedgeCounters.nudges} nudges, ` +
        `${wedgeCounters.parked} parked so far`,
      );
    }
    return true;
  }

  /**
   * Nearest cell in `region` that `cls` may be ROUTED through, starting one
   * ring out so the answer is never the cell we are standing in.
   *
   * Ring order matches `snapToReachable` exactly (+Z edge, -Z edge, then the
   * two X edges) so two runs of one seed pick the same cell and a replay cannot
   * desync on an unwedge.
   */
  private freeCellNear(
    cx: number, cz: number, cls: MoveClass, region: number, out: Int32Array,
  ): boolean {
    for (let r = 1; r <= NAV_WEDGE_SEARCH_CELLS; r++) {
      for (let d = -r; d <= r; d++) {
        if (this.cellIsFree(cx + d, cz - r, cls, region, out)) return true;
        if (this.cellIsFree(cx + d, cz + r, cls, region, out)) return true;
      }
      for (let d = -r + 1; d <= r - 1; d++) {
        if (this.cellIsFree(cx - r, cz + d, cls, region, out)) return true;
        if (this.cellIsFree(cx + r, cz + d, cls, region, out)) return true;
      }
    }
    return false;
  }

  private cellIsFree(
    cx: number, cz: number, cls: MoveClass, region: number, out: Int32Array,
  ): boolean {
    if (!isInMap(cx, cz)) return false;
    if (this.nav.regionOf(cx, cz, cls) !== region) return false;
    out[0] = cx; out[1] = cz;
    return true;
  }

  /** Park a unit: order satisfied, field returned, velocity killed. */
  private finishOrder(i: number): void {
    const st = this.world.store;
    const ag = this.agents;
    if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
    ag.flags[i] |= AgentFlag.Arrived;
    ag.stuck[i] = 0;
    ag.restartProgress(i);
    ag.anchorWedge(i, st.posX[i], st.posZ[i]);
    st.velX[i] = 0; st.velZ[i] = 0;
    // `state` is written by whichever phase owns the behaviour (see the
    // ownership table in core/loop.ts) — completing a move order is ours.
    // `orderKind` belongs to Command and is deliberately left alone.
    // Harvester and repair states belong to Economy — arriving does not end
    // those behaviours, it starts the next stage of them. `Attacking` is the
    // same shape and belongs to Targeting: reaching the firing standoff is the
    // START of the engagement, so parking must not clear it. This is also what
    // makes a unit that the give-up ladder parked short of its target STAY
    // parked — Targeting only re-issues the goal when the target has moved.
    const s = st.state[i];
    if (s === UnitState.Moving || s === UnitState.Fleeing || s === UnitState.AttackMoving) {
      st.state[i] = UnitState.Idle;
      // AND THE POST MOVES WITH IT, IN THIS TICK, NOT THE NEXT ONE.
      //
      // `guardX/guardZ` is where a stance walks back to, and this line is the
      // moment a move order stops being in flight and becomes "this is where I
      // want you". The `!seeking` branch in `simTick` re-takes the post on the
      // same idea and is a phase EARLIER in the tick, so it cannot see a
      // transition that happens down here in loop 4 — leaving it to catch this
      // case sent a unit that had just completed a 60 m move straight back to
      // wherever it spawned, because `Targeting` (phase 900) read the stale
      // post before `PathRequest` (phase 500) got another turn.
      st.guardX[i] = st.posX[i];
      st.guardZ[i] = st.posZ[i];
    }
    this.arrivals++;
  }

  /**
   * Freeze each newly-ordered group's shape. Units that got the same order
   * point from the same player on the same tick keep their relative positions
   * instead of collapsing onto one spot.
   *
   * The offsets are clamped to a disc sized by the group's own count, so one
   * straggler 200 m behind the pack does not end up with a 200 m slot offset
   * and drive to the wrong side of the map.
   */
  private assignFormations(count: number): void {
    const st = this.world.store;
    const ag = this.agents;
    for (let k = 0; k < count; k++) GROUPED[NEW_ORDERS[k]] = 0;

    for (let k = 0; k < count; k++) {
      const seed = NEW_ORDERS[k];
      if (GROUPED[seed] !== 0) continue;

      const owner = st.owner[seed];
      const gx = ag.goalX[seed], gz = ag.goalZ[seed];
      let members = 0;
      let cx = 0, cz = 0;
      for (let j = k; j < count; j++) {
        const m = NEW_ORDERS[j];
        if (GROUPED[m] !== 0) continue;
        if (st.owner[m] !== owner) continue;
        const dx = ag.goalX[m] - gx, dz = ag.goalZ[m] - gz;
        if (dx * dx + dz * dz > NAV_FORMATION_GOAL_EPS * NAV_FORMATION_GOAL_EPS) continue;
        GROUPED[m] = 1;
        GROUP[members++] = m;
        cx += st.posX[m]; cz += st.posZ[m];
      }
      if (members < 2) continue;
      cx /= members; cz /= members;

      // Radius the formation is ALLOWED to occupy: enough area for `members`
      // discs at NAV_FORMATION_SPACING, capped so a huge selection cannot smear
      // across the whole map.
      let rSum = 0;
      for (let m = 0; m < members; m++) rSum += st.radius[GROUP[m]];
      const meanR = rSum / members;
      const allowed = Math.min(
        NAV_FORMATION_MAX_OFFSET,
        Math.sqrt(members) * meanR * NAV_FORMATION_SPACING,
      );

      // Uniform shrink, not per-unit clamping: clamping each offset
      // independently squashes the formation onto the boundary circle and the
      // shape (which is the entire point) is lost.
      let maxD = 0;
      for (let m = 0; m < members; m++) {
        const e = GROUP[m];
        const dx = st.posX[e] - cx, dz = st.posZ[e] - cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > maxD) maxD = d;
      }
      const scale = maxD > allowed && maxD > 1e-3 ? allowed / maxD : 1;
      for (let m = 0; m < members; m++) {
        const e = GROUP[m];
        ag.slotX[e] = (st.posX[e] - cx) * scale;
        ag.slotZ[e] = (st.posZ[e] - cz) * scale;
      }
    }
  }

  /** Release every field this assigner handed out. Between matches. */
  releaseAll(): void {
    const st = this.world.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
    }
  }
}

/* ==========================================================================
 * 4. STEERING SOLVER — Phase.Steering
 * ========================================================================== */

/** Query scratch. One buffer, reused every unit, never retained. */
const NEIGHBOURS = new Int32Array(MAX_QUERY_RESULTS);
/** Hard ceiling on neighbours examined per unit per tick. See the note below. */
const STEER_SCAN_CAP = Math.min(MAX_QUERY_RESULTS, SEPARATION_NEIGHBOURS * 3);
const FLOW = new Float32Array(2);

export class SteeringSolver {
  /** Diagnostics: how many units produced a non-zero desired velocity. */
  public moving = 0;

  constructor(
    private readonly world: World,
    private readonly nav: FlowFieldCache,
    private readonly agents: NavAgents,
  ) {}

  simTick(s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const ag = this.agents;
    const tick = s.tick;
    let moving = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      if (!isMover(st.flags[i], st.kind[i])) continue;

      const immobile = (st.flags[i] & EntityFlag.Immobilized) !== 0;
      const seeking = seeksGoal(st.state[i])
        && ag.valid(i, st.gen[i])
        && (ag.flags[i] & AgentFlag.Arrived) === 0;

      if (immobile || !seeking) {
        // Not going anywhere: bleed the desired velocity to zero so Movement
        // decelerates rather than stopping dead.
        st.velX[i] = 0;
        st.velZ[i] = 0;
        continue;
      }

      const cls = moveClassAt(st, i);
      const px = st.posX[i], pz = st.posZ[i];
      const radius = st.radius[i];
      const maxSpeed = st.maxSpeed[i];
      if (maxSpeed <= 0) { st.velX[i] = 0; st.velZ[i] = 0; continue; }

      // -- 1. where am I actually heading -----------------------------------
      // `agentTarget` and nothing else. NavAssigner measures arrival, give-up
      // and progress against the same call, and the two used to disagree — see
      // the file header. The group still shares ONE field because the field is
      // requested at `goalX/goalZ`; that has never had anything to do with the
      // target point.
      agentTarget(ag, i, TARGET);
      const tdx = TARGET[0] - px, tdz = TARGET[1] - pz;
      const targetDist = Math.sqrt(tdx * tdx + tdz * tdz);

      // A live unwedge shove. Read once: it is wanted twice, as the blend term
      // in §6 and as the fallback direction just below.
      const nudging = tick < ag.nudgeUntil[i];

      // -- 2. base direction -------------------------------------------------
      let dirX = 0, dirZ = 0;
      const direct = cls === MoveClass.Air
        || (ag.flags[i] & AgentFlag.DirectPath) !== 0
        || st.navField[i] < 0;
      if (!direct && this.nav.sample(st.navField[i], px, pz, FLOW)) {
        dirX = FLOW[0] * STEER_FLOW_WEIGHT;
        dirZ = FLOW[1] * STEER_FLOW_WEIGHT;
        // Near the goal the field's own resolution (4 m cells) is coarser than
        // the precision we want, so fold in the exact bearing.
        if (targetDist < CELL * 2 && targetDist > 1e-3) {
          dirX += tdx / targetDist;
          dirZ += tdz / targetDist;
        }
      } else if (targetDist > 1e-3) {
        dirX = tdx / targetDist;
        dirZ = tdz / targetDist;
      }
      if (dirX === 0 && dirZ === 0) {
        // No direction from anywhere — standing on the goal, or stranded off
        // the field entirely. If the ladder is shoving, that IS the direction;
        // a unit with nowhere to go is exactly the one that needs the shove.
        if (!nudging) { st.velX[i] = 0; st.velZ[i] = 0; continue; }
        dirX = ag.nudgeX[i]; dirZ = ag.nudgeZ[i];
      }
      {
        const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
        dirX /= l; dirZ /= l;
      }

      // -- 3. desired speed with arrival damping ----------------------------
      let speed = maxSpeed;
      if (targetDist < NAV_SLOWDOWN_RADIUS) {
        const t = targetDist / NAV_SLOWDOWN_RADIUS;
        speed = maxSpeed * Math.max(NAV_MIN_APPROACH_SPEED, t);
      }

      // -- 4. neighbours: separation + queueing + passing --------------------
      let sepX = 0, sepZ = 0;
      let passX = 0, passZ = 0;
      let queueSpeed = Infinity;
      // Right of travel, same convention as the obstacle sidestep in §5.
      const rightX = dirZ, rightZ = -dirX;
      if (cls !== MoveClass.Air) {
        const range = radius * STEER_SEPARATION_RANGE_MUL + 3;
        // CAP THE SCAN, not just the accepted count. In a 200-unit blob
        // converging on one order point the query radius eventually contains
        // the whole army, and an uncapped scan turns this loop quadratic —
        // measured at 3.1 ms/tick before this cap and 0.6 ms after. The hash
        // returns bucket-ordered results, so the ones we keep are the near
        // ones; we only ever USE SEPARATION_NEIGHBOURS of them anyway.
        const count = w.spatial.queryCircle(px, pz, range, NEIGHBOURS, STEER_SCAN_CAP);
        let used = 0;
        for (let q = 0; q < count && used < SEPARATION_NEIGHBOURS; q++) {
          const j = NEIGHBOURS[q];
          if (j === i) continue;
          const jf = st.flags[j];
          if ((jf & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
          const jMover = (jf & EntityFlag.CanMove) !== 0
            && (st.kind[j] === EntityKind.Infantry || st.kind[j] === EntityKind.Vehicle);
          if (jMover) {
            const jc = moveClassAt(st, j);
            // Aircraft, ships and ground units share no space.
            if (jc === MoveClass.Air) continue;
            if ((jc === MoveClass.Naval) !== (cls === MoveClass.Naval)) continue;
            // A HULL DOES NOT LEAN AROUND, OR BRAKE FOR, A MAN IT IS ENTITLED
            // TO DRIVE OVER. `sim/Crush.ts` owns that entitlement; this is the
            // half of it that lets the hull ARRIVE. Skipping the whole
            // neighbour here waives three things at once, and all three have to
            // go: the separation push (which steers the tank off his line), the
            // queue brake (which would hand a 6.6 m/s tank a rifleman's 3.2 m/s
            // as its speed), and the passing lean. It is symmetric, so he does
            // not sidestep out from under a hull that cannot sidestep around
            // him — an auto-dodge is a PLAYER verb and it is on a hotkey.
            if (crushPassesThrough(w, i, j)) continue;
          } else if (st.footprintW[j] > 0) {
            // Structures are already carved out of the cost field; pushing off
            // them here as well would make units bounce along walls.
            continue;
          }

          let dx = px - st.posX[j];
          let dz = pz - st.posZ[j];
          let d2 = dx * dx + dz * dz;
          const want = radius + st.radius[j];
          if (d2 >= want * want) continue;
          used++;

          if (d2 < 1e-6) {
            // Perfectly coincident (spawned on top of each other). Break the
            // tie deterministically by slot index instead of randomly.
            dx = (i < j ? -1 : 1) * 0.01;
            dz = (i < j ? 1 : -1) * 0.01;
            d2 = dx * dx + dz * dz;
          }
          const d = Math.sqrt(d2);
          // Linear falloff to zero at contact range; a 1/d^2 law makes tightly
          // packed groups explode.
          let push = (want - d) / want;
          if (!jMover || st.speed[j] < 0.15) push *= STEER_STATIC_PUSH_MUL;
          sepX += (dx / d) * push;
          sepZ += (dz / d) * push;

          // Queue brake: someone slower directly ahead of me sets my speed,
          // instead of me trying to drive through them.
          //
          // AND the sidestep that stops that brake from deadlocking. See the
          // measured account above STEER_QUEUE_MIN_FRAC in core/config: two
          // units nose to nose each inherit the other's speed minus a hair, the
          // recurrence contracts to zero, and the separation push is exactly
          // anti-parallel to travel so nothing ever leans sideways. Both units
          // biasing to their OWN right is the tie-break, because opposed
          // headings have opposed right-hand vectors and therefore cannot
          // mirror each other.
          if (jMover) {
            const fx = -dx / d, fz = -dz / d;          // me -> them
            if (fx * dirX + fz * dirZ > STEER_QUEUE_COS
                && d < want * STEER_QUEUE_RANGE_MUL) {
              // Their HEADING projected on my travel direction: +1 they are
              // going my way, -1 they are coming at me. Read from yaw and not
              // from velX/velZ because Steering is mid-pass — half the army
              // still holds last tick's desired velocity and half holds this
              // tick's, and that would make the answer depend on `alive` order.
              const along = Math.sin(st.yaw[j]) * dirX + Math.cos(st.yaw[j]) * dirZ;
              const oncoming = along < -STEER_PASS_COS;
              const stalled = st.speed[j] < maxSpeed * STEER_PASS_STALL_FRAC;
              if (oncoming || stalled) {
                // Not a queue to join — an obstruction to get around. Lean
                // harder the closer it is, so a distant one barely registers.
                const near = 1 - d / (want * STEER_QUEUE_RANGE_MUL);
                passX += rightX * near;
                passZ += rightZ * near;
              }
              if (st.speed[j] < speed) {
                const s2 = st.speed[j] + (d - want) * STEER_QUEUE_BRAKE;
                if (s2 < queueSpeed) queueSpeed = s2;
              }
            }
          } else if ((jf & EntityFlag.BlocksNav) !== 0 && st.kind[j] === EntityKind.Prop) {
            // SOLID SCENERY, and the same deadlock as two units nose to nose.
            //
            // `Movement.relax` makes a `BlocksNav` prop — a rock or a boulder —
            // physically solid, because `sim/Crush.ts` will not flatten one and
            // a hull must not drive through it. But the separation term above is
            // exactly ANTI-PARALLEL to travel when the rock is dead ahead, so on
            // its own it produces a stand-off: the flow field pushes forward,
            // the push cancels it, and the harvester sits in front of the rock
            // until the match ends. Measured: it stopped 51 m short of its
            // destination and stayed there.
            //
            // §5 cannot help — it probes the NAV GRID, and props are deliberately
            // not in it (see the prop branch in `Movement.relax`). So reuse the
            // sidestep this file already has for an obstruction that will not
            // move: lean to my own right, harder the closer it is. A rock is
            // never a queue to join, so there is no brake to inherit and no
            // oncoming test to make.
            const fx = -dx / d, fz = -dz / d;            // me -> it
            if (fx * dirX + fz * dirZ > STEER_QUEUE_COS
                && d < want * STEER_QUEUE_RANGE_MUL) {
              const near = 1 - d / (want * STEER_QUEUE_RANGE_MUL);
              passX += rightX * near;
              passZ += rightZ * near;
            }
          }
        }
      }

      // -- 5. obstacle avoidance --------------------------------------------
      let avoidX = 0, avoidZ = 0;
      if (cls !== MoveClass.Air && !direct) {
        /*
         * A SWEPT PROBE, NOT A POINT SAMPLE.
         *
         * This tested exactly one point, at `radius + STEER_AVOID_LOOKAHEAD`
         * metres dead ahead. For a harvester that is 3.87 + 3.2 = 7.07 m, and
         * `CELL` is 4 — so the probe landed in the SECOND cell along and the
         * first one, the one the hull was about to drive into, was never read.
         * An obstacle had to be conveniently far away to be seen at all.
         *
         * Measured on seed 4242 slot 83, pinned at cell 78,50 wanting -Z with
         * cell 78,49 blocked: standing at z = 200.0 exactly, the probe read
         * z = 192.9 — cell 48, which is open — so this whole term contributed
         * zero and the flow direction went through unopposed. The hull drove
         * into 78,49 at full throttle for 1800 ticks. It is the same class of
         * error as a bullet tunnelling through a wall between two frames, and
         * it has the same fix: sweep the interval instead of sampling its end.
         *
         * Steps of half a cell, so no cell between the hull and the lookahead
         * can be stepped over, and the unit's OWN cell is skipped — a hull that
         * is already standing on blocked ground must not be told to avoid
         * itself. `Movement.canStand` carries the same carve-out for the same
         * reason.
         *
         * Four array reads instead of one, per ground unit per tick.
         */
        const reach = radius + STEER_AVOID_LOOKAHEAD;
        const step = CELL * 0.5;
        const ocx = worldToCell(px), ocz = worldToCell(pz);
        let hit = 0;
        for (let t = step; t <= reach; t += step) {
          const qx = px + dirX * t, qz = pz + dirZ * t;
          if (worldToCell(qx) === ocx && worldToCell(qz) === ocz) continue;
          if (this.blocked(qx, qz, cls)) { hit = t; break; }
        }
        if (hit > 0) {
          // Probe the flanks at the DEPTH of the obstruction, not beside the
          // hull. "Is there open ground next to me" is not the question — the
          // question is "can I get past it on this side", and those differ
          // exactly when the obstruction is a wall running alongside.
          const rx = dirZ, rz = -dirX;                 // right of travel
          const ahead = hit * 0.5;
          const sx = px + rx * (radius + STEER_AVOID_SIDE) + dirX * ahead;
          const sz = pz + rz * (radius + STEER_AVOID_SIDE) + dirZ * ahead;
          const lx = px - rx * (radius + STEER_AVOID_SIDE) + dirX * ahead;
          const lz = pz - rz * (radius + STEER_AVOID_SIDE) + dirZ * ahead;
          const rightOpen = !this.blocked(sx, sz, cls);
          const leftOpen = !this.blocked(lx, lz, cls);
          if (rightOpen || leftOpen) {
            // Ties go right, deterministically, so two units meeting head-on
            // pass rather than mirror each other forever.
            const side = rightOpen ? 1 : -1;
            // Lean harder the closer it is. A constant-weight sidestep either
            // over-steers at range — swinging wide of something eight metres
            // off — or under-steers up close, and the old point probe could not
            // tell the two apart because it only ever saw one distance.
            const near = 1 - (hit - step) / reach;
            avoidX = rx * side * near;
            avoidZ = rz * side * near;
          }
          // NEITHER flank open and no sidestep at all. The old rule read
          // `rightOpen || !leftOpen ? 1 : -1`, which resolves a closed-closed
          // probe to "go right" — a full-weight 1.4 shove into a wall, chosen
          // because the tie-break ran before anyone asked whether there was a
          // side to take. It is not a tie: it is a dead end, and the answer to a
          // dead end is to stop leaning and let the flow field, or the unwedge
          // shove, decide. Measured in a two-cell alcove open only to -X: this
          // term alone pointed -Z at weight 1.4 and out-voted a 1.9 shove aimed
          // squarely at the exit, so the unit spent the whole ladder grinding
          // into the side wall and had to be teleported out.
          //
          // Slow down regardless — a tank at full speed clips the corner before
          // the steering can turn it, and that is true whether it is threading a
          // gap or backing out of a hole.
          speed *= 0.72;
        }
      }

      // -- 6. blend and write ------------------------------------------------
      // The unwedge shove joins here, as a fifth term, in EVERY branch and at
      // every distance. That placement is the whole fix: while a flow field is
      // being followed `dirX/dirZ` comes from `nav.sample()` and no amount of
      // moving the target point can bend it, so a remedy that lives in the
      // target point is a remedy that never runs.
      let vx = dirX + sepX * STEER_SEPARATION_WEIGHT + avoidX * STEER_AVOID_WEIGHT
        + passX * STEER_PASS_WEIGHT;
      let vz = dirZ + sepZ * STEER_SEPARATION_WEIGHT + avoidZ * STEER_AVOID_WEIGHT
        + passZ * STEER_PASS_WEIGHT;
      if (nudging) {
        vx += ag.nudgeX[i] * STEER_NUDGE_WEIGHT;
        vz += ag.nudgeZ[i] * STEER_NUDGE_WEIGHT;
      }
      const vl = Math.sqrt(vx * vx + vz * vz);
      if (vl < 1e-4) { st.velX[i] = 0; st.velZ[i] = 0; continue; }
      vx /= vl; vz /= vl;

      if (queueSpeed < speed) {
        // The brake may slow a unit to a crawl; it may NEVER command a dead
        // stop. A stopped unit has no velocity to steer with, so it cannot use
        // the sidestep above to leave the jam that stopped it — which is
        // exactly how two units ended up frozen nose to nose for the rest of
        // the match. `Math.min` keeps arrival damping authoritative: parking on
        // the goal is a legitimate way to reach zero, inheriting a neighbour's
        // zero is not.
        const floor = maxSpeed * STEER_QUEUE_MIN_FRAC;
        speed = queueSpeed < floor ? Math.min(speed, floor) : queueSpeed;
      }
      if (speed < 0) speed = 0;

      st.velX[i] = vx * speed;
      st.velZ[i] = vz * speed;
      // Movement turns the hull toward this at the chassis' own turn rate;
      // it never snaps.
      st.desiredYaw[i] = wrapAngle(Math.atan2(vx, vz));
      if (speed > 0.05) moving++;
    }

    this.moving = moving;
  }

  /**
   * True if the cell containing (x,z) is PHYSICALLY blocked for `cls`.
   *
   * The avoidance probe wants the wall, not the planning rule. A cell the nav
   * clearance rule closed (Flowfield §4c) still has open ground in it, and
   * treating it as an obstacle would make units veer away from perfectly solid
   * footing — including the footing under a unit that is trying to drive OUT of
   * one, which is the last thing that should be discouraged.
   */
  private blocked(x: number, z: number, cls: MoveClass): boolean {
    const cx = worldToCell(x), cz = worldToCell(z);
    if (!isInMap(cx, cz)) return true;
    return !this.nav.isStandable(cx, cz, cls);
  }
}

/* ==========================================================================
 * 5. HELPERS SHARED WITH MOVEMENT
 * ========================================================================== */

/**
 * THE point a unit is driving at, written into `out` as [x,z]. Order point plus
 * formation slot, unconditionally, for every caller.
 *
 * WHY THERE IS NO DISTANCE GATE ANY MORE
 * --------------------------------------
 * There was one, and it was the bug. `SteeringSolver` applied the slot only
 * inside NAV_FORMATION_ENGAGE_RADIUS; `NavAssigner` applied it always. So for
 * every unit outside that radius the assigner was deciding arrival, giving up
 * and probing for a direct path against a destination the solver was not
 * driving to. The gate could also not be satisfied: NAV_FORMATION_MAX_OFFSET
 * allowed a 30 m slot and the gate switched on at 22 m, so a unit could close
 * to 21 m, retarget 30 m away, retreat past 22 m, retarget back, and hunt until
 * the give-up ladder parked it — measured at 23.5 m short with a 28 m slot.
 *
 * Removing it costs nothing the gate was actually buying. One field per group
 * comes from requesting the field at `goalX/goalZ`, which this function does not
 * touch. And with a live field the solver's DIRECTION comes from `nav.sample()`
 * regardless, so outside the arrival ramp the target point only ever fed
 * distance maths — the same distance maths the assigner was already computing
 * the other way.
 *
 * Keep this the only definition. Two copies of it is precisely how the halves
 * drifted apart the first time.
 */
export function agentTarget(agents: NavAgents, i: number, out: Float32Array): Float32Array {
  out[0] = agents.goalX[i] + agents.slotX[i];
  out[1] = agents.goalZ[i] + agents.slotZ[i];
  return out;
}

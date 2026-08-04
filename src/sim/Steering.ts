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
 * three-term weighted blend (flow + separation + avoidance) plus an explicit
 * queue brake costs ~4% of the sim budget at 200 units and produces the
 * behaviour RA3 actually shows: columns that form up and follow, not a crowd
 * that flows around each other like fluid.
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
 * ONE flow field (aimed at the order point, so the goal bucketing keeps
 * working), and the slot only takes over inside NAV_FORMATION_ENGAGE_RADIUS of the
 * goal. That is what makes a line of tanks arrive as a line.
 * ============================================================================
 */

import {
  CELL, MAX_ENTITIES, MAX_QUERY_RESULTS, SEPARATION_NEIGHBOURS,
  NAV_ARRIVE_SLACK, NAV_SLOWDOWN_RADIUS, NAV_MIN_APPROACH_SPEED,
  NAV_DIRECT_RANGE, NAV_DIRECT_RECHECK_TICKS, NAV_REPATH_TICKS,
  NAV_STUCK_TICKS, NAV_STUCK_SPEED_FRAC, NAV_STUCK_GIVEUP_RADIUS,
  NAV_STUCK_MAX_NUDGES, NAV_NUDGE_METRES,
  NAV_FORMATION_SPACING, NAV_FORMATION_MAX_OFFSET, NAV_FORMATION_GOAL_EPS,
  NAV_FORMATION_ENGAGE_RADIUS,
  STEER_SEPARATION_WEIGHT, STEER_SEPARATION_RANGE_MUL, STEER_STATIC_PUSH_MUL,
  STEER_AVOID_WEIGHT, STEER_AVOID_LOOKAHEAD, STEER_AVOID_SIDE,
  STEER_QUEUE_COS, STEER_QUEUE_RANGE_MUL, STEER_QUEUE_BRAKE,
  STEER_FLOW_WEIGHT,
} from '../core/config';
import { EntityFlag, EntityKind, UnitState } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import { clampCell, hash2f, isInMap, worldToCell, wrapAngle } from '../core/math';
import { sliceForEntity } from '../core/loop';
import {
  MoveClass, NAV_POCKET_MAX_CELLS, NAV_REGION_SEARCH_CELLS, type FlowFieldCache,
} from './Flowfield';
import { moveClassAt } from './Movement';

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

/** Scratch for the rescue ring search. Module level: `simTick` never allocates. */
const RESCUE_CELL = new Int32Array(2);

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
  readonly flags = new Uint8Array(MAX_ENTITIES);

  /** True if this slot's state belongs to the CURRENT occupant. */
  valid(i: number, gen: number): boolean { return this.stamp[i] === gen; }

  /** Claim the slot for the current occupant and clear stale state. */
  claim(i: number, gen: number): void {
    this.stamp[i] = gen;
    this.goalX[i] = 0; this.goalZ[i] = 0;
    this.slotX[i] = 0; this.slotZ[i] = 0;
    this.stuck[i] = 0; this.nudges[i] = 0;
    this.bestDist[i] = -1; this.noProgress[i] = 0;
    this.flags[i] = 0;
  }

  /** Forget progress history. Called whenever the order point changes. */
  restartProgress(i: number): void {
    this.bestDist[i] = -1;
    this.noProgress[i] = 0;
  }
}

/* ==========================================================================
 * 2. WHAT COUNTS AS "TRYING TO GET SOMEWHERE"
 * ========================================================================== */

/**
 * The behavioural states that consume a flow field. Deliberately a switch and
 * not a bitmask on `flags`: `state` is the FSM every other module already
 * writes, and adding a parallel "is moving" bit would immediately drift out of
 * sync with it.
 */
export function seeksGoal(state: number): boolean {
  switch (state) {
    case UnitState.Moving:
    case UnitState.AttackMoving:
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

export class NavAssigner {
  /** Units currently holding a field. Diagnostics only. */
  public assigned = 0;
  public repaths = 0;
  public arrivals = 0;
  /** Units lifted out of a disconnected pocket, this match. */
  public rescues = 0;
  /** Orders ended because nothing near the goal was reachable at all. */
  public unreachableOrders = 0;

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
      if (!ag.valid(i, gen)) ag.claim(i, gen);

      const seeking = seeksGoal(st.state[i]);
      if (!seeking) {
        // Order finished or superseded by combat/economy: give the field back
        // so the LRU can reuse the slot.
        if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
        ag.flags[i] &= ~(AgentFlag.HasSlot | AgentFlag.Arrived | AgentFlag.DirectPath);
        ag.stuck[i] = 0; ag.nudges[i] = 0;
        ag.restartProgress(i);
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
        ag.flags[i] = (ag.flags[i] & ~(AgentFlag.Arrived | AgentFlag.DirectPath)) | AgentFlag.HasSlot;
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
      if ((ag.flags[i] & AgentFlag.Arrived) !== 0) continue;

      const cls = moveClassAt(st, i);
      const tx = ag.goalX[i] + ag.slotX[i];
      const tz = ag.goalZ[i] + ag.slotZ[i];
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

      // -- stuck -----------------------------------------------------------
      const maxSpeed = st.maxSpeed[i];
      if (maxSpeed > 0 && st.speed[i] < maxSpeed * NAV_STUCK_SPEED_FRAC) {
        if (ag.stuck[i] < 255) ag.stuck[i]++;
      } else {
        ag.stuck[i] = 0;
      }
      if (ag.stuck[i] >= NAV_STUCK_TICKS) {
        ag.stuck[i] = 0;
        if (d2 <= NAV_STUCK_GIVEUP_RADIUS * NAV_STUCK_GIVEUP_RADIUS
            || ag.nudges[i] >= NAV_STUCK_MAX_NUDGES) {
          // Close enough, or we have shoved it enough times: parking here beats
          // grinding against a wall forever, which is what every RTS that does
          // NOT give up looks like.
          this.finishOrder(i);
          continue;
        }
        // Deterministic sideways shove. `hash2f` is a pure integer hash, not a
        // draw from `s.rng`, so nudging a stuck unit cannot change the RNG
        // stream and desync everything downstream of it.
        const ang = hash2f(i, s.tick) * Math.PI * 2;
        ag.slotX[i] += Math.cos(ang) * NAV_NUDGE_METRES;
        ag.slotZ[i] += Math.sin(ang) * NAV_NUDGE_METRES;
        ag.nudges[i]++;
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

  /** Park a unit: order satisfied, field returned, velocity killed. */
  private finishOrder(i: number): void {
    const st = this.world.store;
    const ag = this.agents;
    if (st.navField[i] >= 0) { this.nav.release(st.navField[i]); st.navField[i] = -1; }
    ag.flags[i] |= AgentFlag.Arrived;
    ag.stuck[i] = 0;
    ag.restartProgress(i);
    st.velX[i] = 0; st.velZ[i] = 0;
    // `state` is written by whichever phase owns the behaviour (see the
    // ownership table in core/loop.ts) — completing a move order is ours.
    // `orderKind` belongs to Command and is deliberately left alone.
    // Harvester and repair states belong to Economy — arriving does not end
    // those behaviours, it starts the next stage of them.
    const s = st.state[i];
    if (s === UnitState.Moving || s === UnitState.Fleeing || s === UnitState.AttackMoving) {
      st.state[i] = UnitState.Idle;
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

  simTick(_s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const ag = this.agents;
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
      // Inside NAV_FORMATION_ENGAGE_RADIUS the unit peels off to its own slot;
      // outside it, the whole group follows the shared field to the order
      // point. One field, correct arrival shape.
      const gx = ag.goalX[i], gz = ag.goalZ[i];
      const rawDx = gx - px, rawDz = gz - pz;
      const goalDist = Math.sqrt(rawDx * rawDx + rawDz * rawDz);
      const engaged = goalDist < NAV_FORMATION_ENGAGE_RADIUS;
      const tx = engaged ? gx + ag.slotX[i] : gx;
      const tz = engaged ? gz + ag.slotZ[i] : gz;
      const tdx = tx - px, tdz = tz - pz;
      const targetDist = Math.sqrt(tdx * tdx + tdz * tdz);

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
      if (dirX === 0 && dirZ === 0) { st.velX[i] = 0; st.velZ[i] = 0; continue; }
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

      // -- 4. neighbours: separation + queueing -----------------------------
      let sepX = 0, sepZ = 0;
      let queueSpeed = Infinity;
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
          if (jMover) {
            const fx = -dx / d, fz = -dz / d;          // me -> them
            if (fx * dirX + fz * dirZ > STEER_QUEUE_COS
                && d < want * STEER_QUEUE_RANGE_MUL
                && st.speed[j] < speed) {
              const s2 = st.speed[j] + (d - want) * STEER_QUEUE_BRAKE;
              if (s2 < queueSpeed) queueSpeed = s2;
            }
          }
        }
      }

      // -- 5. obstacle avoidance --------------------------------------------
      let avoidX = 0, avoidZ = 0;
      if (cls !== MoveClass.Air && !direct) {
        const look = radius + STEER_AVOID_LOOKAHEAD;
        const ax = px + dirX * look, az = pz + dirZ * look;
        if (this.blocked(ax, az, cls)) {
          // Probe both flanks and lean toward whichever is open. Ties go right,
          // deterministically, so two units meeting head-on pass rather than
          // mirror each other forever.
          const rx = dirZ, rz = -dirX;                 // right of travel
          const sx = px + rx * (radius + STEER_AVOID_SIDE);
          const sz = pz + rz * (radius + STEER_AVOID_SIDE);
          const lx = px - rx * (radius + STEER_AVOID_SIDE);
          const lz = pz - rz * (radius + STEER_AVOID_SIDE);
          const rightOpen = !this.blocked(sx, sz, cls);
          const leftOpen = !this.blocked(lx, lz, cls);
          const side = rightOpen || !leftOpen ? 1 : -1;
          avoidX = rx * side;
          avoidZ = rz * side;
          // Slow down while threading a gap — a tank at full speed clips the
          // corner before the steering can turn it.
          speed *= 0.72;
        }
      }

      // -- 6. blend and write ------------------------------------------------
      let vx = dirX + sepX * STEER_SEPARATION_WEIGHT + avoidX * STEER_AVOID_WEIGHT;
      let vz = dirZ + sepZ * STEER_SEPARATION_WEIGHT + avoidZ * STEER_AVOID_WEIGHT;
      const vl = Math.sqrt(vx * vx + vz * vz);
      if (vl < 1e-4) { st.velX[i] = 0; st.velZ[i] = 0; continue; }
      vx /= vl; vz /= vl;

      if (queueSpeed < speed) speed = queueSpeed;
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

  /** True if the cell containing (x,z) is impassable for `cls`. */
  private blocked(x: number, z: number, cls: MoveClass): boolean {
    const cx = worldToCell(x), cz = worldToCell(z);
    if (!isInMap(cx, cz)) return true;
    return !this.nav.isPassableClass(cx, cz, cls);
  }
}

/* ==========================================================================
 * 5. HELPERS SHARED WITH MOVEMENT
 * ========================================================================== */

/**
 * The point a unit is actually driving at, written into `out` as [x,z].
 * Movement uses it for the final approach and the debug overlay draws it.
 */
export function agentTarget(
  agents: NavAgents, i: number, px: number, pz: number, out: Float32Array,
): Float32Array {
  const gx = agents.goalX[i], gz = agents.goalZ[i];
  const dx = gx - px, dz = gz - pz;
  if (dx * dx + dz * dz < NAV_FORMATION_ENGAGE_RADIUS * NAV_FORMATION_ENGAGE_RADIUS) {
    out[0] = gx + agents.slotX[i];
    out[1] = gz + agents.slotZ[i];
  } else {
    out[0] = gx; out[1] = gz;
  }
  return out;
}

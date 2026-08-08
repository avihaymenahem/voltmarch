/**
 * ============================================================================
 * VOLTMARCH — src/sim/Targeting.ts
 * ============================================================================
 * WHO SHOOTS WHAT. Round-robin sliced acquisition over the spatial hash.
 *
 * TWO COSTS, DELIBERATELY SEPARATED
 * ---------------------------------
 *   VALIDATION runs for every armed entity every tick and is a handful of
 *   integer tests: is the handle still live, still hostile, still visible,
 *   still inside the leash. It has to run every tick, because a target that
 *   died must not be shot at for another quarter second.
 *
 *   ACQUISITION runs for 1/TARGETING_SLICE of the army per tick via
 *   `sliceForEntity`, plus immediately for any unit whose target just went
 *   invalid. It is a circle query, a scored sweep and at most two line-of-sight
 *   walks. At 200 units and TARGETING_SLICE = 8 that is 25 scans a tick.
 *
 * PERSISTENCE IS A FEATURE, NOT AN OPTIMISATION
 * ---------------------------------------------
 * Without hysteresis, twenty tanks in a firefight re-pick the marginally
 * closest enemy every tick and the whole army's turrets twitch. Three
 * mechanisms stop that:
 *   - the held target scores x`stickiness` (1.35) so a rival must be clearly
 *     better, not marginally better, to steal the lock;
 *   - the drop range (`leashRangeMul`) is wider than the acquire range
 *     (`acquireRangeMul`), so a target sitting exactly on the range boundary
 *     cannot oscillate;
 *   - acquisition is sliced, so even a genuine change of mind cannot happen
 *     more than once every TARGETING_SLICE ticks.
 *
 * SCORING, IN ONE SENTENCE
 * ------------------------
 * Prefer things that shoot back, things you can actually hurt, things that hurt
 * you recently, wounded things, and near things — in that order of weight, with
 * structures last unless they are defences.
 *
 * THE APPROACH: WHY THE TARGETING PASS MOVES UNITS
 * ------------------------------------------------
 * A right-clicked attack order puts the unit in `UnitState.Attacking`, which
 * `core/types.ts` documents as "stationary or CLOSING on targetId". Something
 * has to do the closing, and it has to stop at a firing position rather than at
 * the target's wall, or artillery throws its whole range advantage away.
 *
 * Steering cannot do it: there is no weapon range on the entity store and no
 * standoff concept in that file. This module already resolves `weaponFor(i)`
 * for every armed entity every tick, so the range is free here and nowhere
 * else. So the same pattern `sim/Capture.ts` and `sim/Garrison.ts` use for
 * "go to this entity" orders lives here for Attack/ForceAttack: refresh
 * `orderX/orderZ` onto the target while it is out of range, park them on the
 * unit's own position once it is inside, and let the nav layer do the driving.
 * See §APPROACH below for the range band, the hysteresis and the give-up rules.
 *
 * WRITE OWNERSHIP: this file writes `targetId`, and `orderX/orderZ` for the
 * entities holding an explicit Attack/ForceAttack order. It never writes
 * `state` or `orderKind` — those stay with Command.
 * DETERMINISM: no wall clock, no Math.random; candidate order comes from the
 * spatial index, which is a counting sort over the dense alive list.
 * ============================================================================
 */

import {
  COMBAT_TARGETING, MAX_QUERY_RESULTS, RETALIATE_MEMORY, TARGETING_SLICE,
} from '../core/config';
import {
  ArmorClass, EntityFlag, EntityKind, OrderKind, ProjectileKind, Stance, UnitState,
} from '../core/types';
import type { EntityId, PlayerId, SimContext, WeaponDef } from '../core/types';
import { PerEntityU32 } from '../core/world';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { sliceForEntity } from '../core/loop';
import { armorMultiplier, hitRadius } from './Damage';
import { isAirborne, stanceAllowsAcquire, stateAllowsCombat, weaponCanHurt } from './Combat';
import type { WeaponSystem } from './Combat';

/* ==========================================================================
 * §APPROACH — THE TUNABLES THAT DECIDE WHERE AN ATTACK ORDER STOPS
 *
 * Three numbers, and each of them exists to prevent a specific, visible
 * failure. They live here rather than in core/config because they are only
 * meaningful next to the code that reads them, in the same way Steering.ts
 * keeps its own watchdog windows.
 *
 * THE BAND, NOT A LINE. A unit that drove until it was EXACTLY at `w.range`
 * would sit on the boundary, and every metre of drift — a neighbour shoving it,
 * a hull rotating about its own centre, a target creeping — would flip it in
 * and out of range. The result is an army that lurches forward and back and
 * never settles, which is worse to look at than the bug this fixes. So there
 * are two thresholds and the gap between them is a deadband:
 *
 *   STOP at   range * 0.80   coming in
 *   RESUME at range * 0.95   going out
 *
 * A unit therefore has to lose 15% of its range before it will spend a metre
 * chasing, and it never stops closer than it has to. 0.80 is chosen to keep a
 * long gun long: a 42 m siege mortar halts 33.6 m from the wall rather than
 * driving onto it, which is the entire point of owning a 42 m gun. It is also
 * far enough inside `w.range` that a target drifting a couple of metres does
 * not stop the shooting.
 * ========================================================================== */

/** Close until the target's surface is this fraction of weapon range away. */
const APPROACH_STOP_FRAC = 0.80;
/** Only start closing again past this fraction. Must exceed the stop fraction. */
const APPROACH_RESUME_FRAC = 0.95;
/**
 * Never stop inside a minimum-range weapon's dead zone with no margin: an
 * artillery piece parked at exactly `minRange` cannot fire the moment anything
 * nudges it inward.
 */
const APPROACH_MIN_RANGE_MUL = 1.30;
/**
 * How far the target must move before the goal is re-published, metres. One nav
 * cell.
 *
 * THIS IS THE CONSTANT THAT MAKES THE WHOLE THING COOPERATE WITH THE NAV
 * WATCHDOGS. `NavAssigner` treats any change of `orderX/orderZ` larger than
 * NAV_FORMATION_GOAL_EPS (0.6 m) as a NEW ORDER: it re-seats the formation
 * slot, restarts the progress watchdog and re-arms the wedge watchdog. Writing
 * the target's position every tick would therefore reset all three every tick,
 * and every give-up rule in Steering — the stuck ladder, the nine-second
 * progress window, the unreachable-order park — would be unable to ever fire.
 * A unit ordered onto a building on an island would re-path forever.
 *
 * Against a STATIC target the goal is published once and then never again, so
 * the ladder runs exactly as it does for a move order and terminates the same
 * way. Against a moving one the goal is republished per 4 m of target travel,
 * which is what makes a chase track, and the lag it costs is irrelevant — the
 * stop/resume decision below reads the target's LIVE position, not the goal.
 */
const APPROACH_GOAL_REFRESH_METRES = 4.0;

/**
 * `approaching` values. Plain integers: the side table is a Uint32Array.
 *
 * THREE STATES, NOT TWO, and the third is what stops this from churning. 0 is
 * what a never-written or recycled slot reads, so it cannot be `PARKED` — the
 * park goal has to be PUBLISHED once on the way in, and a unit given an attack
 * order on something already in range enters the parked state without ever
 * having closed. Without a distinct "not decided yet" value that unit's goal
 * would still be the raw click point on the target's footprint, and the nav
 * layer would happily drive it into the wall.
 *
 * Publishing exactly once per ENTRY into parked (rather than whenever the goal
 * and the unit have drifted apart) is also what makes a firing line stable:
 * units shoved by their neighbours drive back to the position they stopped at
 * instead of ratcheting forward, because the goal never follows them.
 */
const APPROACH_UNDECIDED = 0;
const APPROACH_CLOSING = 1;
const APPROACH_PARKED = 2;

export interface TargetingStats {
  /** Armed entities considered this tick. */
  armed: number;
  /** Entities holding a live target at the end of the tick. */
  engaged: number;
  /** Acquisition scans run this tick. */
  scans: number;
  /** Targets newly acquired this tick. */
  acquired: number;
  /** Candidates rejected for having no line of sight. */
  losRejects: number;
  /**
   * Units driving toward an explicit attack target this tick. Reads zero in a
   * settled firefight and non-zero while an army is crossing the map, so it is
   * the one number that distinguishes "not shooting yet" from "not moving".
   */
  closing: number;
}

export class TargetingSystem {
  /** Owned scratch: the world's shared buffer is not re-entrant here. */
  private readonly candidates = new Int32Array(MAX_QUERY_RESULTS);

  /**
   * Which side of the approach deadband each unit is on. Generation-stamped,
   * so a recycled slot starts PARKED rather than inheriting a dead unit's
   * charge across the map. Allocated once; nothing below it allocates.
   */
  private readonly approaching: PerEntityU32;

  readonly stats: TargetingStats = {
    armed: 0, engaged: 0, scans: 0, acquired: 0, losRejects: 0, closing: 0,
  };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly weapons: WeaponSystem,
  ) {
    this.approaching = new PerEntityU32(world.store, APPROACH_UNDECIDED);
  }

  /* ====================================================================== */

  tick(s: SimContext): void {
    const st = this.world.store;
    const n = st.aliveCount;
    this.stats.armed = 0;
    this.stats.engaged = 0;
    this.stats.scans = 0;
    this.stats.acquired = 0;
    this.stats.losRejects = 0;
    this.stats.closing = 0;

    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.CanAttack) === 0) {
        if (st.targetId[i] !== 0) st.targetId[i] = 0;
        continue;
      }
      if ((f & EntityFlag.UnderConstruction) !== 0) { st.targetId[i] = 0; continue; }
      if (!stateAllowsCombat(st.state[i] as UnitState)) { st.targetId[i] = 0; continue; }

      const w = this.weapons.weaponFor(i);
      if (w === undefined) { st.targetId[i] = 0; continue; }
      this.stats.armed++;

      // --- an explicit order beats everything -----------------------------
      const order = st.orderKind[i] as OrderKind;
      if (order === OrderKind.Attack || order === OrderKind.ForceAttack) {
        const ot = st.index(st.orderTarget[i] as EntityId);
        if (ot >= 0 && (st.flags[ot] & EntityFlag.PendingDestroy) === 0) {
          // A forced attack ignores alliance, visibility and priority. It does
          // NOT ignore the leash: an order to attack something 400 m away still
          // has to wait for the movement layer to close the distance — which is
          // what `approach` below asks for.
          st.targetId[i] = st.handleOf(ot) as number;
          this.approach(i, ot, w);
          this.stats.engaged++;
          continue;
        }
        // ForceAttack on a dead thing falls through to normal acquisition,
        // which is what makes "attack that tank" keep meaning something once
        // the tank is gone. The unit stops where it stands rather than driving
        // on to the corpse — or, for a force-fire into shroud that never had a
        // target handle at all, rather than driving onto the impact point.
        this.halt(i);
      }

      // --- validate ---------------------------------------------------------
      const hadTarget = st.targetId[i] !== 0;
      const cur = st.index(st.targetId[i] as EntityId);
      const stillGood = cur >= 0 && this.isValidTarget(i, cur, w, COMBAT_TARGETING.leashRangeMul);
      if (!stillGood && hadTarget) st.targetId[i] = 0;

      // --- acquire ----------------------------------------------------------
      // Slice ticks do the routine sweep. A unit that JUST lost its lock — the
      // target died, cloaked, or drove out of the leash — scans immediately
      // instead of waiting for its slot to come round, because standing idle
      // for a quarter second after a kill is the most visible AI failure an RTS
      // has. That burst is bounded by the number of targets lost this tick.
      const sliceTick = sliceForEntity(s.tick, i, TARGETING_SLICE);
      if (stillGood && !sliceTick) { this.stats.engaged++; continue; }
      if (!stillGood && !sliceTick && !hadTarget) continue;
      if (!stanceAllowsAcquire(st.stance[i] as Stance) && !stillGood) continue;

      const before = st.targetId[i];
      this.acquire(s, i, w, cur);
      if (st.targetId[i] !== 0) {
        this.stats.engaged++;
        if (st.targetId[i] !== before) this.stats.acquired++;
      }
    }
  }

  /* ======================================================================
   * §APPROACH — CLOSING ON AN ORDERED TARGET
   * ====================================================================== */

  /**
   * Whether this module is allowed to own `orderX/orderZ` for entity `i`.
   *
   * `state === Attacking` is the load-bearing test, not a formality. `orderKind`
   * outlives the state it created — a unit can be carrying `OrderKind.Attack`
   * while the AI, a guard behaviour or a harvester FSM has since put it into
   * some other state that uses `orderX/orderZ` as ITS goal. Writing over that
   * would send a harvester to a battle. Only the state an attack order actually
   * produces is ours.
   */
  private managesGoal(i: number): boolean {
    const st = this.world.store;
    if (st.state[i] !== UnitState.Attacking) return false;
    const f = st.flags[i];
    if ((f & EntityFlag.CanMove) === 0) return false;
    if ((f & EntityFlag.Garrisoned) !== 0) return false;
    const kind = st.kind[i];
    return kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
  }

  /**
   * Stop here. Publishes the unit's own position as its goal, once, so the nav
   * layer parks it instead of continuing to drive at whatever the order point
   * used to be.
   */
  private park(i: number): void {
    if (this.approaching.getAt(i) === APPROACH_PARKED) return;
    const st = this.world.store;
    this.approaching.setAt(i, APPROACH_PARKED);
    st.orderX[i] = st.posX[i];
    st.orderZ[i] = st.posZ[i];
  }

  /**
   * Drive toward `t` until it is comfortably inside weapon range, then stop.
   *
   * WHY THE GOAL IS THE TARGET'S CENTRE AND NOT A STANDOFF POINT
   * -----------------------------------------------------------
   * The obvious implementation — aim at a point `stop` metres short of the
   * target, along the bearing — moves that point every time the unit moves. The
   * flow-field cache buckets fields by goal CELL, so a goal that slides a metre
   * a tick evicts and re-expands a field continuously, and `NavAssigner` reads
   * every slide as a fresh order. Aiming at the target's centre and deciding
   * separately when to STOP keeps the goal still, which is the same trick
   * `sim/Capture.ts` uses to walk an engineer into a footprint it can never
   * stand on.
   *
   * The stop is expressed by re-publishing the unit's own position as the goal,
   * which `NavAssigner` immediately satisfies (`finishOrder`) and which leaves
   * `state` at `Attacking` so the weapon stays hot.
   *
   * HOLD GROUND is the one stance that refuses to close at all — its documented
   * contract in `core/types.ts` is "never move for any reason", and a player who
   * set it on a chokepoint garrison means it. Such a unit is parked rather than
   * skipped: skipping would leave the raw click point as its goal and the nav
   * layer would drive it there, which is the opposite of what the stance says.
   * HOLD FIRE deliberately does close — its contract is "move to the target but
   * never fire unless force-fired".
   */
  private approach(i: number, t: number, w: WeaponDef): void {
    const st = this.world.store;
    if (!this.managesGoal(i)) return;
    if (st.stance[i] === Stance.HoldGround || w.range <= 0) { this.park(i); return; }

    const px = st.posX[i], pz = st.posZ[i];
    const tx = st.posX[t], tz = st.posZ[t];
    const dx = tx - px, dz = tz - pz;
    // Surface distance, exactly the quantity `WeaponSystem` gates firing on —
    // measuring to a Construction Yard's centre would leave the unit 12 m short
    // of a range it already had.
    const surface = Math.sqrt(dx * dx + dz * dz)
      - hitRadius(st.footprintW[t], st.footprintH[t], st.radius[t]);

    const resume = w.range * APPROACH_RESUME_FRAC;
    let stop = w.range * APPROACH_STOP_FRAC;
    if (w.minRange > 0) {
      const floor = w.minRange * APPROACH_MIN_RANGE_MUL;
      if (floor > stop) stop = Math.min(floor, resume);
    }

    // The deadband. A unit already closing keeps closing until `stop`; a unit
    // already parked stays parked until the target has escaped past `resume`.
    const wasClosing = this.approaching.getAt(i) === APPROACH_CLOSING;
    if (surface <= (wasClosing ? stop : resume)) { this.park(i); return; }

    this.stats.closing++;
    this.approaching.setAt(i, APPROACH_CLOSING);
    // Re-publish only when the target has actually gone somewhere. See
    // APPROACH_GOAL_REFRESH_METRES: republishing every tick would re-arm every
    // give-up watchdog in Steering every tick and no order could ever end.
    const gx = st.orderX[i] - tx, gz = st.orderZ[i] - tz;
    if (gx * gx + gz * gz > APPROACH_GOAL_REFRESH_METRES * APPROACH_GOAL_REFRESH_METRES) {
      st.orderX[i] = tx;
      st.orderZ[i] = tz;
    }
  }

  /**
   * The ordered target is gone (killed, or never resolved at all — a force-fire
   * into shroud carries `target = NONE` by design). Stop where you stand and
   * let ordinary acquisition take over.
   *
   * This is what keeps the change to `seeksGoal` from turning every force-fire
   * at a point into a march onto that point: with no target handle there is no
   * range to stand off at, so the honest answer is the pre-existing one — do
   * not move.
   */
  private halt(i: number): void {
    if (!this.managesGoal(i)) return;
    this.park(i);
  }

  /* ======================================================================
   * VALIDATION
   * ====================================================================== */

  /** Everything that must remain true for `t` to stay this entity's target. */
  private isValidTarget(i: number, t: number, w: WeaponDef, rangeMul: number): boolean {
    const world = this.world;
    const st = world.store;
    const f = st.flags[t];
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.Cloaked |
              EntityFlag.Garrisoned | EntityFlag.NotATarget)) !== 0) return false;

    const me = st.owner[i] as PlayerId;
    if (world.areAllied(me, st.owner[t] as PlayerId)) return false;
    if (!weaponCanHurt(w, st.armorClass[t] as ArmorClass, isAirborne(st, t))) return false;
    if (!world.vision.canSee(me, st.handleOf(t))) return false;

    const dx = st.posX[t] - st.posX[i], dz = st.posZ[t] - st.posZ[i];
    const surface = Math.sqrt(dx * dx + dz * dz)
      - hitRadius(st.footprintW[t], st.footprintH[t], st.radius[t]);
    if (surface > w.range * rangeMul) return false;
    // A target that has walked INSIDE an artillery piece's dead zone is no
    // longer a target for it — otherwise the gun sits pointed at its own feet.
    if (w.minRange > 0 && surface < w.minRange * 0.75) return false;
    return true;
  }

  /* ======================================================================
   * ACQUISITION
   * ====================================================================== */

  /**
   * Sweep everything hostile inside the acquire radius and take the best.
   * Keeps the best AND the runner-up so a line-of-sight rejection has somewhere
   * to fall back to without a second query.
   */
  private acquire(s: SimContext, i: number, w: WeaponDef, currentIdx: number): void {
    const world = this.world;
    const st = world.store;
    this.stats.scans++;

    const radius = w.range * COMBAT_TARGETING.acquireRangeMul
      + hitRadius(st.footprintW[i], st.footprintH[i], st.radius[i]);
    const me = st.owner[i] as PlayerId;
    const myX = st.posX[i], myZ = st.posZ[i];
    const out = this.candidates;
    const count = world.spatial.queryCircleFat(
      myX, myZ, radius, out, Math.min(out.length, COMBAT_TARGETING.maxCandidates),
    );

    const retaliating = (s.time - st.lastHitTime[i]) <= RETALIATE_MEMORY;
    const revenge = retaliating ? (st.lastAttackerId[i] as number) : 0;
    const invRange = 1 / Math.max(1, w.range);

    let best = -1, bestScore = 0;
    let second = -1, secondScore = 0;

    for (let c = 0; c < count; c++) {
      const t = out[c];
      if (t === i) continue;
      if (!this.isValidTarget(i, t, w, COMBAT_TARGETING.acquireRangeMul)) continue;

      const dx = st.posX[t] - myX, dz = st.posZ[t] - myZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const tf = st.flags[t];
      const kind = st.kind[t] as EntityKind;

      let score = 1;
      if ((tf & EntityFlag.CanAttack) !== 0) score *= COMBAT_TARGETING.armedTarget;
      if (kind === EntityKind.Building) {
        score *= (tf & EntityFlag.CanAttack) !== 0
          ? COMBAT_TARGETING.defenceBuilding
          : COMBAT_TARGETING.softBuilding;
      }
      if ((tf & EntityFlag.IsHarvester) !== 0) score *= COMBAT_TARGETING.harvester;

      const maxHp = st.maxHp[t];
      if (maxHp > 0 && st.hp[t] / maxHp < COMBAT_TARGETING.woundedFrac) {
        score *= COMBAT_TARGETING.wounded;
      }
      if (revenge !== 0 && (st.handleOf(t) as number) === revenge) {
        score *= COMBAT_TARGETING.retaliation;
      }
      if (t === currentIdx) score *= COMBAT_TARGETING.stickiness;

      // Shooting a Rhino with a rifle is legal and almost always wrong.
      if (armorMultiplier(w.warhead, st.armorClass[t] as ArmorClass)
          <= COMBAT_TARGETING.ineffectiveBelow) {
        score *= COMBAT_TARGETING.ineffective;
      }

      score /= (COMBAT_TARGETING.distanceSoftness + dist * invRange);

      if (score > bestScore) {
        second = best; secondScore = bestScore;
        best = t; bestScore = score;
      } else if (score > secondScore) {
        second = t; secondScore = score;
      }
    }

    // Line of sight, only for the winner (and the runner-up if the winner is
    // behind a ridge). Arcing weapons skip it entirely — lobbing over cover is
    // the entire point of artillery.
    const needsLos = w.projectile !== ProjectileKind.Shell;
    if (best >= 0 && needsLos && !this.hasLineOfSight(i, best)) {
      this.stats.losRejects++;
      best = (second >= 0 && this.hasLineOfSight(i, second)) ? second : -1;
      if (best < 0) this.stats.losRejects++;
    }

    st.targetId[i] = best >= 0 ? (st.handleOf(best) as number) : 0;
  }

  /* ======================================================================
   * LINE OF SIGHT
   * ====================================================================== */

  /**
   * Walk the heightfield between the muzzle and the aim point.
   *
   * This is a TERRAIN test, not an occlusion test: units and buildings do not
   * block fire. That is a deliberate C&C rule, not a shortcut — mutual
   * blocking turns any two-rank formation into a traffic jam of units refusing
   * to shoot, and no Westwood game has ever done it.
   */
  private hasLineOfSight(i: number, t: number): boolean {
    const terrain = this.world.terrain;

    this.weapons.muzzleOf(i, LOS_A);
    this.weapons.aimPointOf(t, LOS_B);
    const ax = LOS_A[0], ay = LOS_A[1], az = LOS_A[2];
    const bx = LOS_B[0], by = LOS_B[1], bz = LOS_B[2];

    const dx = bx - ax, dz = bz - az;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat < 1e-3) return true;
    const steps = Math.min(24, Math.max(1, Math.ceil(flat / COMBAT_TARGETING.losStepMetres)));
    const clearance = COMBAT_TARGETING.losClearance;

    // Skip the endpoints: the muzzle is inside its own hull's cell and the aim
    // point is inside the target's, and both would self-block on a slope.
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      const sx = ax + dx * u;
      const sz = az + dz * u;
      const lineY = ay + (by - ay) * u;
      if (terrain.heightAt(sx, sz) > lineY + clearance) return false;
    }
    return true;
  }

  /** Between matches. */
  reset(): void {
    const st = this.world.store;
    for (let a = 0; a < st.aliveCount; a++) st.targetId[st.alive[a]] = 0;
  }
}

/** Module-level LOS scratch. Never held across a call. */
const LOS_A = new Float32Array(3);
const LOS_B = new Float32Array(3);

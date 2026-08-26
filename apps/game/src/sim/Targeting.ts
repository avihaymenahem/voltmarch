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
 * THE POST, THE LEASH AND THE FOUR STANCES
 * ----------------------------------------
 * See §LEASH below. In one line: a unit that is not carrying out an order has a
 * POST (`guardX/guardZ`), its stance says how far it will leave that post to
 * fight, and this module drives the round trip. That is what makes `Aggressive`
 * and `Defensive` different behaviours rather than two names for standing still.
 *
 * WRITE OWNERSHIP: this file writes `targetId`; `orderX/orderZ` for the
 * entities holding an explicit Attack/ForceAttack order AND for the entities on
 * a stance excursion (`UnitState.Guarding`); and `state`, but ONLY the
 * `Idle <-> Guarding` pair and only for units carrying no order that uses those
 * columns. It never writes `orderKind` or `orderTarget` — those stay with
 * Command, which is what makes a player order survive an excursion.
 * DETERMINISM: no wall clock, no Math.random; candidate order comes from the
 * spatial index, which is a counting sort over the dense alive list.
 * ============================================================================
 */

import {
  COMBAT_TARGETING, MAX_QUERY_RESULTS, NAV_ARRIVE_SLACK, NAV_FORMATION_GOAL_EPS,
  RETALIATE_MEMORY, STANCE_CHASE_METRES, STANCE_RETURNS, STANCE_RETURN_SLACK,
  TARGETING_SLICE,
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

/* ==========================================================================
 * §LEASH — THE POST, THE EXCURSION, AND WHERE THE RETURN GOAL LIVES
 *
 * THE DEFECT THIS REPLACES. `Stance` has four members with four docstrings and
 * two of them named the same code path. Measured on a unit with a 24 m gun and
 * an enemy 34 m away: `Aggressive` moved 0.00 m, `Defensive` moved 0.00 m,
 * `HoldGround` moved 0.00 m. `GUARD_LEASH` was declared in config and read by
 * nothing. `guardX/guardZ` were written by six modules — the Guard order, the
 * scenario spawner, `EntityStore.alloc`, `Production`'s rally, `Garrison` and
 * `Transport` on entry and exit, `Steering`'s pocket rescue — serialised into
 * every save file, listed in the write-ownership table, and read for behaviour
 * by nobody. `OrderKind.Guard` did not even drive the unit to the point it was
 * told to guard.
 *
 * THE POST. `guardX/guardZ` is where a unit belongs when nobody is telling it
 * anything. It is re-taken on exactly one edge — the tick a goal-seeking state
 * ends, in `NavAssigner` — so it tracks the player's last expressed intent
 * (arrival, `Stop`, a give-up park) and nothing else. `OrderKind.Guard` pins it
 * explicitly and it is not re-taken while that order stands.
 *
 * THE EXCURSION, AND THE TRAP IT HAD TO AVOID. There is no order stack in this
 * game: `OrderExecutor.write` overwrites `orderX/orderZ` and nothing restores
 * them. A unit that chases and then wants to come home therefore must NOT do it
 * by giving itself an order — that would silently destroy a queued move the
 * player is still waiting on, and in multiplayer a sim-issued command would be
 * stamped with the sending socket's slot by the relay, accepted on one client
 * and rejected on the other. A genuine desync, from a "convenience".
 *
 * So the return goal lives in `guardX/guardZ`, a column no order consumes, and
 * the excursion runs entirely as SIM STATE evolving from hashed columns:
 *
 *   - it exists only in `UnitState.Guarding`, a state no player order produces
 *     except `OrderKind.Guard` itself;
 *   - `Phase.Command` runs at 100 and this module at 900, so a right-click
 *     lands, moves the unit out of `Guarding`, and is seen by the very next
 *     line of this file in the SAME tick. The player always wins;
 *   - `orderKind`/`orderTarget` are never touched, so the order that was in
 *     flight is still legible afterwards.
 *
 * THE LEASH IS MEASURED FROM THE POST TO THE TARGET, never from the post to the
 * unit. "How far have I come" oscillates on its own boundary — reach the limit,
 * turn home, be inside the limit, turn back — because the unit's own motion
 * feeds the decision. The target's distance from a fixed post does not move
 * when the unit does, so there is nothing to oscillate.
 *
 * The envelope is `chase + range * APPROACH_STOP_FRAC`, not `chase`, because
 * `approach()` stops that far SHORT of the target. A unit sent after something
 * at the edge of the envelope therefore comes to rest at about `chase` metres
 * from its post, which is what the number is supposed to mean.
 * ========================================================================== */

/** `excursion` values. Plain integers: the side table is a Uint32Array. */
/** At the post (or on the way to it and arrived). The resting value. */
const POST_HOLDING = 0;
/** Out engaging something. `approach()` owns the goal. */
const POST_ENGAGED = 1;
/** Nothing left to fight: walking back to `guardX/guardZ`. */
const POST_RETURNING = 2;

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
  /** Units currently off their post chasing a target of opportunity. */
  chasing: number;
  /** Units currently walking back to their post. */
  returning: number;
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

  /**
   * Where each unit is in its round trip away from the post. See §LEASH.
   *
   * A SIDE TABLE AND NOT A STORE COLUMN, deliberately: it is recoverable from
   * `state`, `orderX/orderZ` and `guardX/guardZ` — all of which the checksum
   * hashes — within one tick of any divergence, so paying for a save-game
   * column and a hash slot would buy nothing. Generation-stamped, so a recycled
   * slot starts HOLDING rather than inheriting a dead unit's excursion.
   */
  private readonly excursion: PerEntityU32;

  readonly stats: TargetingStats = {
    armed: 0, engaged: 0, scans: 0, acquired: 0, losRejects: 0, closing: 0,
    chasing: 0, returning: 0,
  };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly weapons: WeaponSystem,
  ) {
    this.approaching = new PerEntityU32(world.store, APPROACH_UNDECIDED);
    this.excursion = new PerEntityU32(world.store, POST_HOLDING);
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
    this.stats.chasing = 0;
    this.stats.returning = 0;

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

      // WHO TO SHOOT, then WHERE TO STAND. Two passes and never one: the second
      // needs the target the first settled on, and it has to run on EVERY tick
      // including the ones where the first returns early on its slice. A unit
      // walking home has no target at all and still has somewhere to be.
      this.resolveTarget(s, i, w);
      this.holdPost(i, w);
    }
  }

  /**
   * Settle `targetId` for one armed entity. Everything that was the body of the
   * tick loop before the post behaviour was added; `return` here means the same
   * thing `continue` meant there.
   */
  private resolveTarget(s: SimContext, i: number, w: WeaponDef): void {
    const st = this.world.store;

    // --- an explicit order beats everything -------------------------------
    const order = st.orderKind[i] as OrderKind;
    if (order === OrderKind.Attack || order === OrderKind.ForceAttack) {
      const ot = st.index(st.orderTarget[i] as EntityId);
      if (ot >= 0 && (st.flags[ot] & EntityFlag.PendingDestroy) === 0) {
        // A forced attack ignores alliance, visibility and priority. It does
        // NOT ignore the leash: an order to attack something 400 m away still
        // has to wait for the movement layer to close the distance — which is
        // what `approach` below asks for. It DOES ignore the stance leash: the
        // player said go, and `STANCE_CHASE_METRES` is about what a unit does
        // when nobody said anything.
        st.targetId[i] = st.handleOf(ot) as number;
        this.approach(i, ot, w);
        this.stats.engaged++;
        return;
      }
      // ForceAttack on a dead thing falls through to normal acquisition,
      // which is what makes "attack that tank" keep meaning something once
      // the tank is gone. The unit stops where it stands rather than driving
      // on to the corpse — or, for a force-fire into shroud that never had a
      // target handle at all, rather than driving onto the impact point.
      this.halt(i);
    }

    // How far this unit is willing to care about a target at all. For anything
    // that cannot chase this is the old `w.range * mul` and nothing has moved.
    const reach = this.reachOf(i, w);

    // --- validate ---------------------------------------------------------
    const hadTarget = st.targetId[i] !== 0;
    const cur = st.index(st.targetId[i] as EntityId);
    const keep = Math.max(reach, w.range * COMBAT_TARGETING.leashRangeMul);
    const stillGood = cur >= 0 && this.isValidTarget(i, cur, w, keep);
    if (!stillGood && hadTarget) st.targetId[i] = 0;

    // --- acquire ----------------------------------------------------------
    // Slice ticks do the routine sweep. A unit that JUST lost its lock — the
    // target died, cloaked, or drove out of the leash — scans immediately
    // instead of waiting for its slot to come round, because standing idle
    // for a quarter second after a kill is the most visible AI failure an RTS
    // has. That burst is bounded by the number of targets lost this tick.
    // Aircraft cross their whole weapon envelope in less than one ordinary
    // targeting slice. Let an idle flyer with no valid lock scan immediately;
    // otherwise it can pass a target between slices and appear never to
    // auto-attack despite being on Aggressive stance.
    const sliceTick = sliceForEntity(s.tick, i, TARGETING_SLICE)
      || (isAirborne(st, i) && !stillGood);
    if (stillGood && !sliceTick) { this.stats.engaged++; return; }
    if (!stillGood && !sliceTick && !hadTarget) return;
    if (!stanceAllowsAcquire(st.stance[i] as Stance) && !stillGood) return;

    const before = st.targetId[i];
    this.acquire(s, i, w, cur, Math.max(reach, w.range * COMBAT_TARGETING.acquireRangeMul));
    if (st.targetId[i] !== 0) {
      this.stats.engaged++;
      if (st.targetId[i] !== before) this.stats.acquired++;
    }
  }

  /* ======================================================================
   * §APPROACH — CLOSING ON AN ORDERED TARGET
   * ====================================================================== */

  /**
   * Whether entity `i` is a thing this module could drive at all: a mobile
   * ground unit that is not riding inside something else. Says nothing about
   * whether it currently WANTS driving — that is the state test in the two
   * callers below.
   */
  private canDrive(i: number): boolean {
    const st = this.world.store;
    const f = st.flags[i];
    if ((f & EntityFlag.CanMove) === 0) return false;
    if ((f & EntityFlag.Garrisoned) !== 0) return false;
    const kind = st.kind[i];
    return kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
  }

  /**
   * Whether this module is allowed to own `orderX/orderZ` for entity `i`.
   *
   * THE STATE TEST IS THE LOAD-BEARING PART, not a formality. `orderKind`
   * outlives the state it created — a unit can be carrying `OrderKind.Attack`
   * while the AI, a harvester FSM or a transport has since put it into some
   * other state that uses `orderX/orderZ` as ITS goal. Writing over that would
   * send a harvester to a battle. Only the two states this module itself
   * produces or consumes are ours:
   *
   *   `Attacking` — what an explicit Attack/ForceAttack order creates;
   *   `Guarding`  — what `OrderKind.Guard` creates, and what a stance excursion
   *                 puts a unit into for the duration of the round trip.
   *
   * Every other state, including `Moving`, belongs to somebody else, which is
   * exactly why a player order issued mid-chase cannot be overwritten: Command
   * runs at phase 100 and this runs at 900, so the new state is already in
   * place when this test is made.
   */
  private managesGoal(i: number): boolean {
    const st = this.world.store;
    const s = st.state[i];
    if (s !== UnitState.Attacking && s !== UnitState.Guarding) return false;
    return this.canDrive(i);
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

  /* ======================================================================
   * §LEASH — THE POST, THE CHASE AND THE WAY HOME
   *
   * Read the block comment near the top of the file first. Everything below
   * runs for armed mobile ground units only, costs no query, and allocates
   * nothing.
   * ====================================================================== */

  /**
   * How far, in metres of SURFACE distance, this unit is willing to hold or
   * take a target of opportunity.
   *
   * For anything that cannot chase — a defence structure, a Defensive tank, a
   * unit already carrying out an order — this returns 0 and both callers fall
   * back to the multipliers they always used, so nothing about a firefight
   * changes. For a chasing stance it is the far edge of the envelope
   * `approach()` will actually stop in: `range * APPROACH_STOP_FRAC + chase`.
   *
   * WHY IT HAS TO WIDEN ACQUISITION AND NOT JUST RETENTION. The old acquire
   * radius is `range * 1.08`, so an enemy 34 m from a 24 m gun was never
   * NOTICED, let alone chased — which is why the original measurement showed a
   * unit that neither moved nor held a target. A stance that can only chase
   * things already inside its own gun range is not a chase.
   *
   * The cost is one wider circle query, on the 1-in-`TARGETING_SLICE` tick that
   * unit scans, for chasing stances only.
   */
  private reachOf(i: number, w: WeaponDef): number {
    if (w.range <= 0) return 0;
    const st = this.world.store;
    const s = st.state[i];
    if (s !== UnitState.Idle && s !== UnitState.Guarding) return 0;
    const chase = STANCE_CHASE_METRES[st.stance[i]] ?? 0;
    if (chase <= 0) return 0;
    if (!this.canDrive(i)) return 0;
    const stanceReach = w.range * APPROACH_STOP_FRAC + chase;
    // An aircraft's authored sight is its patrol-awareness envelope. Ground
    // units keep the deliberately tight stance leash; fast flyers need enough
    // warning distance to turn and make a pass before crossing the target.
    return isAirborne(st, i) ? Math.max(stanceReach, st.sight[i]) : stanceReach;
  }

  /**
   * Freeze the nav goal on the unit's own position — unconditionally, unlike
   * `park`, which fires once per entry into its own state machine.
   *
   * Only writes when the goal is far enough away that the nav layer would
   * actually try to drive there. Below the arrival radius `NavAssigner` already
   * considers the order satisfied, and rewriting the goal every tick would
   * re-arm the progress and wedge watchdogs every tick — the failure
   * `APPROACH_GOAL_REFRESH_METRES` exists to prevent, arrived at from the other
   * direction.
   */
  private pinInPlace(i: number): void {
    const st = this.world.store;
    const dx = st.orderX[i] - st.posX[i], dz = st.orderZ[i] - st.posZ[i];
    const slack = st.radius[i] + NAV_ARRIVE_SLACK;
    if (dx * dx + dz * dz <= slack * slack) return;
    st.orderX[i] = st.posX[i];
    st.orderZ[i] = st.posZ[i];
    this.approaching.setAt(i, APPROACH_PARKED);
  }

  /**
   * The excursion is over: stand down.
   *
   * An excursion this module started now ends and the unit goes back to being
   * plainly idle. `Regen` and the AI's idle-army sweep both already treat
   * `Guarding` as resting, but leaving every unit that ever fired a shot
   * permanently in it would quietly rewrite state the rest of the codebase
   * reads with `=== UnitState.Idle`.
   *
   * TWO THINGS ARE DELIBERATELY LEFT ALONE. A unit under an explicit
   * `OrderKind.Guard` stays `Guarding`, because that is exactly what the order
   * means. And a unit that never left — `POST_HOLDING` — is not this module's
   * to demote: three scenarios spawn units straight into `Guarding` as their
   * authored pose, and tick one is not the place to overwrite it.
   *
   * Anything still `Guarding` afterwards has its goal pinned where it stands,
   * because `Guarding` seeks a goal and a stale one would drive it.
   */
  private settle(i: number, state: number, phase: number): void {
    const st = this.world.store;
    if (phase !== POST_HOLDING) {
      this.excursion.setAt(i, POST_HOLDING);
      if (state === UnitState.Guarding && st.orderKind[i] !== OrderKind.Guard) {
        st.state[i] = UnitState.Idle;
        return;
      }
    }
    if (state === UnitState.Guarding) this.pinInPlace(i);
  }

  /**
   * The whole stance behaviour, for one unit, for one tick.
   *
   * Runs after `resolveTarget`, so `targetId` is whatever this unit settled on.
   * Four outcomes, and which one you get is the difference between the four
   * stances:
   *
   *   ENGAGE  — a chasing stance with a target inside its post's envelope.
   *             `approach()` drives it out and stops it at a firing position.
   *   RETURN  — nothing to fight and further from the post than
   *             `STANCE_RETURN_SLACK`. The goal is `guardX/guardZ`.
   *   ARRIVE  — back inside the arrival radius. Drop to `Idle`, unless an
   *             explicit `OrderKind.Guard` is pinning this post.
   *   HOLD    — stand exactly still. HoldGround always lands here.
   */
  private holdPost(i: number, w: WeaponDef): void {
    const st = this.world.store;
    const state = st.state[i];

    // A unit carrying out any other order is not on an excursion and must not
    // be given one. This is the line that makes a player's right-click win:
    // Command wrote `Moving` at phase 100, and it is phase 900 now.
    if ((state !== UnitState.Idle && state !== UnitState.Guarding) || !this.canDrive(i)) {
      if (this.excursion.getAt(i) !== POST_HOLDING) this.excursion.setAt(i, POST_HOLDING);
      return;
    }

    const stance = st.stance[i] as Stance;
    const chase = STANCE_CHASE_METRES[stance] ?? 0;
    const gx = st.guardX[i], gz = st.guardZ[i];

    // -- 1. is there something worth leaving the post for? ------------------
    // Measured POST-to-TARGET. See §LEASH: measuring the unit's own excursion
    // instead makes the decision oscillate on its own boundary.
    if (chase > 0 && st.targetId[i] !== 0) {
      const t = st.index(st.targetId[i] as EntityId);
      if (t >= 0) {
        const cap = chase + w.range * APPROACH_STOP_FRAC;
        const tx = st.posX[t] - gx, tz = st.posZ[t] - gz;
        if (tx * tx + tz * tz <= cap * cap) {
          if (state !== UnitState.Guarding) st.state[i] = UnitState.Guarding;
          this.excursion.setAt(i, POST_ENGAGED);
          this.stats.chasing++;
          this.approach(i, t, w);
          return;
        }
      }
    }

    // -- 2. nothing to fight: where should this unit be standing? -----------
    const dx = st.posX[i] - gx, dz = st.posZ[i] - gz;
    const off2 = dx * dx + dz * dz;
    const arrive = st.radius[i] + NAV_ARRIVE_SLACK;
    const phase = this.excursion.getAt(i);

    if (off2 <= arrive * arrive) {
      this.settle(i, state, phase);
      return;
    }

    // Hysteresis: it takes `STANCE_RETURN_SLACK` to START walking back and the
    // arrival radius to STOP, so a firing line shoved a metre by its own
    // separation forces does not spend the rest of the match correcting itself.
    const returning = phase === POST_RETURNING;
    if (STANCE_RETURNS[stance] !== true
        || (!returning && off2 <= STANCE_RETURN_SLACK * STANCE_RETURN_SLACK)) {
      // Close enough to call it home even though the arrival test said no, or
      // a stance that would not walk back in any case. HoldGround lands here
      // every time, and it is the reason `settle` pins the goal rather than
      // merely skipping: `Guarding` is a seeking state, so a stale
      // `orderX/orderZ` would have the nav layer drive the one stance whose
      // whole contract is that it never moves.
      this.settle(i, state, phase);
      return;
    }

    // -- 3. walk back. NOT A COMMAND, NOT AN ORDER -------------------------
    // `guardX/guardZ` into `orderX/orderZ`, and `orderKind`/`orderTarget` left
    // exactly as they were. That is the whole answer to "there is no order
    // stack": the return goal was never in the order columns to begin with.
    if (state !== UnitState.Guarding) st.state[i] = UnitState.Guarding;
    if (phase !== POST_RETURNING) this.excursion.setAt(i, POST_RETURNING);
    this.stats.returning++;
    this.approaching.setAt(i, APPROACH_UNDECIDED);
    const ox = st.orderX[i] - gx, oz = st.orderZ[i] - gz;
    if (ox * ox + oz * oz > NAV_FORMATION_GOAL_EPS * NAV_FORMATION_GOAL_EPS) {
      st.orderX[i] = gx;
      st.orderZ[i] = gz;
    }
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

  /**
   * Everything that must remain true for `t` to stay this entity's target.
   *
   * `maxSurface` is ABSOLUTE METRES, not a multiplier. It used to be a
   * multiplier on `w.range`, which is fine while every reason to care about a
   * target is proportional to how far you can shoot; it stopped being fine when
   * a chasing stance grew a reason that is not (`STANCE_CHASE_METRES`, a flat
   * distance from the post). Callers do the arithmetic and pass the answer.
   */
  private isValidTarget(i: number, t: number, w: WeaponDef, maxSurface: number): boolean {
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
    if (surface > maxSurface) return false;
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
  private acquire(
    s: SimContext, i: number, w: WeaponDef, currentIdx: number, maxSurface: number,
  ): void {
    const world = this.world;
    const st = world.store;
    this.stats.scans++;

    const radius = maxSurface
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
      if (!this.isValidTarget(i, t, w, maxSurface)) continue;

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

      // Shooting an Anvil with a rifle is legal and almost always wrong.
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

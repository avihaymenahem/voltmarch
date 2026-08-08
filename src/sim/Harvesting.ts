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
 *              harvester that nav has BOTH released (`navField < 0`) AND
 *              stopped asking to move (`velX == velZ == 0`, which Steering
 *              writes explicitly for anything it considers parked or arrived).
 *              That combination means one specific thing: nav gave up on this
 *              unit. Its stuck detector nudged it three times, decided it was
 *              not getting there, and set AgentFlag.Arrived — which is sticky
 *              until the goal moves. A harvester in that state is stopped
 *              forever, mid-haul, with a full hopper.
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
 * ============================================================================
 */

import {
  CELL, HARVEST_ARRIVE_RADIUS, HARVEST_FX_INTERVAL, HARVEST_RATE,
  HARVESTER_DOCK_RADIUS, HARVESTER_DOCK_CLEARANCE, HARVESTER_QUEUE_GAP,
  HARVESTER_STUCK_SECONDS, MAP_CELLS, MAX_PLAYERS, ORE_MIN_CLAIM,
  ORE_SCORING_INTERVAL, ORE_SEARCH_CELLS, ORE_VALUE, SIM_DT,
  UNDER_ATTACK_COOLDOWN, UNLOAD_SECONDS,
} from '../core/config';
import {
  CreditReason, EntityFlag, EntityKind, EvaLine, FxKind, NONE, OrderKind, UnitState,
} from '../core/types';
import type { EntityId, Faction, Locomotor, PlayerId, SimContext } from '../core/types';
import { PerEntityF32, PerEntityI16, PerEntityU32, type World } from '../core/world';
import type { Channels } from '../core/events';
import {
  angleDelta, clampCell, clampWorld, dist2, moveToward, turnToward, worldToCell,
} from '../core/math';
import type { Economy, OreField } from './Economy';

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

  /** Per-REFINERY: the harvester currently holding its dock, or 0. */
  private readonly dockHolder: PerEntityU32;

  private readonly lastUnderAttackEva = new Float64Array(MAX_PLAYERS);

  private readonly statsOut: HarvesterStats = {
    harvesters: 0, seeking: 0, harvesting: 0, returning: 0, docked: 0, idle: 0,
    cargo: 0, cargoCapacity: 0, delivered: 0, driven: 0,
  };
  private deliveredTotal = 0;
  private drivenThisTick = 0;

  private readonly cellOut = new Int32Array(2);
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
    this.nextScore = new PerEntityF32(store, 0);
    this.bestGap = new PerEntityF32(store, 1e9);
    this.stuckFor = new PerEntityF32(store, 0);
    this.driveSpeed = new PerEntityF32(store, 0);
    this.dockHolder = new PerEntityU32(store, 0);
    this.lastUnderAttackEva.fill(-1e9);

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
    st.cargo = 0; st.cargoCapacity = 0;

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

    if (time >= this.nextScore.getAt(i)) {
      this.nextScore.setAt(i, time + SCORE_PERIOD);
      this.rescoreOre(i, id, time, d);
    }
    if (this.trackProgress(i, d, dt)) {
      // Cannot reach that cell. Give the claim back and pause; the next plan
      // will most likely pick a different approach or a different patch.
      this.dropClaim(i, id);
      this.enterIdle(i, id, time, DRY_RETRY);
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
    if (!this.ore.findFreeOre(cx, cz, ORE_SEARCH_CELLS, id, ORE_MIN_CLAIM, time, this.cellOut)) return;

    const nx = (this.cellOut[0] + 0.5) * CELL;
    const nz = (this.cellOut[1] + 0.5) * CELL;
    const nd = dist2(store.posX[i], store.posZ[i], nx, nz);
    if (nd >= currentDist * 0.75) return;
    if (!this.ore.claim(this.cellOut[0], this.cellOut[1], id, time)) return;

    this.dropClaim(i, id);
    this.claimIdx.setAt(i, this.cellOut[1] * MAP_CELLS + this.cellOut[0]);
    this.setDest(i, nx, nz);
    this.resetProgress(i);
  }

  /**
   * Find, lease and target the nearest unclaimed ore cell. Falls back to
   * scraps (any non-empty cell) before giving up, so the last few hundred
   * credits on a map do get collected instead of stranding four harvesters.
   */
  private acquireOre(i: number, id: EntityId, time: number): boolean {
    const store = this.world.store;
    const cx = clampCell(worldToCell(store.posX[i]));
    const cz = clampCell(worldToCell(store.posZ[i]));

    let found = this.ore.findFreeOre(cx, cz, ORE_SEARCH_CELLS, id, ORE_MIN_CLAIM, time, this.cellOut);
    if (!found) {
      found = this.ore.findFreeOre(cx, cz, ORE_SEARCH_CELLS, id, 1, time, this.cellOut);
    }
    if (!found) {
      // Nothing within reach of where we stand — aim at the nearest field that
      // still holds anything and search again from there.
      const f = this.ore.nearestField(store.posX[i], store.posZ[i]);
      if (f < 0) return false;
      const rec = this.ore.field(f);
      if (rec === undefined) return false;
      found = this.ore.findFreeOre(
        rec.nodeCx, rec.nodeCz, ORE_SEARCH_CELLS, id, 1, time, this.cellOut,
      );
      if (!found) return false;
    }
    if (!this.ore.claim(this.cellOut[0], this.cellOut[1], id, time)) return false;

    this.dropClaim(i, id);
    this.claimIdx.setAt(i, this.cellOut[1] * MAP_CELLS + this.cellOut[0]);
    this.setDest(i, (this.cellOut[0] + 0.5) * CELL, (this.cellOut[1] + 0.5) * CELL);
    store.state[i] = UnitState.SeekOre;
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

  private beginReturn(i: number, id: EntityId, time: number): void {
    const store = this.world.store;
    this.dropClaim(i, id);
    const ri = this.pickRefinery(i);
    if (ri < 0) {
      store.dockTarget[i] = NONE as number;
      this.enterIdle(i, id, time, DRY_RETRY);
      return;
    }
    store.dockTarget[i] = store.handleOf(ri) as number;
    store.state[i] = UnitState.ReturnToRefinery;
    this.nextScore.setAt(i, time + SCORE_PERIOD);
    this.resetProgress(i);
  }

  private tickReturn(i: number, id: EntityId, dt: number, time: number): void {
    const store = this.world.store;
    let ri = store.index(store.dockTarget[i] as EntityId);
    if (ri < 0 || !this.isUsableRefinery(ri, store.owner[i])) {
      ri = this.pickRefinery(i);
      if (ri < 0) {
        store.dockTarget[i] = NONE as number;
        this.enterIdle(i, id, time, DRY_RETRY);
        return;
      }
      store.dockTarget[i] = store.handleOf(ri) as number;
      this.resetProgress(i);
    }

    const refId = store.handleOf(ri);
    const mine = this.tryHoldDock(refId, id);

    // The dock apron sits in front of the refinery; the queue slot sits one
    // harvester length further out along the same axis, so a waiting hauler
    // reads as "next in line" rather than "parked in a field".
    const yaw = store.yaw[ri];
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);

    /*
     * THE APRON HAS TO CLEAR THE FOOTPRINT, AND IT DID NOT.
     *
     * Reported as "the collector is stuck within its own building", with a
     * screenshot of a Sun Collector sunk into the side of its refinery. That is
     * not a steering failure — it was where the harvester was TOLD to park.
     *
     * The old line was `halfDepth + HARVESTER_DOCK_CLEARANCE`, a constant of 3.4
     * whose own comment in config.ts called it "half a harvester length plus a
     * little". Half a harvester is 8.60 / 2 = 4.30 m. The constant was 3.4 —
     * 0.9 m SHORT of the half it claimed to be, before the "plus a little".
     *
     * For a refinery (2 cells deep, so halfDepth 4.0) and a Collector (radius
     * 3.87):
     *
     *     reach     = 4.0 + 3.4  = 7.40 m from the refinery's centre
     *     rear edge = 7.40 - 3.87 = 3.53 m
     *     footprint edge          = 4.00 m
     *
     * The hull's back end was parked 0.47 m INSIDE the structure by
     * construction, on a footprint the nav grid marks impassable. Every
     * harvester in the game has done this since the system was written.
     *
     * Two changes. First, derive the standoff from the hull that is actually
     * docking — `store.radius[i]` — instead of a constant that assumes one
     * harvester size. That is what makes it correct for the Reclamation's
     * hauler, the Pact's Collector and whatever is authored next, rather than
     * correct for none of them.
     *
     * Second, take the half-extent along the FACING axis rather than always
     * `footprintH`. Footprints are stored world-axis-aligned — `touching()`
     * below compares world-space deltas against halfW and halfH with no
     * rotation — so a refinery placed facing along X presented its WIDTH to the
     * apron while this computed its depth. A rotated refinery was worse than an
     * unrotated one, which is exactly the kind of asymmetry nobody reports as a
     * bug because it just looks like bad luck.
     */
    const reach = dockApronDistance(
      Math.max(1, store.footprintW[ri]) * CELL * 0.5,
      Math.max(1, store.footprintH[ri]) * CELL * 0.5,
      fwdX, fwdZ, store.radius[i],
    );
    const out = mine ? reach : reach + HARVESTER_QUEUE_GAP;
    const tx = store.posX[ri] + fwdX * out;
    const tz = store.posZ[ri] + fwdZ * out;
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
      this.resetProgress(i);
      return;
    }

    // Only the harvester actually holding the dock can be "stuck": one that is
    // queued is supposed to be sitting still.
    if (mine && this.trackProgress(i, d, dt)) {
      store.dockTarget[i] = NONE as number;
      this.releaseDock(refId, id);
      this.resetProgress(i);
    }
  }

  private tickDock(i: number, id: EntityId, dt: number, time: number): void {
    const store = this.world.store;
    const refId = store.dockTarget[i] as EntityId;
    const ri = store.index(refId);
    if (ri < 0 || !this.isUsableRefinery(ri, store.owner[i])) {
      // The refinery died under us mid-unload. Keep whatever is left in the
      // hopper and find another one.
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
      const credits = moved * ORE_VALUE;
      this.economy.deposit(store.owner[i] as PlayerId, credits, CreditReason.Harvest);
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
  private pickRefinery(i: number): number {
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

    for (let k = 0; k < count; k++) {
      const ri = list[k];
      if (!this.isUsableRefinery(ri, owner)) continue;
      const dx = store.posX[ri] - px;
      const dz = store.posZ[ri] - pz;
      const d = dx * dx + dz * dz;

      // Prefer a refinery whose dock is free even if it is a little further:
      // queueing behind a full hauler costs more than the extra drive.
      const holder = this.dockHolder.get(store.handleOf(ri));
      const free = holder === 0 || holder === (id as number) || !this.holderStillDocking(holder, ri);
      if (best < 0 || (free && !bestFree) || (free === bestFree && d < bestD)) {
        best = ri;
        bestD = d;
        bestFree = free;
      }
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

  private isUsableRefinery(ri: number, owner: number): boolean {
    const store = this.world.store;
    const f = store.flags[ri];
    if ((f & EntityFlag.IsRefinery) === 0) return false;
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) return false;
    if (store.buildProgress[ri] < 1) return false;
    return this.world.areAllied(owner as PlayerId, store.owner[ri] as PlayerId);
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
    this.destX.setAt(i, store.posX[i]);
    this.destZ.setAt(i, store.posZ[i]);
    this.nextScore.setAt(i, time + retryIn);
    this.resetProgress(i);
  }

  private resetProgress(i: number): void {
    this.bestGap.setAt(i, 1e9);
    this.stuckFor.setAt(i, 0);
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
      if (hauling) {
        const wedged = this.wedgedIn(i);
        if (wedged >= 0) {
          this.drivenThisTick++;
          this.driveEscape(i, dt, wedged, assist);
          continue;
        }
      }

      // The real pathfinder holds a field for this unit, so it is actively
      // being driven. Hands off — only one module integrates a position.
      if (store.navField[i] >= 0) continue;

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

/**
 * ============================================================================
 * VOLTMARCH — src/sim/Relocate.ts
 * ============================================================================
 * "MOVE IT OVER THERE." Pick up a structure that is already standing, pay a
 * fee, and put it down somewhere else.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is not a placement system. `Placement.ts` §1 is the ONE rule about where a
 * structure may stand and `Placement.ts` §3 is the ONE ghost that shows the
 * player the answer; a relocation asks that rule about an existing building and
 * drives that ghost with it. The only thing added to the rule is
 * `PlacementExempt` — a structure's own footprint is legal ground for it, which
 * is what makes nudging a War Factory two cells left possible at all.
 *
 * It is not a second deploy, either. `Deploy.ts` already turns a vehicle into a
 * structure and back; a Construction Yard MOVES by packing into an MCV, driving
 * and unpacking, and that mechanic is better than anything this file could add.
 * So this file refuses every structure Deploy can pack (§2,
 * `RelocateFault.PacksIntoVehicle`) and points the player at the vehicle
 * instead of duplicating it.
 *
 * THE SHAPE OF THE MECHANIC
 * -------------------------
 *   1. The player selects one of their own finished structures. The HUD asks
 *      `subjectFault` whether it may be moved and prints the price on a button.
 *   2. Clicking it calls `PlacementController.beginRelocate`. The structure is
 *      still standing, still shooting, still producing — the ghost is the only
 *      state that exists, so cancelling costs nothing and CAN cost nothing.
 *   3. The commit click routes here. Everything is re-checked, the fee is
 *      charged EXACTLY ONCE, and the structure is uprooted the same tick.
 *   4. It spends `RELOCATE.transitSeconds` in transit — nowhere at all: no
 *      power, no production, no prerequisite, no vision, no target.
 *   5. It re-founds itself at the new site at 0% and rises like any other
 *      building, arriving with the damage, veterancy, rally point and primary
 *      flag it left with.
 *
 * WHY IT COSTS TIME AND NOT JUST CREDITS
 * --------------------------------------
 * A relocation that is instant makes base layout free: every mistake is undone
 * for pocket change and a defensive line becomes a thing you slide around under
 * fire. The transit is what turns it into a decision. Moving a Power Plant
 * browns out the base for the duration. Moving the only Barracks locks infantry
 * behind its own prerequisite until it lands. Moving a Tesla Coil out of a
 * push means the push arrives before the coil does. None of that needed special
 * code: `Power.ts` recomputes the grid from live, finished structures every
 * tick and `Production.ts` counts prerequisites the same way, so a structure
 * that is nowhere is correctly worth nothing.
 *
 * DAMAGE TRAVELS WITH IT
 * ----------------------
 * A rebuilt structure would arrive at full health, and at 35% of build cost
 * that would be the cheapest repair in the game by a wide margin — cheaper than
 * `REPAIR_COST_PER_HP` on anything above about a third damage. So the fraction
 * is captured at pickup and re-applied while the new structure rises. You move
 * a wreck, you get a wreck.
 *
 * DETERMINISM
 * -----------
 * No wall clock, no RNG. Transit is counted in TICKS, and every decision in
 * this file is a pure function of the world plus the request queue.
 * ============================================================================
 */

import { CELL, SIM_DT } from '../core/config';
import {
  CreditReason, EntityFlag, EntityKind, EvaLine, FxKind, NONE, UnitState,
} from '../core/types';
import type { EntityId, PlayerId, PlayerState, SimContext } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { footprintOriginCell, isInMap } from '../core/math';

import {
  PlacementPhase, evaluatePlacement, facedFootprintH, facedFootprintW, facingYaw,
  makePlacementReport, yawToFacing,
  type PlacementExempt, type PlacementReport, type RelocateSeam,
} from './Placement';
import { production, type BuildEntry, type ProductionService } from './Production';
import { contentKeyOf, isUndeployable } from './Deploy';
import { SUPERWEAPONS } from './Superweapons';
import { superweapons } from './Superweapons';
import { garrisonService } from './Garrison';
import { getEconomy } from './Economy';
import { repairSellService } from './RepairSell';

/* ==========================================================================
 * 1. THE PRICE
 *
 * Local to the module, for the reason `Deploy.ts` §1 gives: these four numbers
 * are the FEEL of one mechanic owned by one file, and `core/config.ts` is the
 * art-direction surface a visual critic edits. `src/data/Defs.ts` re-exports
 * this object so the content layer names the price too — the edge runs
 * data -> sim, which is the direction that file already uses and the only one
 * that cannot cycle.
 * ========================================================================== */

export const RELOCATE = {
  /**
   * Fee as a fraction of the structure's build cost.
   *
   * 0.35 is chosen against the two alternatives the player already has.
   * Selling and rebuilding costs `1 - SELL_REFUND` = 0.5 of build cost PLUS the
   * full build time PLUS a queue slot, so relocation has to be cheaper than
   * that or nobody would ever press it. Doing nothing costs zero, so it has to
   * be dear enough that a badly laid-out base is still a mistake you paid for.
   * 0.35 sits between them: a 2000-credit War Factory costs 700 to move.
   */
  costFraction: 0.35,
  /**
   * Floor, so moving a 100-credit wall is not free. Deliberately equal to the
   * sell refund on the cheapest structure in the game: at that end of the
   * price list, moving and re-buying cost the same, and the player picks on
   * convenience rather than on arithmetic.
   */
  minCost: 50,
  /**
   * Seconds the structure spends packed and off the map, before the ordinary
   * `CONSTRUCTION_RISE_SECONDS` rise begins at the far end.
   *
   * Long enough to be a window an opponent can push into, short enough that
   * fixing a base layout is not a chore. Total downtime is this plus the rise.
   */
  transitSeconds: 4.0,
  /**
   * Ticks the arrival will keep retrying a destination that turned out to be
   * blocked before giving up on it and going home. Two seconds: long enough for
   * a tank that wandered onto the site to drive off.
   */
  arrivalGraceTicks: 60,
} as const;

/** Transit in ticks, derived once. Counting ticks is what makes it exact. */
export const TRANSIT_TICKS = Math.max(1, Math.round(RELOCATE.transitSeconds / SIM_DT));

/** One dust puff every this many ticks while a relocated structure is missing. */
const DUST_INTERVAL_TICKS = 10;

/** The fee for a structure worth `cost` credits. Integer, never below the floor. */
export function relocationFee(cost: number): number {
  return Math.max(RELOCATE.minCost, Math.round(Math.max(0, cost) * RELOCATE.costFraction));
}

/* ==========================================================================
 * 2. THE RULE — may this structure be moved, and may it go there?
 * ========================================================================== */

/** Why a relocation was refused. Ordered by how much the player cares. */
export const enum RelocateFault {
  None = 0,
  /** Not a structure, or not this player's. */
  NotYours = 1,
  /** Still rising, or already on its way somewhere. */
  Busy = 2,
  /**
   * It folds into a vehicle. `Deploy.ts` already moves these, properly, and a
   * Construction Yard that teleported would strand every structure whose build
   * radius it is providing halfway through the move.
   */
  PacksIntoVehicle = 3,
  /** Somebody is inside it. */
  Garrisoned = 4,
  /** It is charging a superweapon. */
  SuperweaponCharging = 5,
  /** The catalog has no price for it, so there is nothing to charge. */
  NoPrice = 6,
  /** Cannot afford the fee. */
  CannotAfford = 7,
  /** The destination said no. `reason` carries the placement rule's sentence. */
  Destination = 8,
  /** The entity store is full. */
  WorldFull = 9,
}

const FAULT_TEXT: readonly string[] = [
  '',
  'Select one of your own structures',
  'Wait until it is finished',
  'Pack it into its vehicle and drive it',
  'Evacuate the garrison first',
  'Not while the superweapon is charging',
  'This structure cannot be relocated',
  'Insufficient funds',
  'Cannot relocate here',
  'Too many entities',
];

/** The answer, filled in place. Never retained. */
export interface RelocateReport {
  ok: boolean;
  fault: RelocateFault;
  reason: string;
  /** Fee in credits. Valid whenever `entry` is non-null. */
  cost: number;
  /** Minimum-corner cell the structure would be re-founded on. */
  cx: number;
  cz: number;
  /** Quarter turns it would be re-founded at. */
  facing: number;
  /** The catalog entry behind the structure, or null. */
  entry: BuildEntry | null;
}

export function makeRelocateReport(): RelocateReport {
  return {
    ok: false, fault: RelocateFault.None, reason: '',
    cost: 0, cx: 0, cz: 0, facing: 0, entry: null,
  };
}

/** Blank an existing report in place. Returns it, so it composes with `fail`. */
function makeRelocateReportInto(out: RelocateReport): RelocateReport {
  out.ok = false;
  out.fault = RelocateFault.None;
  out.reason = '';
  out.cost = 0;
  out.cx = 0;
  out.cz = 0;
  out.facing = 0;
  out.entry = null;
  return out;
}

function fail(out: RelocateReport, fault: RelocateFault, reason = ''): RelocateReport {
  out.ok = false;
  out.fault = fault;
  out.reason = reason === '' ? FAULT_TEXT[fault] : reason;
  return out;
}

/** Module scratch, so the query path never allocates. */
const originCell = new Int32Array(2);
const exemptRect: PlacementExempt = { cx: 0, cz: 0, w: 0, h: 0 };
const scratchPlacement: PlacementReport = makePlacementReport();

/**
 * The superweapon a structure key is the dedicated host for, or -1.
 *
 * Only `structureKeys[0]` counts. Every superweapon lists `battleLab` as its
 * fallback host, and refusing to move a Proving Ground because SOMETHING somewhere
 * might be charging off it would forbid relocating the most commonly misplaced
 * structure in the game for a reason the player cannot see.
 */
function superweaponHostedBy(key: string): number {
  if (key === '') return -1;
  for (let s = 0; s < SUPERWEAPONS.length; s++) {
    if (SUPERWEAPONS[s].structureKeys[0] === key) return s;
  }
  return -1;
}

/**
 * Everything that depends only on the STRUCTURE, not on where it is going.
 *
 * The HUD calls this every frame for the selected building — it is what decides
 * whether the Relocate button is offered, whether it is greyed, what sentence
 * the player reads and what number is printed on it. The sim calls the same
 * function again at commit, so the button and the answer cannot disagree.
 *
 * Allocation-free. Fills and returns `out`.
 */
export function subjectFault(
  world: World,
  service: ProductionService,
  player: PlayerId,
  building: EntityId,
  out: RelocateReport,
): RelocateReport {
  out.ok = false;
  out.fault = RelocateFault.None;
  out.reason = '';
  out.cost = 0;
  out.cx = 0;
  out.cz = 0;
  out.facing = 0;
  out.entry = null;

  const st = world.store;
  const i = st.index(building);
  if (i < 0) return fail(out, RelocateFault.NotYours);
  if (st.kind[i] !== EntityKind.Building) return fail(out, RelocateFault.NotYours);
  if (st.owner[i] !== (player as number)) return fail(out, RelocateFault.NotYours);

  const flags = st.flags[i];
  if ((flags & EntityFlag.Alive) === 0) return fail(out, RelocateFault.NotYours);
  if ((flags & EntityFlag.PendingDestroy) !== 0) return fail(out, RelocateFault.NotYours);
  if ((flags & EntityFlag.UnderConstruction) !== 0 || st.buildProgress[i] < 1) {
    return fail(out, RelocateFault.Busy);
  }
  // Mid-deploy, mid-sale, or already uprooted by an earlier request this tick.
  const state = st.state[i];
  if (state === UnitState.Deploying || state === UnitState.Selling) {
    return fail(out, RelocateFault.Busy);
  }

  const key = contentKeyOf(world, i);

  // It has a vehicle form. `Deploy.ts` is how it travels, and that route keeps
  // the build radius honest: the yard leaves, the radius leaves with it, and
  // the player can SEE the MCV crossing the map. A Construction Yard that
  // blinked would strand every structure it was providing adjacency for.
  if (isUndeployable(world, i)) return fail(out, RelocateFault.PacksIntoVehicle);

  // Someone is inside. Moving the building would either delete them or eject
  // them somewhere they did not choose; both are worse than saying no.
  const garrison = garrisonService();
  if (garrison !== null && garrison.occupantCount(building) > 0) {
    return fail(out, RelocateFault.Garrisoned);
  }

  // A charge that is part-way through is the single most valuable piece of
  // state a structure can hold, and it is the one thing a player would move a
  // building to protect. `Superweapons.ts` pauses a charge when the host is
  // lost rather than resetting it, so allowing this would be a free
  // dodge-the-counterattack button. A FINISHED charge may move: it is banked.
  const sw = superweaponHostedBy(key);
  if (sw >= 0) {
    const service2 = superweapons();
    if (service2 !== null) {
      const left = service2.remainingFor(player, SUPERWEAPONS[sw].key);
      if (left > 0) return fail(out, RelocateFault.SuperweaponCharging);
    }
  }

  const entry = service.entryOf(building);
  if (entry === null || entry.footprintW <= 0 || entry.footprintH <= 0) {
    return fail(out, RelocateFault.NoPrice);
  }
  out.entry = entry;
  out.cost = relocationFee(entry.cost);

  const p = world.players[player as number];
  if (p === undefined || p.credits < out.cost) return fail(out, RelocateFault.CannotAfford);

  out.ok = true;
  out.reason = '';
  return out;
}

/**
 * The whole question: may `player` move `building` so its minimum corner lands
 * on (cx, cz)?
 *
 * Subject checks first (so the player hears the interesting reason rather than
 * "cannot relocate here"), then the shared placement rule with the structure's
 * own ground exempt and the structure itself masked out of the build-radius
 * scan. That second mask matters: without it every structure would project a
 * build radius around itself and could walk across the map one hop at a time.
 */
export function evaluateRelocate(
  world: World,
  service: ProductionService,
  player: PlayerId,
  building: EntityId,
  cx: number,
  cz: number,
  out: RelocateReport,
  facing?: number,
): RelocateReport {
  subjectFault(world, service, player, building, out);
  // The destination is recorded even on a subject refusal, so the `Rejected`
  // notice the HUD receives points at the cell the player actually clicked
  // rather than at the map origin.
  out.cx = cx;
  out.cz = cz;
  if (!out.ok || out.entry === null) return out;

  const st = world.store;
  const i = st.index(building);
  const entry = out.entry;

  // No facing given means "keep the one it is standing at". That is what every
  // caller written before the ghost could turn meant, and it keeps a plain
  // two-cell nudge from silently re-orienting a War Factory.
  const f = facing === undefined ? yawToFacing(st.yaw[i]) : facing;
  out.facing = f;

  footprintOriginCell(st.posX[i], st.posZ[i], st.footprintW[i], st.footprintH[i], originCell);
  exemptRect.cx = originCell[0];
  exemptRect.cz = originCell[1];
  exemptRect.w = st.footprintW[i];
  exemptRect.h = st.footprintH[i];

  const saved = st.flags[i];
  st.flags[i] = saved | EntityFlag.PendingDestroy;
  let report: PlacementReport;
  try {
    report = evaluatePlacement(world, player, entry, cx, cz, scratchPlacement, exemptRect, f);
  } finally {
    st.flags[i] = saved;
  }

  if (!report.ok) return fail(out, RelocateFault.Destination, report.reason);
  out.ok = true;
  out.reason = '';
  return out;
}

/* ==========================================================================
 * 3. IN TRANSIT
 *
 * One record per structure currently between two places. Fixed capacity and
 * pooled: the tick loop must not allocate.
 * ========================================================================== */

/** How far along a relocation is. */
const enum Leg {
  /** Free. */
  Empty = 0,
  /** Packed, nowhere at all. Counting down to arrival. */
  Transit = 1,
  /** Re-founded and rising. We are only still here to hold its damage down. */
  Rising = 2,
}

interface Transit {
  leg: Leg;
  player: number;
  /** Catalog index of the structure. */
  entryIndex: number;
  /** Destination, and the original site to fall back on. */
  cx: number;
  cz: number;
  homeCx: number;
  homeCz: number;
  /** Quarter turns it will be re-founded at. `yaw` is this, in radians. */
  facing: number;
  /**
   * The facing it was standing at when it was picked up.
   *
   * Separate from `facing` because they differ the moment a player turns a
   * relocation, and going home has to undo BOTH halves of the move: `homeCx/Cz`
   * are the cells the OLD world footprint occupied, and re-founding a turned
   * 3x2 there at the new facing would land a 2x3 on the wrong rectangle.
   */
  homeFacing: number;
  yaw: number;
  /** Health as a fraction of max, carried across the move. */
  hpFrac: number;
  /** Veterancy bits worth carrying (`Veteran1 | Veteran2`). */
  vetFlags: number;
  /** Rally point, when the structure had one. */
  hasRally: boolean;
  rallyX: number;
  rallyZ: number;
  /** True when it was the primary factory for its tabs. */
  primary: boolean;
  /** True when the wrench was armed on it. */
  repairing: boolean;
  /** The fee that was charged, for the one case where it has to come back. */
  fee: number;
  /** Ticks until it re-founds itself. */
  ticksLeft: number;
  /** Ticks spent arguing with a blocked destination. */
  blockedTicks: number;
  /** The structure once it exists again, for the Rising leg. */
  id: EntityId;
}

/** Simultaneous relocations. Generous: the AI never uses this, a player has hands. */
const TRANSIT_CAPACITY = 16;

function makeTransit(): Transit {
  return {
    leg: Leg.Empty, player: 0, entryIndex: -1,
    cx: 0, cz: 0, homeCx: 0, homeCz: 0, facing: 0, homeFacing: 0, yaw: 0,
    hpFrac: 1, vetFlags: 0,
    hasRally: false, rallyX: 0, rallyZ: 0,
    primary: false, repairing: false,
    fee: 0, ticksLeft: 0, blockedTicks: 0, id: NONE,
  };
}

/* ==========================================================================
 * 4. THE SERVICE
 * ========================================================================== */

/** Diagnostics for the F3 overlay and the tests. */
export interface RelocateCounters {
  /** Structures currently in transit or rising. */
  active: number;
  /** Structures that landed on the site the player asked for. */
  moved: number;
  /** Requests refused, for any reason. */
  refused: number;
  /** Moves that came home because the destination was taken while in transit. */
  returned: number;
  /** Credits taken, net of anything handed back. */
  charged: number;
}

export class RelocateService implements RelocateSeam {
  readonly counters: RelocateCounters = {
    active: 0, moved: 0, refused: 0, returned: 0, charged: 0,
  };

  /** Pooled transit records. */
  private readonly transits: Transit[] = [];

  /** Queued requests, drained at the top of `tick`. */
  private readonly queueBuilding = new Int32Array(TRANSIT_CAPACITY);
  private readonly queuePlayer = new Int32Array(TRANSIT_CAPACITY);
  private readonly queueCx = new Int32Array(TRANSIT_CAPACITY);
  private readonly queueCz = new Int32Array(TRANSIT_CAPACITY);
  /** Quarter turns, or -1 for "whatever it is standing at". */
  private readonly queueFacing = new Int32Array(TRANSIT_CAPACITY);
  private queued = 0;

  private readonly report: RelocateReport = makeRelocateReport();
  /** A second report, so a HUD query cannot stamp on an in-flight commit. */
  private readonly uiReport: RelocateReport = makeRelocateReport();

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    for (let i = 0; i < TRANSIT_CAPACITY; i++) this.transits.push(makeTransit());
  }

  /**
   * The live production service, or null.
   *
   * Resolved per call rather than injected, and that is forced rather than
   * chosen: `SystemRegistry.initAll` runs inits in PHASE order, this module is
   * Phase.Command (100) and production is Phase.Production (200), so
   * `production()` is genuinely null while `relocate.system.ts` is initialising.
   * `Deploy.ts` resolves the same way for the same reason.
   */
  private svc(): ProductionService | null {
    return production();
  }

  /* -- the seam Placement.ts calls --------------------------------------- */

  /**
   * Ask for a move. Called from the placement ghost's commit click.
   *
   * Answers immediately with the LOCAL verdict so the ghost knows whether to
   * stay up, but does not touch the world: the request is queued and applied
   * inside `tick`, which is the only place credits may be taken and entities
   * may be created. That is what keeps a replay identical.
   */
  commit(
    player: PlayerId, building: EntityId, cx: number, cz: number, facing?: number,
  ): boolean {
    const service = this.svc();
    if (service === null) return false;
    const report = evaluateRelocate(
      this.world, service, player, building, cx, cz, this.report, facing,
    );
    if (!report.ok) {
      this.refuse(player, report);
      return false;
    }
    // Already asked for, this frame or an earlier one that has not been drained.
    // Two clicks inside one sim tick must buy ONE move, not two.
    for (let q = 0; q < this.queued; q++) {
      if (this.queueBuilding[q] === (building as number)) return false;
    }
    if (this.queued >= TRANSIT_CAPACITY) return false;
    const q = this.queued++;
    this.queueBuilding[q] = building as number;
    this.queuePlayer[q] = player as number;
    this.queueCx[q] = cx;
    this.queueCz[q] = cz;
    // -1, not 0: the request is queued and re-checked a tick later, and "no
    // facing was asked for" has to survive that as "keep the current one".
    this.queueFacing[q] = facing === undefined ? -1 : facing;
    return true;
  }

  /** Bare eligibility, for the ghost's pickup and the HUD's button. */
  eligible(player: PlayerId, building: EntityId): boolean {
    return this.inspect(player, building).ok;
  }

  /**
   * The full subject verdict for the HUD: the price, and the sentence to print
   * when it is refused. The returned report is POOLED — read it, do not keep it.
   */
  inspect(player: PlayerId, building: EntityId): Readonly<RelocateReport> {
    const service = this.svc();
    if (service === null) {
      return fail(makeRelocateReportInto(this.uiReport), RelocateFault.NoPrice);
    }
    return subjectFault(this.world, service, player, building, this.uiReport);
  }

  /** The fee for a structure, or 0 when the catalog has no price for it. */
  costFor(building: EntityId): number {
    const entry = this.svc()?.entryOf(building) ?? null;
    return entry === null ? 0 : relocationFee(entry.cost);
  }

  /** True while this structure is rising at the far end of a move. */
  isMoving(building: EntityId): boolean {
    for (let t = 0; t < TRANSIT_CAPACITY; t++) {
      const rec = this.transits[t];
      if (rec.leg === Leg.Rising && rec.id === building) return true;
    }
    return false;
  }

  /** Structures this player currently has packed and off the map. */
  inTransit(player: PlayerId): number {
    let n = 0;
    for (let t = 0; t < TRANSIT_CAPACITY; t++) {
      const rec = this.transits[t];
      if (rec.leg === Leg.Transit && rec.player === (player as number)) n++;
    }
    return n;
  }

  /* -- the tick ----------------------------------------------------------- */

  /**
   * Run at the very end of Phase.Command.
   *
   * Phase.Command because this is the module that consumes a player's
   * relocation order, and because landing BEFORE Phase.Production means a
   * structure that arrives this tick is counted by the census, feeds the tech
   * mask and lights up the sidebar on the same tick — and the rally and primary
   * intents we push are drained by production later in this same tick rather
   * than next one.
   */
  tick(_s: SimContext): void {
    const service = this.svc();
    if (service === null) return;
    this.drainRequests(service);

    let active = 0;
    for (let t = 0; t < TRANSIT_CAPACITY; t++) {
      const rec = this.transits[t];
      if (rec.leg === Leg.Empty) continue;
      active++;
      if (rec.leg === Leg.Transit) this.advanceTransit(service, rec);
      else this.advanceRising(rec);
    }
    this.counters.active = active;
  }

  private drainRequests(service: ProductionService): void {
    const n = this.queued;
    this.queued = 0;
    for (let q = 0; q < n; q++) {
      const building = this.queueBuilding[q] as EntityId;
      const player = this.queuePlayer[q] as PlayerId;
      const f = this.queueFacing[q];
      this.apply(
        service, player, building, this.queueCx[q], this.queueCz[q],
        f < 0 ? undefined : f,
      );
    }
  }

  /* -- uprooting ---------------------------------------------------------- */

  /**
   * Take the fee and lift the structure out of the world.
   *
   * The re-check here is the authoritative one. Between the click and this line
   * a tank may have parked on the site, the player may have gone broke on a
   * repair drip, or a second click may have queued the same building twice —
   * and this is the only place that can see any of it.
   */
  private apply(
    service: ProductionService, player: PlayerId, building: EntityId,
    cx: number, cz: number, facing?: number,
  ): void {
    const st = this.world.store;
    const i = st.index(building);
    if (i < 0) return;

    const report = evaluateRelocate(
      this.world, service, player, building, cx, cz, this.report, facing,
    );
    if (!report.ok || report.entry === null) {
      this.refuse(player, report);
      return;
    }
    const slot = this.freeTransit();
    if (slot < 0) {
      this.refuse(player, fail(report, RelocateFault.WorldFull));
      return;
    }

    // CHARGE EXACTLY ONCE, HERE, and only after every other check has passed.
    // `spend` is atomic: it either takes the whole fee and emits
    // `economy:credits`, or it takes nothing and says so.
    if (!this.charge(player, report.cost)) {
      this.refuse(player, fail(report, RelocateFault.CannotAfford));
      return;
    }
    this.counters.charged += report.cost;

    const entry = report.entry;
    const rec = this.transits[slot];
    rec.leg = Leg.Transit;
    rec.player = player as number;
    rec.entryIndex = entry.index;
    rec.cx = cx;
    rec.cz = cz;
    // The facing the destination was CHECKED at, snapped to a quarter turn.
    // Reading `st.yaw[i]` here instead would re-found a turned relocation at the
    // angle it left with while the occupancy grid had been cleared for the new
    // one — the ghost and the world disagreeing by 90 degrees.
    rec.facing = report.facing;
    rec.yaw = facingYaw(report.facing);
    rec.hpFrac = st.maxHp[i] > 0 ? Math.max(0.05, Math.min(1, st.hp[i] / st.maxHp[i])) : 1;
    rec.vetFlags = st.flags[i] & (EntityFlag.Veteran1 | EntityFlag.Veteran2);
    rec.primary = (st.flags[i] & EntityFlag.PrimaryFactory) !== 0;
    rec.repairing = repairSellService()?.isRepairing(building) === true;
    rec.fee = report.cost;
    rec.ticksLeft = TRANSIT_TICKS;
    rec.blockedTicks = 0;
    rec.id = NONE;

    // The rally flag belongs to the FACTORY, not to the entity id, so it has to
    // be read before the id dies and re-issued against the new one.
    rec.hasRally = service.rallyPoint(player, building, rallyScratch);
    rec.rallyX = rallyScratch[0];
    rec.rallyZ = rallyScratch[1];

    const fw = st.footprintW[i];
    const fh = st.footprintH[i];
    const x = st.posX[i];
    const y = st.posY[i];
    const z = st.posZ[i];
    footprintOriginCell(x, z, fw, fh, originCell);
    rec.homeCx = originCell[0];
    rec.homeCz = originCell[1];
    rec.homeFacing = yawToFacing(st.yaw[i]);

    // `UnitState.Selling` is Damage.ts's quiet-removal channel: no fireball, no
    // wreck, no "building lost", no loss on the scoreboard — and `entity:killed`
    // still fires, so production releases the footprint, drops the rally entry
    // and marks the tech tree dirty exactly as it does for a sold structure.
    // A relocation is a conversion, not a casualty. It deliberately does NOT
    // emit `building:sold`: that event pays a refund and coughs up a crew of
    // free infantry, and a relocation must do neither.
    st.state[i] = UnitState.Selling;
    st.markDead(building);

    this.channels.fx.push(
      FxKind.SellPuff, x, y + 1.2, z, 0, 1, 0, 1.5, building, st.faction[i],
    );

    // Tell the HUD and EVA the same story a placement tells them. `Committed`
    // with `id` still NONE is honest: the structure is on its way, and the id
    // it will carry does not exist yet.
    service.publishPlacement(
      PlacementPhase.Committed, player, entry, cx, cz, true, '', rec.facing,
    );
  }

  private freeTransit(): number {
    for (let t = 0; t < TRANSIT_CAPACITY; t++) {
      if (this.transits[t].leg === Leg.Empty) return t;
    }
    return -1;
  }

  /* -- in transit --------------------------------------------------------- */

  private advanceTransit(service: ProductionService, rec: Transit): void {
    if (rec.ticksLeft > 0) {
      rec.ticksLeft--;
      // A puff over the destination, so the site reads as claimed rather than
      // as somewhere the player clicked and nothing happened.
      if (rec.ticksLeft % DUST_INTERVAL_TICKS === 0) this.dust(service, rec, rec.cx, rec.cz);
      return;
    }
    this.arrive(service, rec);
  }

  /**
   * Put it back in the world.
   *
   * The destination is re-checked one last time, because four seconds is long
   * enough for an opponent to wall the site off. A destination that has gone is
   * retried for `arrivalGraceTicks` — a tank in the way will usually drive off —
   * and after that the structure GOES HOME and the fee is refunded. It is never
   * simply lost: a player who pays to move a building and is handed nothing has
   * been robbed, however defensible the sequence of events was.
   */
  private arrive(service: ProductionService, rec: Transit): void {
    const p = this.world.players[rec.player];
    const entry = service.catalog.at(rec.entryIndex);
    if (p === undefined || entry === null) {
      // Nothing left to re-found. Refund, so the credits are not swallowed too.
      this.refund(rec);
      rec.leg = Leg.Empty;
      return;
    }

    const goingHome = rec.blockedTicks > RELOCATE.arrivalGraceTicks;
    const cx = goingHome ? rec.homeCx : rec.cx;
    const cz = goingHome ? rec.homeCz : rec.cz;
    // Going home undoes the turn as well as the move: `homeCx/Cz` name the
    // rectangle the ORIGINAL orientation occupied.
    const facing = goingHome ? rec.homeFacing : rec.facing;

    if (!this.siteIsClear(p.id, entry, cx, cz, goingHome, facing)) {
      rec.blockedTicks++;
      if (rec.blockedTicks === RELOCATE.arrivalGraceTicks + 1) {
        // Give up on the destination. The fee bought a move that could not
        // happen, so it comes back with the building.
        this.refund(rec);
        this.counters.returned++;
        this.eva(p.id, EvaLine.CannotDeployHere);
        service.publishPlacement(
          PlacementPhase.Rejected, p.id, entry, rec.cx, rec.cz,
          false, FAULT_TEXT[RelocateFault.Destination], rec.facing,
        );
      }
      return;
    }

    // `buildProgress` 0: it RISES, exactly as a newly placed structure does,
    // which is where the rest of the downtime comes from and which reuses the
    // whole existing construction presentation for free.
    const id = service.spawnBuilding(p, entry, cx, cz, 0, facingYaw(facing));
    if (id === NONE) {
      // The store is full. Keep the record and try again next tick rather than
      // deleting a building the player paid to keep.
      rec.blockedTicks++;
      return;
    }

    const st = this.world.store;
    const i = st.index(id);
    if (i >= 0) {
      st.flags[i] |= rec.vetFlags;
      // Damage travels. `advanceConstruction` ramps HP with the rise and would
      // otherwise hand back a fully repaired structure for 35% of build cost.
      const target = st.maxHp[i] * rec.hpFrac;
      if (st.hp[i] > target) st.hp[i] = target;
      this.channels.fx.push(
        FxKind.BuildRise, st.posX[i], st.posY[i], st.posZ[i], 0, 1, 0, 1.4, id, st.faction[i],
      );
    }

    // Both of these are Production's state, so both go through Production's own
    // API. We run at the end of Phase.Command, so the intents are drained at
    // Phase.Production in this same tick — and the rally has to be re-issued
    // BEFORE the rise finishes, because `onBuildingCompleted` hands a factory a
    // default rally flag when it does not already have one, and that default
    // would silently replace the point the player set.
    if (rec.hasRally) service.setRally(p.id, id, rec.rallyX, rec.rallyZ);
    if (rec.primary) service.setPrimary(p.id, id);
    // The wrench is deliberately NOT re-armed here. `RepairSell.setRepairing`
    // refuses anything `UnderConstruction`, which this now is, so arming it at
    // this line would silently do nothing. It is re-armed in `advanceRising`
    // the tick the structure finishes.

    rec.id = id;
    rec.leg = Leg.Rising;
    rec.blockedTicks = 0;
    if (!goingHome) this.counters.moved++;
  }

  /**
   * Is the site still free?
   *
   * On the way to the destination this is the full placement rule, including
   * the build radius — the player might have sold the structure that was
   * covering it. There is no exempt rectangle at either end: the structure left
   * the world at pickup, so its old cells were released at Phase.Cleanup of
   * that same tick and there is nothing left to exempt.
   *
   * On the way HOME two of the rule's clauses are dropped, and only two:
   *
   *   - BODIES. The cells were vacated by this very structure moments ago, so
   *     the only thing that can be standing on them is something that wandered
   *     in. A building that refuses to come home because an infantryman is
   *     loitering is a building that is gone. The movement layer's nav clamp
   *     shoves whatever is underneath, exactly as it does for a scenario-placed
   *     structure.
   *   - THE BUILD RADIUS. The base may have been shelled flat while this was in
   *     transit, and refusing to give a structure back because the yard that
   *     covered it has died is the same robbery the grace period exists to
   *     prevent.
   *
   * Terrain, occupancy and the map edge still rule. Overlapping another
   * structure is not survivable — two buildings on one cell corrupt the
   * occupancy grid for the rest of the match.
   */
  private siteIsClear(
    player: PlayerId, entry: BuildEntry, cx: number, cz: number, home: boolean, facing: number,
  ): boolean {
    const report = evaluatePlacement(
      this.world, player, entry, cx, cz, scratchPlacement, null, facing,
    );
    if (report.ok) return true;
    if (!home) return false;
    const terrain = this.world.terrain;
    // WORLD-SPACE extents, or the reduced going-home test walks a different
    // rectangle than the full rule just walked.
    const fw = facedFootprintW(entry.footprintW, entry.footprintH, facing);
    const fh = facedFootprintH(entry.footprintW, entry.footprintH, facing);
    for (let z = 0; z < fh; z++) {
      for (let x = 0; x < fw; x++) {
        const gx = cx + x;
        const gz = cz + z;
        if (!isInMap(gx, gz)) return false;
        if (terrain.isOccupied(gx, gz)) return false;
        if (!terrain.isBuildable(gx, gz)) return false;
      }
    }
    return true;
  }

  /* -- rising ------------------------------------------------------------- */

  /**
   * Hold the damage down while the new structure rises, then let go.
   *
   * `Production.advanceConstruction` raises HP toward full with the rise and
   * sets it to `maxHp` on the last frame. Clamping every tick — rather than
   * once at the end — means a structure shelled while it is rising still ends
   * up worse off, not magically restored to the fraction it arrived with.
   *
   * The wrench is re-armed on the tick the rise completes, because
   * `RepairSell.setRepairing` refuses anything still `UnderConstruction`. A
   * player who had a building on drip-repair and moved it gets the drip back,
   * which is the only reading of "the move preserved my state" that is true.
   */
  private advanceRising(rec: Transit): void {
    const st = this.world.store;
    const i = st.index(rec.id);
    if (i < 0) { rec.leg = Leg.Empty; rec.id = NONE; return; }

    const target = st.maxHp[i] * rec.hpFrac;
    if (st.hp[i] > target) st.hp[i] = target;

    if ((st.flags[i] & EntityFlag.UnderConstruction) === 0 && st.buildProgress[i] >= 1) {
      if (rec.repairing) {
        repairSellService()?.setRepairing(rec.player as PlayerId, rec.id, true);
      }
      rec.leg = Leg.Empty;
      rec.id = NONE;
    }
  }

  /* -- money -------------------------------------------------------------- */

  /** Take the fee. All of it, or none of it. */
  private charge(player: PlayerId, amount: number): boolean {
    if (amount <= 0) return true;
    const economy = getEconomy();
    if (economy !== null) return economy.spend(player, amount, CreditReason.Build);
    const p = this.world.players[player as number];
    if (p === undefined || p.credits < amount) return false;
    p.credits -= amount;
    p.stats.creditsSpent += amount;
    return true;
  }

  /** Hand the fee back. Only ever called when the move could not happen. */
  private refund(rec: Transit): void {
    if (rec.fee <= 0) return;
    const player = rec.player as PlayerId;
    const economy = getEconomy();
    if (economy !== null) economy.grant(player, rec.fee, CreditReason.Refund);
    else {
      const p = this.world.players[rec.player];
      if (p !== undefined) p.credits += rec.fee;
    }
    this.counters.charged -= rec.fee;
    rec.fee = 0;
  }

  /* -- refusal ------------------------------------------------------------ */

  private refuse(player: PlayerId, report: RelocateReport): void {
    this.counters.refused++;
    this.eva(player, EvaLine.CannotDeployHere);
    if (report.entry !== null) {
      this.svc()?.publishPlacement(
        PlacementPhase.Rejected, player, report.entry, report.cx, report.cz, false, report.reason,
        report.facing,
      );
    }
  }

  /* -- presentation -------------------------------------------------------- */

  private dust(service: ProductionService, rec: Transit, cx: number, cz: number): void {
    const entry = service.catalog.at(rec.entryIndex);
    if (entry === null) return;
    const x = (cx + entry.footprintW * 0.5) * CELL;
    const z = (cz + entry.footprintH * 0.5) * CELL;
    const p = this.world.players[rec.player];
    this.channels.fx.push(
      FxKind.DustPuff, x, this.world.terrain.heightAt(x, z) + 0.4, z,
      0, 1, 0, 1.2, NONE, p === undefined ? 0 : p.faction,
    );
  }

  private eva(player: PlayerId, line: EvaLine): void {
    this.world.audio.eva(player, line);
    this.channels.events.emit('eva:line', { player, line });
  }

  /** Diagnostics for the boot log and the F3 overlay. */
  stats(): string {
    const c = this.counters;
    return `relocate: ${c.active} in transit, ${c.moved} moved, ` +
      `${c.returned} returned, ${c.refused} refused, ${c.charged} credits`;
  }

  dispose(): void {
    for (let t = 0; t < TRANSIT_CAPACITY; t++) {
      this.transits[t].leg = Leg.Empty;
      this.transits[t].id = NONE;
    }
    this.queued = 0;
  }
}

/** Scratch for `ProductionService.rallyPoint`, which wants a caller array. */
const rallyScratch = new Float32Array(2);

/* ==========================================================================
 * 5. MODULE SINGLETON
 * ========================================================================== */

let activeService: RelocateService | null = null;

/** Publish the live service. `relocate.system.ts` calls this at init. */
export function setRelocate(next: RelocateService | null): void {
  activeService = next;
}

/** The live service, or null before init / after dispose. */
export function relocate(): RelocateService | null {
  return activeService;
}

/**
 * Convenience for callers that have a world but not a service handle — the
 * tests, and the console. Returns false when no service is live.
 */
export function canRelocate(player: PlayerId, building: EntityId): boolean {
  return activeService?.eligible(player, building) === true;
}

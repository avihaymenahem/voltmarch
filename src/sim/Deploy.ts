/**
 * ============================================================================
 * VOLTMARCH — src/sim/Deploy.ts
 * ============================================================================
 * THE MCV UNPACKS. The mechanic every C&C match opens with, and the one piece
 * of vocabulary this codebase declared and then never consumed.
 *
 * WHAT WAS ALREADY HERE
 * ---------------------
 * `core/types.ts` has had `OrderKind.Deploy`, `UnitState.Deploying`,
 * `EntityFlag.Deployed` and `EvaLine.CannotDeployHere` since the contract layer
 * was written, and `data/Defs.ts` has carried `deploysInto` on all three
 * construction vehicles (`mcv -> conyard`, `mrdCarryall -> mrdConclave`,
 * `rclCrawler -> rclFoundry`). Nothing read any of it. This file consumes those
 * declarations rather than inventing a parallel set.
 *
 * THE SHAPE OF THE MECHANIC
 * -------------------------
 *   1. `OrderKind.Deploy` lands on a unit whose def names a `deploysInto`.
 *   2. The footprint of that structure is checked WHERE THE VEHICLE STANDS.
 *   3. `UnitState.Deploying` for DEPLOY_SECONDS, immobilised, throwing dust.
 *   4. The vehicle leaves quietly, the structure arrives finished, owned by the
 *      same player, carrying `EntityFlag.Deployed`.
 *
 * DEPLOY HAPPENS WHERE THE VEHICLE STANDS — it is not a move order with a
 * building on the end. That is RA1/RA2 behaviour to the letter (you drive, THEN
 * you press D) and it is also the only version with no failure mode: a
 * "drive there and then unpack" order has to decide what to do when the
 * destination turns out to be unreachable, and every answer to that is either a
 * unit that re-paths forever or a unit that silently deploys somewhere the
 * player did not ask for. The order still carries x/z, because the command
 * struct has the fields and a replay should record what was clicked.
 *
 * VALIDATION IS `evaluatePlacement`, NOT A SECOND COPY OF IT
 * ---------------------------------------------------------
 * Placement.ts §1 exists precisely so the ghost and the sim cannot disagree
 * about what "buildable" means. A deploy asks the same question, so it asks the
 * same function, with exactly ONE documented difference:
 *
 *   THE BUILD RADIUS DOES NOT APPLY. `evaluatePlacement` ANDs `inRadius` into
 *   its verdict because a structure has to go near a base. An MCV is how you
 *   get your first base — requiring it to be near one is a chicken-and-egg that
 *   would make the opening of every match impossible. So the deploy verdict is
 *   `report.blocked === 0`, and `PlacementFault.OutOfRange` is ignored.
 *
 * THE VEHICLE IS NOT ALLOWED TO BLOCK ITSELF
 * ------------------------------------------
 * `evaluatePlacement` rasterises every non-building entity standing on the site
 * into blocked cells — and the deploying vehicle is, by definition, standing in
 * the middle of the site. So it is masked out for the duration of the query by
 * OR-ing `EntityFlag.PendingDestroy` (the one flag the rule already skips) into
 * its row and restoring the saved value in a `finally`. The mutation is
 * synchronous, spans a single pure function call, and says something true: at
 * the moment of the check that vehicle is on its way out.
 *
 * DETERMINISM
 * -----------
 * No wall clock and no RNG anywhere in this file. The unpack is counted in
 * TICKS, not in accumulated float seconds, so two runs of the same seed flip
 * the structure into existence on the identical tick. Dust puffs are cadenced
 * off the same tick counter.
 *
 * QUIET REMOVAL
 * -------------
 * `UnitState.Selling` is `sim/Damage.ts`'s established "this left the world but
 * it did not die" channel: no fireball, no wreck, no "unit lost", no loss on the
 * scoreboard, and `entity:killed` still fires so selection, tech and production
 * all hear about it. A deploying vehicle and an undeploying structure both use
 * it, because both are conversions and neither is a casualty.
 * ============================================================================
 */

import { MAP_CELLS, MAX_ENTITIES, SIM_DT } from '../core/config';
import {
  EntityFlag, EntityKind, EvaLine, FxKind, NONE, OrderKind, UnitState,
} from '../core/types';
import type { DefTables, Faction, PlayerId, SimContext } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { footprintOriginCell } from '../core/math';

import {
  PlacementFault, PlacementPhase, evaluatePlacement, makePlacementReport,
  type PlacementReport,
} from './Placement';
import { production, type BuildEntry, type ProductionService } from './Production';

/* ==========================================================================
 * 1. TUNABLES
 *
 * Local rather than in core/config.ts: these three numbers are the FEEL of one
 * mechanic owned by one file, and config.ts is the art-direction surface a
 * visual critic edits. A number nobody outside this module reads does not
 * belong on that surface.
 * ========================================================================== */

/** Seconds the vehicle spends unfolding before the structure exists. */
export const DEPLOY_SECONDS = 1.6;

/** Seconds a structure spends folding back down into a vehicle. */
export const UNDEPLOY_SECONDS = 1.6;

/** Ticks, derived once. Counting ticks (not seconds) is what makes it exact. */
export const DEPLOY_TICKS = Math.max(1, Math.round(DEPLOY_SECONDS / SIM_DT));
export const UNDEPLOY_TICKS = Math.max(1, Math.round(UNDEPLOY_SECONDS / SIM_DT));

/** One dust puff every this many ticks while something is unpacking. */
const DUST_INTERVAL_TICKS = 4;

/* ==========================================================================
 * 2. THE CONTENT QUESTION — what does this turn into?
 *
 * `UnitDef.deploysInto` is the authority and is read first. The fallback table
 * below exists for the same reason `Scenarios.FALLBACK_UNITS` does: the sim has
 * to keep working when no data module was found — a `?shot=` boot that never
 * loads one, and every headless test built on the empty binding. It is three
 * rows, it is asserted equal to `DEF_TABLES` by tests/deploy.spec.ts, and it is
 * never consulted while a real table is bound.
 * ========================================================================== */

/** `unit key -> building key`, mirroring `deploysInto` in src/data/Defs.ts. */
export const FALLBACK_DEPLOYS_INTO: Readonly<Record<string, string>> = {
  mcv: 'conyard',
  mrdCarryall: 'mrdConclave',
  rclCrawler: 'rclFoundry',
};

/** Live def tables, when a data module published some. */
let tables: DefTables | null = null;
/** `building key -> unit key`, the inverse of every `deploysInto` we know of. */
let inverse: ReadonlyMap<string, string> = buildInverse(null);

/**
 * Publish the def tables. `deploy.system.ts` calls this at init with whatever
 * `resolveDefBinding()` found; passing null restores the fallback table.
 */
export function bindDeployTables(next: DefTables | null): void {
  tables = next;
  inverse = buildInverse(next);
}

/** The tables currently in force. Exposed for tests and the console. */
export function deployTables(): DefTables | null {
  return tables;
}

function buildInverse(t: DefTables | null): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (t === null) {
    for (const unitKey of Object.keys(FALLBACK_DEPLOYS_INTO)) {
      map.set(FALLBACK_DEPLOYS_INTO[unitKey], unitKey);
    }
    return map;
  }
  for (const u of t.units) {
    if (u.deploysInto === null) continue;
    // First writer wins, so two vehicles naming one structure cannot make the
    // undeploy target depend on table order.
    if (!map.has(u.deploysInto)) map.set(u.deploysInto, u.key);
  }
  return map;
}

/** The structure key a unit key unfolds into, or null. */
export function deployTargetForKey(unitKey: string): string | null {
  if (tables !== null) {
    const d = tables.unitByKey.get(unitKey);
    if (d !== undefined) return tables.units[d].deploysInto;
    return null;
  }
  return FALLBACK_DEPLOYS_INTO[unitKey] ?? null;
}

/** The vehicle key a structure key folds back into, or null. */
export function undeployTargetForKey(buildingKey: string): string | null {
  return inverse.get(buildingKey) ?? null;
}

/**
 * The content key of the entity in slot `i`, or ''.
 *
 * Two routes, in order of authority: the real def index the store carries when
 * a data module is bound, then the production catalog, which exists in every
 * boot including the ones with no content at all.
 */
export function contentKeyOf(world: World, i: number): string {
  const st = world.store;
  const defId = st.defId[i];
  const t = tables;
  if (t !== null && defId >= 0) {
    const isBuilding = st.kind[i] === EntityKind.Building;
    const table = isBuilding ? t.buildings : t.units;
    if (defId < table.length) return table[defId].key;
  }
  return production()?.entryOf(st.handleOf(i))?.key ?? '';
}

/**
 * True when the entity in slot `i` is a construction vehicle.
 *
 * The single predicate the input layer, the cursor and the sim all ask, so the
 * D key, the deploy cursor and the order that actually runs cannot disagree
 * about which units are MCVs.
 */
export function isDeployable(world: World, i: number): boolean {
  const st = world.store;
  if (st.kind[i] === EntityKind.Building) return false;
  if ((st.flags[i] & EntityFlag.Alive) === 0) return false;
  const key = contentKeyOf(world, i);
  return key !== '' && deployTargetForKey(key) !== null;
}

/** True when the structure in slot `i` can pack back down into a vehicle. */
export function isUndeployable(world: World, i: number): boolean {
  const st = world.store;
  if (st.kind[i] !== EntityKind.Building) return false;
  if ((st.flags[i] & EntityFlag.Alive) === 0) return false;
  // Half-built concrete does not fold into anything.
  if ((st.flags[i] & EntityFlag.UnderConstruction) !== 0) return false;
  const key = contentKeyOf(world, i);
  return key !== '' && undeployTargetForKey(key) !== null;
}

/* ==========================================================================
 * 3. THE RULE
 * ========================================================================== */

/** Why a deploy was refused. Ordered by how much the player cares. */
export const enum DeployFault {
  None = 0,
  /** Nothing in the content says this unit unfolds into anything. */
  NotDeployable = 1,
  /** The structure it names is not in the production catalog. */
  NoTarget = 2,
  /** The ground said no — occupied, too steep, wet, or off the map. */
  Footprint = 3,
  /** The entity store is full. */
  WorldFull = 4,
  /** The structure is packing but there is nowhere for the vehicle to stand. */
  NoRoom = 5,
}

const FAULT_TEXT: readonly string[] = [
  '',
  'This unit cannot deploy',
  'Nothing to deploy into',
  'Cannot deploy here',
  'Too many units',
  'Clear a space alongside',
];

/** The answer, filled in place. Never retained. */
export interface DeployReport {
  ok: boolean;
  fault: DeployFault;
  reason: string;
  /** Minimum-corner cell the structure would be founded on. */
  cx: number;
  cz: number;
  w: number;
  h: number;
  /** The structure this would become, or null. */
  entry: BuildEntry | null;
}

export function makeDeployReport(): DeployReport {
  return { ok: false, fault: DeployFault.None, reason: '', cx: 0, cz: 0, w: 0, h: 0, entry: null };
}

/** Module scratch, so the query path never allocates. */
const originCell = new Int32Array(2);
const deployPlacement: PlacementReport = makePlacementReport();

/**
 * Would the unit in slot `i` deploy successfully right now?
 *
 * Pure apart from the documented self-mask (see the header), allocation-free,
 * and called from three places: the sim at the start of the unpack, the sim
 * again at the end of it, and the tests.
 */
export function evaluateDeploy(
  world: World,
  service: ProductionService,
  i: number,
  out: DeployReport,
): DeployReport {
  out.ok = false;
  out.fault = DeployFault.None;
  out.entry = null;
  out.cx = 0;
  out.cz = 0;
  out.w = 0;
  out.h = 0;

  const st = world.store;
  const key = contentKeyOf(world, i);
  const targetKey = key === '' ? null : deployTargetForKey(key);
  if (targetKey === null) return fail(out, DeployFault.NotDeployable);

  const entry = service.catalog.byKey(targetKey);
  if (entry === null || entry.footprintW <= 0 || entry.footprintH <= 0) {
    return fail(out, DeployFault.NoTarget);
  }
  out.entry = entry;
  out.w = entry.footprintW;
  out.h = entry.footprintH;

  // Snap: the structure is centred on the vehicle, then clamped so a deploy at
  // the map edge lands fully on the map instead of failing.
  footprintOriginCell(st.posX[i], st.posZ[i], entry.footprintW, entry.footprintH, originCell);
  out.cx = clampCell(originCell[0], entry.footprintW);
  out.cz = clampCell(originCell[1], entry.footprintH);

  const owner = st.owner[i] as PlayerId;
  const report = placementIgnoring(world, owner, entry, out.cx, out.cz, i, deployPlacement);
  // `report.ok` also demands the build radius. A first MCV has no base to be
  // near, so the radius is deliberately not part of this verdict — see header.
  if (report.blocked > 0) {
    out.fault = DeployFault.Footprint;
    // The placement rule's own sentence is better than a generic one, unless it
    // is the radius complaint, which cannot apply to a deploy.
    out.reason = report.fault === PlacementFault.OutOfRange || report.reason === ''
      ? FAULT_TEXT[DeployFault.Footprint]
      : report.reason;
    return out;
  }

  out.ok = true;
  out.reason = '';
  return out;
}

function fail(out: DeployReport, fault: DeployFault): DeployReport {
  out.ok = false;
  out.fault = fault;
  out.reason = FAULT_TEXT[fault];
  return out;
}

function clampCell(v: number, span: number): number {
  return Math.max(0, Math.min(MAP_CELLS - span, v));
}

/**
 * `evaluatePlacement` with one entity masked out of the blocker scan.
 *
 * See the header: the deploying vehicle occupies the site it is about to become
 * a structure on, so without this every deploy fails on itself. The flag is
 * restored in a `finally` and nothing runs in between.
 */
export function placementIgnoring(
  world: World,
  player: PlayerId,
  entry: BuildEntry,
  cx: number,
  cz: number,
  ignoreSlot: number,
  out: PlacementReport,
): PlacementReport {
  const flags = world.store.flags;
  const saved = flags[ignoreSlot];
  flags[ignoreSlot] = saved | EntityFlag.PendingDestroy;
  try {
    return evaluatePlacement(world, player, entry, cx, cz, out);
  } finally {
    flags[ignoreSlot] = saved;
  }
}

/* ==========================================================================
 * 4. THE SERVICE
 * ========================================================================== */

/** Diagnostics for the F3 overlay and the tests. */
export interface DeployCounters {
  /** Unpacks currently in flight (both directions). */
  active: number;
  deployed: number;
  undeployed: number;
  refused: number;
}

export class DeployService {
  /**
   * Ticks left on each slot's transition, generation-stamped so a recycled slot
   * never inherits a countdown. Two parallel arrays rather than a Map: the tick
   * loop must not allocate and must not hash.
   */
  private readonly ticksLeft = new Int16Array(MAX_ENTITIES);
  private readonly stamp = new Uint16Array(MAX_ENTITIES);
  /** Non-zero when the slot is folding DOWN (structure -> vehicle). */
  private readonly folding = new Uint8Array(MAX_ENTITIES);

  private readonly report: DeployReport = makeDeployReport();

  readonly counters: DeployCounters = { active: 0, deployed: 0, undeployed: 0, refused: 0 };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {}

  /**
   * Run at the very end of Phase.Command.
   *
   * Phase.Command because `orderKind` and `state` are Command-owned columns
   * (see the write-ownership table in core/loop.ts) and this is the module that
   * consumes an `OrderKind.Deploy`. Order 9500 puts it AFTER the fallback order
   * executor in src/input/Commands.ts, so an order issued this tick is already
   * written onto the entity by the time we look.
   */
  tick(_s: SimContext): void {
    const service = production();
    if (service === null) return;
    const st = this.world.store;
    let active = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const flags = st.flags[i];
      if ((flags & EntityFlag.PendingDestroy) !== 0) continue;

      const state = st.state[i];
      const deploying = state === UnitState.Deploying;
      if (!deploying && st.orderKind[i] !== OrderKind.Deploy) continue;

      if (deploying) {
        active++;
        this.advance(service, i);
        continue;
      }
      // A fresh Deploy order. Decide once, this tick — and if it was accepted,
      // count this tick as the first of the unpack rather than a free one, so
      // the transition takes exactly DEPLOY_TICKS ticks end to end.
      if (st.kind[i] === EntityKind.Building) this.beginUndeploy(service, i);
      else this.beginDeploy(service, i);
      if (st.state[i] === UnitState.Deploying) {
        active++;
        this.advance(service, i);
      }
    }
    this.counters.active = active;
  }

  /* -- starting ----------------------------------------------------------- */

  private beginDeploy(service: ProductionService, i: number): void {
    const st = this.world.store;
    const owner = st.owner[i] as PlayerId;
    const report = evaluateDeploy(this.world, service, i, this.report);
    if (!report.ok) {
      this.refuse(service, i, owner, report);
      return;
    }
    st.state[i] = UnitState.Deploying;
    st.flags[i] |= EntityFlag.Immobilized;
    this.arm(i, DEPLOY_TICKS, 0);
    this.dust(i, 1.0);
  }

  private beginUndeploy(service: ProductionService, i: number): void {
    const st = this.world.store;
    const owner = st.owner[i] as PlayerId;
    if (!isUndeployable(this.world, i) || st.buildProgress[i] < 1) {
      this.report.entry = null;
      this.refuse(service, i, owner, fail(this.report, DeployFault.NotDeployable));
      return;
    }
    st.state[i] = UnitState.Deploying;
    this.arm(i, UNDEPLOY_TICKS, 1);
    this.dust(i, 1.2);
  }

  /* -- running ------------------------------------------------------------ */

  private advance(service: ProductionService, i: number): void {
    const st = this.world.store;
    if (this.stamp[i] !== st.gen[i]) {
      // Something else parked this entity in Deploying without arming a timer.
      // Adopt it rather than leaving it frozen in that state forever.
      const down = st.kind[i] === EntityKind.Building;
      this.arm(i, down ? UNDEPLOY_TICKS : DEPLOY_TICKS, down ? 1 : 0);
    }
    const left = this.ticksLeft[i] - 1;
    this.ticksLeft[i] = left;
    if (left > 0) {
      if (left % DUST_INTERVAL_TICKS === 0) this.dust(i, 0.6);
      return;
    }
    if (this.folding[i] !== 0) this.finishUndeploy(service, i);
    else this.finishDeploy(service, i);
  }

  /* -- finishing ---------------------------------------------------------- */

  private finishDeploy(service: ProductionService, i: number): void {
    const st = this.world.store;
    const owner = st.owner[i] as PlayerId;
    const p = this.world.players[owner as number];
    // Re-check: DEPLOY_SECONDS is long enough for a tank to park on the site.
    const report = evaluateDeploy(this.world, service, i, this.report);
    if (p === undefined || !report.ok || report.entry === null) {
      this.refuse(service, i, owner, report);
      return;
    }

    const yaw = st.yaw[i];
    const faction = st.faction[i] as Faction;
    const x = st.posX[i];
    const y = st.posY[i];
    const z = st.posZ[i];

    // The vehicle leaves FIRST, so the structure's own footprint claim never
    // races the corpse. `Selling` is Damage.ts's quiet-removal channel: no
    // fireball, no wreck, no "unit lost" — a deploy is a conversion, not a loss.
    st.state[i] = UnitState.Selling;
    st.orderKind[i] = OrderKind.None;
    st.flags[i] &= ~EntityFlag.Immobilized;
    this.disarm(i);
    st.markDead(st.handleOf(i));

    // buildProgress 1: an MCV hands you a FINISHED yard, exactly as the
    // `spawnBuilding` contract documents. `building:placed`,
    // `building:completed`, `entity:spawned`, the EVA line and the
    // BuildComplete effect all come out of that one call.
    const id = service.spawnBuilding(p, report.entry, report.cx, report.cz, 1, yaw);
    if (id === NONE) {
      // The store was full. The vehicle is already gone; say so honestly rather
      // than pretending the deploy worked.
      this.eva(owner, EvaLine.CannotDeployHere);
      service.publishPlacement(
        PlacementPhase.Rejected, owner, report.entry, report.cx, report.cz,
        false, FAULT_TEXT[DeployFault.WorldFull],
      );
      this.counters.refused++;
      return;
    }
    const bi = st.index(id);
    if (bi >= 0) st.flags[bi] |= EntityFlag.Deployed;

    this.channels.fx.push(FxKind.BuildRise, x, y, z, 0, 1, 0, 1.4, id, faction);
    this.channels.fx.push(FxKind.DustPuff, x, y + 0.4, z, 0, 1, 0, 1.6, NONE, faction);
    this.counters.deployed++;
  }

  private finishUndeploy(service: ProductionService, i: number): void {
    const st = this.world.store;
    const owner = st.owner[i] as PlayerId;
    const p = this.world.players[owner as number];
    const key = contentKeyOf(this.world, i);
    const unitKey = key === '' ? null : undeployTargetForKey(key);
    const entry = unitKey === null ? null : service.catalog.byKey(unitKey);
    if (p === undefined || entry === null) {
      this.cancel(i);
      this.eva(owner, EvaLine.CannotDeployHere);
      this.counters.refused++;
      return;
    }

    const x = st.posX[i];
    const y = st.posY[i];
    const z = st.posZ[i];
    const yaw = st.yaw[i];
    const faction = st.faction[i] as Faction;
    const fw = st.footprintW[i];
    const fh = st.footprintH[i];

    // Release the footprint BEFORE the vehicle appears on it. `onBuildingRemoved`
    // does the same thing again at Phase.Cleanup when `entity:killed` fires;
    // clearing an already-clear rect is a no-op, and waiting for it would leave
    // the fresh vehicle standing on occupied cells for the rest of the tick,
    // where the movement layer's nav clamp would shove it.
    if (fw > 0) {
      footprintOriginCell(x, z, fw, fh, originCell);
      this.world.terrain.clearOccupied(originCell[0], originCell[1], fw, fh);
    }

    st.state[i] = UnitState.Selling;
    st.orderKind[i] = OrderKind.None;
    this.disarm(i);
    st.markDead(st.handleOf(i));

    const id = service.spawnUnit(p, entry, x, z, yaw);
    if (id === NONE) {
      this.eva(owner, EvaLine.CannotDeployHere);
      this.counters.refused++;
      return;
    }
    this.channels.fx.push(FxKind.DustPuff, x, y + 0.4, z, 0, 1, 0, 1.6, NONE, faction);
    this.counters.undeployed++;
  }

  /* -- refusal ------------------------------------------------------------ */

  private refuse(
    service: ProductionService, i: number, owner: PlayerId, report: DeployReport,
  ): void {
    this.cancel(i);
    // Silence for a unit that was never a construction vehicle: an MCV in a
    // mixed selection means the tanks alongside it also received the order, and
    // announcing "cannot deploy here" once per tank is noise, not feedback.
    if (report.fault === DeployFault.NotDeployable) return;

    this.eva(owner, EvaLine.CannotDeployHere);
    if (report.entry !== null) {
      service.publishPlacement(
        PlacementPhase.Rejected, owner, report.entry, report.cx, report.cz, false, report.reason,
      );
    }
    this.counters.refused++;
  }

  /** Put an entity back the way it was and forget its timer. */
  private cancel(i: number): void {
    const st = this.world.store;
    st.orderKind[i] = OrderKind.None;
    st.orderX[i] = st.posX[i];
    st.orderZ[i] = st.posZ[i];
    if (st.state[i] === UnitState.Deploying) st.state[i] = UnitState.Idle;
    st.flags[i] &= ~EntityFlag.Immobilized;
    this.disarm(i);
  }

  /* -- timers -------------------------------------------------------------- */

  private arm(i: number, ticks: number, folding: number): void {
    this.ticksLeft[i] = ticks;
    this.stamp[i] = this.world.store.gen[i];
    this.folding[i] = folding;
  }

  private disarm(i: number): void {
    this.ticksLeft[i] = 0;
    this.stamp[i] = 0;
    this.folding[i] = 0;
  }

  /** Ticks left on a slot's transition, or 0. For tests and the overlay. */
  remaining(i: number): number {
    return this.stamp[i] === this.world.store.gen[i] ? Math.max(0, this.ticksLeft[i]) : 0;
  }

  /* -- presentation --------------------------------------------------------- */

  /**
   * Dust while the thing unpacks, so the transition READS as machinery folding
   * out rather than a unit standing still and then vanishing. Cadenced off the
   * tick counter, never off a wall clock.
   */
  private dust(i: number, scale: number): void {
    const st = this.world.store;
    this.channels.fx.push(
      FxKind.DustPuff,
      st.posX[i], st.posY[i] + 0.3, st.posZ[i],
      0, 1, 0, scale, NONE, st.faction[i] as Faction,
    );
  }

  private eva(player: PlayerId, line: EvaLine): void {
    this.world.audio.eva(player, line);
    this.channels.events.emit('eva:line', { player, line });
  }

  /** Diagnostics for the boot log and the F3 overlay. */
  stats(): string {
    const c = this.counters;
    return `deploy: ${c.active} unpacking, ${c.deployed} deployed, ` +
      `${c.undeployed} packed, ${c.refused} refused`;
  }

  dispose(): void {
    this.ticksLeft.fill(0);
    this.stamp.fill(0);
    this.folding.fill(0);
  }
}

/* ==========================================================================
 * 5. MODULE SINGLETON
 * ========================================================================== */

let activeService: DeployService | null = null;

/** Publish the live service. `deploy.system.ts` calls this at init. */
export function setDeploy(next: DeployService | null): void {
  activeService = next;
}

/** The live service, or null before init / after dispose. */
export function deploy(): DeployService | null {
  return activeService;
}

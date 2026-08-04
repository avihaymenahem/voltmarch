/**
 * ============================================================================
 * VOLTMARCH — src/input/Commands.ts
 * ============================================================================
 * WHAT A RIGHT-CLICK MEANS, AND THE ONE DOOR EVERY ORDER GOES THROUGH.
 *
 * THE FUNNEL
 * ----------
 * Exactly one function, `issueOrder`, puts an order on the wire. The human
 * clicking the ground, the hotkey pressing S, and the AI deciding to attack all
 * arrive at the same `channels.commands.issueOrder`. There is no privileged AI
 * path, which is what makes the opponent feel fair and what makes a match
 * replayable from seed + command log (see core/events.ts §2).
 *
 * ONE RESOLVER, TWO CONSUMERS
 * ---------------------------
 * `resolveContextOrder` answers "what would a right-click here do?" and returns
 * BOTH the order and the cursor. The cursor and the order therefore cannot
 * disagree — the classic bug where the pointer promises an attack and the unit
 * walks up and stands there is structurally impossible here.
 *
 * ROLES WITHOUT A DEF TABLE
 * -------------------------
 * "Can this unit capture?" is a content question and the def tables are still
 * landing. So role questions go through a `RoleResolver` port with a working
 * heuristic default (flags + locomotor + armament) and a def-backed
 * implementation you get by calling `setRoleResolver(makeDefRoleResolver(t))`
 * the moment real tables exist. Nothing here is stubbed: the heuristics are the
 * shipping behaviour until better data arrives.
 *
 * THE FALLBACK EXECUTOR
 * ---------------------
 * The write-ownership table in core/loop.ts assigns `orderKind` / `orderX` /
 * `orderZ` / `stance` / `guard*` to Phase.Command, module "foundation(Orders)".
 * That module does not exist yet, so orders would be issued into a void and the
 * game would look broken in exactly the way this module is supposed to prevent.
 * `OrderExecutor` therefore drains the bus at the END of Phase.Command and
 * writes those columns itself, including shift-queued waypoints.
 *
 *   -> If you are shipping the real orders module, call
 *      `setOrderExecutionEnabled(false)` in your `init()` and this stands down.
 *
 * It is safe to leave enabled in the meantime: command kinds it does not own
 * (production, placement, sell, stance) are copied out during the drain and
 * RE-ISSUED afterwards, so a Command-phase drain never eats another module's
 * traffic.
 *
 * DETERMINISM
 * -----------
 * `OrderExecutor.tick` runs inside the fixed step and contains no `Math.random`,
 * no `Date.now` and no wall clock. Scatter destinations are derived from a hash
 * of the entity handle, computed at ISSUE time and baked into the command, so
 * they replay identically.
 * ============================================================================
 */

import {
  ARRIVE_RADIUS, CELL, MAX_SELECTION, MAX_ENTITIES, MAX_WAYPOINTS,
} from '../core/config';
import {
  BuildTab, CommandKind, EntityFlag, EntityKind, Locomotor, NONE, OrderKind, Stance, UnitState,
} from '../core/types';
import type { Command, DefTables, EntityId, PlayerId, UnitDef } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { clampWorld, hashU32, worldToCell } from '../core/math';
// The ONE edge from src/input/** into src/sim/**, and it buys the thing this
// module exists for: "is this an MCV" is answered by exactly one function, so
// the D key, the deploy cursor and the order the sim actually runs cannot
// disagree. `isDeployable` reads `UnitDef.deploysInto` when a data module is
// bound and a three-row fallback when none is, which is the same answer
// `src/sim/deploy.system.ts` acts on.
import { isDeployable } from '../sim/Deploy';
import { CursorKind } from './Input';
import { isEnemyOf } from './Selection';

/* ==========================================================================
 * 1. ROLES
 * ========================================================================== */

/**
 * The content questions the order resolver has to ask. Every method takes a
 * validated SLOT INDEX, never a handle — the caller already resolved it.
 */
export interface RoleResolver {
  /** Engineer: may walk into an enemy structure and take it. */
  canCapture(world: World, i: number): boolean;
  /** May mend a damaged friendly structure by entering it. */
  canRepair(world: World, i: number): boolean;
  /** Passenger seats. 0 means "not a transport". */
  transportCapacity(world: World, i: number): number;
  /** Mines ore. */
  isHarvester(world: World, i: number): boolean;
}

/**
 * Flags-and-physics heuristics. These are real rules, not placeholders:
 *
 *   - a mobile foot unit with no weapon is an engineer. In this game's roster
 *     that is exactly true — riflemen, conscripts and flak troopers all carry
 *     a weapon index, and the engineer is the one that does not.
 *   - `EntityFlag.IsHarvester` is authoritative; the store sets it at spawn.
 *   - transports need passenger data nothing publishes yet, so the default is
 *     honest about that and answers 0. `makeDefRoleResolver` answers properly.
 */
export const HEURISTIC_ROLES: RoleResolver = {
  canCapture(world: World, i: number): boolean {
    const s = world.store;
    const f = s.flags[i];
    if ((f & EntityFlag.CanMove) === 0) return false;
    if ((f & (EntityFlag.CanAttack | EntityFlag.IsHarvester)) !== 0) return false;
    return s.locomotor[i] === Locomotor.Foot;
  },
  canRepair(world: World, i: number): boolean {
    return HEURISTIC_ROLES.canCapture(world, i);
  },
  transportCapacity(): number {
    return 0;
  },
  isHarvester(world: World, i: number): boolean {
    return (world.store.flags[i] & EntityFlag.IsHarvester) !== 0;
  },
};

let roles: RoleResolver = HEURISTIC_ROLES;

/** Install a better resolver. Passing null restores the heuristics. */
export function setRoleResolver(r: RoleResolver | null): void {
  roles = r ?? HEURISTIC_ROLES;
}

/** The resolver currently in force. */
export function roleResolver(): RoleResolver {
  return roles;
}

/** Unit keys that carry passengers. Matched as substrings, lower-cased. */
const TRANSPORT_KEYS = ['ifv', 'apc', 'transport', 'flaktrack', 'flak_track', 'bullfrog', 'riptide'];

/**
 * A resolver backed by real def tables. `canCapture` becomes the def's own
 * flag; transports are recognised by key, which is the only signal the frozen
 * `UnitDef` shape carries for passengers.
 */
export function makeDefRoleResolver(tables: DefTables): RoleResolver {
  const units = tables.units;
  const seats = new Int8Array(units.length);
  for (let d = 0; d < units.length; d++) {
    const key = units[d].key.toLowerCase();
    for (let k = 0; k < TRANSPORT_KEYS.length; k++) {
      if (key.includes(TRANSPORT_KEYS[k])) { seats[d] = 5; break; }
    }
  }
  const defOf = (world: World, i: number): UnitDef | undefined => {
    if (world.store.kind[i] === EntityKind.Building) return undefined;
    const d = world.store.defId[i];
    return d >= 0 && d < units.length ? units[d] : undefined;
  };
  return {
    canCapture(world: World, i: number): boolean {
      const def = defOf(world, i);
      return def === undefined ? HEURISTIC_ROLES.canCapture(world, i) : def.canCapture;
    },
    canRepair(world: World, i: number): boolean {
      const def = defOf(world, i);
      return def === undefined ? HEURISTIC_ROLES.canRepair(world, i) : def.canCapture;
    },
    transportCapacity(world: World, i: number): number {
      const d = world.store.defId[i];
      if (world.store.kind[i] === EntityKind.Building) return 0;
      return d >= 0 && d < seats.length ? seats[d] : 0;
    },
    isHarvester(world: World, i: number): boolean {
      return HEURISTIC_ROLES.isHarvester(world, i);
    },
  };
}

/* ==========================================================================
 * 2. ORDER RESOLUTION
 * ========================================================================== */

/** Armed modes. A mode makes the NEXT click mean something different. */
export const enum CommandMode {
  /** Normal. Right-click resolves contextually. */
  None = 0,
  /** 'A': the next click is an attack-move. */
  AttackMove = 1,
  /** 'F': the next click force-fires, even on empty ground or your own units. */
  ForceAttack = 2,
  /** 'Y': the next click moves the rally flag of the selected factories. */
  Rally = 3,
}

/** What a click at a point would do. Pooled by the caller; never retained. */
export interface OrderResolution {
  order: OrderKind;
  target: EntityId;
  x: number;
  z: number;
  cursor: CursorKind;
  /** False when the click should do nothing at all. */
  valid: boolean;
  /** True when the order is a rally-flag move rather than a unit order. */
  isRally: boolean;
}

/** Modifier state at the moment of the click. */
export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** Facts about the current selection, recomputed once per pointer move. */
export interface SelectionCapabilities {
  /** Own, orderable entities in the selection. */
  ownCount: number;
  /** Own mobile units. */
  mobileCount: number;
  /** Own structures. */
  buildingCount: number;
  canAttack: boolean;
  canCapture: boolean;
  canRepair: boolean;
  hasHarvester: boolean;
  /** Infantry that could board a transport. */
  hasPassengers: boolean;
  /** Own factories (rally-flag owners) in the selection. */
  factoryCount: number;
  /**
   * Own construction vehicles in the selection.
   *
   * Counted rather than flagged because the Deploy order is issued PER UNIT at
   * each vehicle's own position — a group of three MCVs is three commands, not
   * one command with one destination, and the caller needs to know how many it
   * is about to write.
   */
  deployCount: number;
}

/** Recompute `out` from the current selection. Allocation-free. */
export function readCapabilities(
  world: World,
  ids: Int32Array,
  count: number,
  out: SelectionCapabilities,
): SelectionCapabilities {
  const s = world.store;
  const local = world.localPlayer as number;
  out.ownCount = 0;
  out.mobileCount = 0;
  out.buildingCount = 0;
  out.canAttack = false;
  out.canCapture = false;
  out.canRepair = false;
  out.hasHarvester = false;
  out.hasPassengers = false;
  out.factoryCount = 0;
  out.deployCount = 0;

  for (let n = 0; n < count; n++) {
    const i = s.index(ids[n] as EntityId);
    if (i < 0 || s.owner[i] !== local) continue;
    out.ownCount++;
    const f = s.flags[i];
    if (s.kind[i] === EntityKind.Building) {
      out.buildingCount++;
      if ((f & EntityFlag.IsFactory) !== 0) out.factoryCount++;
      continue;
    }
    if ((f & EntityFlag.CanMove) !== 0) out.mobileCount++;
    if ((f & EntityFlag.CanAttack) !== 0) out.canAttack = true;
    if (roles.isHarvester(world, i)) out.hasHarvester = true;
    if (roles.canCapture(world, i)) out.canCapture = true;
    if (roles.canRepair(world, i)) out.canRepair = true;
    if (s.kind[i] === EntityKind.Infantry) out.hasPassengers = true;
    if (isDeployable(world, i)) out.deployCount++;
  }
  return out;
}

/** A fresh capabilities record. One per consumer, reused forever. */
export function createCapabilities(): SelectionCapabilities {
  return {
    ownCount: 0, mobileCount: 0, buildingCount: 0,
    canAttack: false, canCapture: false, canRepair: false,
    hasHarvester: false, hasPassengers: false, factoryCount: 0, deployCount: 0,
  };
}

/**
 * Collect the local player's selected construction vehicles into `out`.
 *
 * Its own gatherer rather than a filter on `gatherOwnOrderable`, because a
 * mixed selection is the normal case: an MCV escorted by four tanks must deploy
 * the MCV and leave the tanks exactly where they are.
 */
export function gatherDeployable(
  world: World,
  ids: Int32Array,
  count: number,
  out: Int32Array,
): number {
  const s = world.store;
  const local = world.localPlayer as number;
  let n = 0;
  for (let k = 0; k < count && n < out.length; k++) {
    const i = s.index(ids[k] as EntityId);
    if (i < 0 || s.owner[i] !== local) continue;
    if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    // Already unpacking: a second D press must not restart the countdown.
    if (s.state[i] === UnitState.Deploying) continue;
    if (!isDeployable(world, i)) continue;
    out[n++] = ids[k];
  }
  return n;
}

/**
 * THE context-order rule set. Both the cursor and the issued command come from
 * here, so they can never disagree.
 *
 * Priority, highest first:
 *   1. an armed mode (A / F / Y)
 *   2. Ctrl  -> force-attack whatever is under the cursor, ground included
 *   3. Alt   -> force-move, ignoring whatever is under the cursor
 *   4. an all-structure selection -> move the rally flag
 *   5. the entity under the cursor (enemy / friendly / transport / damaged)
 *   6. ore under the cursor with a harvester selected
 *   7. plain ground -> move
 */
export function resolveContextOrder(
  world: World,
  hover: EntityId,
  wx: number,
  wz: number,
  worldValid: boolean,
  mods: Modifiers,
  mode: CommandMode,
  caps: SelectionCapabilities,
  out: OrderResolution,
): OrderResolution {
  const s = world.store;
  const local = world.localPlayer;

  out.order = OrderKind.None;
  out.target = NONE;
  out.x = wx;
  out.z = wz;
  out.cursor = CursorKind.Default;
  out.valid = false;
  out.isRally = false;

  if (caps.ownCount === 0) {
    out.cursor = CursorKind.Select;
    return out;
  }
  if (!worldValid) {
    out.cursor = CursorKind.NoMove;
    return out;
  }

  const hi = s.index(hover);
  const hoverValid = hi >= 0 && (s.flags[hi] & EntityFlag.Alive) !== 0;
  const hoverEnemy = hoverValid && isEnemyOf(world, local, hi);
  const hoverOwn = hoverValid && s.owner[hi] === (local as number);
  if (hoverValid) {
    out.x = s.posX[hi];
    out.z = s.posZ[hi];
  }

  /* -- 1. armed modes ---------------------------------------------------- */
  if (mode === CommandMode.Rally && caps.factoryCount > 0) {
    out.order = OrderKind.SetRally;
    out.x = wx;
    out.z = wz;
    out.cursor = CursorKind.Rally;
    out.valid = true;
    out.isRally = true;
    return out;
  }
  if (mode === CommandMode.AttackMove && caps.mobileCount > 0) {
    out.order = OrderKind.AttackMove;
    out.x = wx;
    out.z = wz;
    out.cursor = CursorKind.AttackMove;
    out.valid = true;
    return out;
  }
  if (mode === CommandMode.ForceAttack || (mods.ctrl && caps.canAttack)) {
    out.order = OrderKind.ForceAttack;
    out.target = hoverValid ? hover : NONE;
    out.cursor = CursorKind.ForceAttack;
    out.valid = caps.canAttack;
    if (!out.valid) out.cursor = CursorKind.NoMove;
    return out;
  }

  /* -- 3. alt: force move ------------------------------------------------ */
  if (mods.alt && caps.mobileCount > 0) {
    out.order = OrderKind.Move;
    out.x = wx;
    out.z = wz;
    out.cursor = CursorKind.Move;
    out.valid = true;
    return out;
  }

  /* -- 4. structures only: the rally flag -------------------------------- */
  if (caps.mobileCount === 0 && caps.factoryCount > 0) {
    out.order = OrderKind.SetRally;
    out.x = wx;
    out.z = wz;
    out.cursor = CursorKind.Rally;
    out.valid = true;
    out.isRally = true;
    return out;
  }
  if (caps.mobileCount === 0) {
    // Selected structures that produce nothing have no ground order at all.
    out.cursor = CursorKind.NoMove;
    return out;
  }

  /* -- 5. something under the cursor ------------------------------------- */
  if (hoverValid) {
    const isBuilding = s.kind[hi] === EntityKind.Building;

    // Your own construction vehicle, with construction vehicles selected: the
    // pointer offers DEPLOY. This is the RA2 gesture verbatim — you hover the
    // MCV you already have selected and the cursor turns into the deploy glyph
    // — and it is why `CursorKind.Deploy` has existed unused since Input.ts was
    // written. It sits above every other hover rule because an MCV parked on
    // its own is otherwise just "a friendly unit: move to it", which is the one
    // thing nobody ever wants to do with an MCV.
    if (hoverOwn && !isBuilding && caps.deployCount > 0 && isDeployable(world, hi)) {
      out.order = OrderKind.Deploy;
      out.target = hover;
      out.x = s.posX[hi];
      out.z = s.posZ[hi];
      out.cursor = CursorKind.Deploy;
      out.valid = true;
      return out;
    }

    if (hoverEnemy) {
      // An engineer takes a structure; everyone else shoots it.
      if (isBuilding && caps.canCapture) {
        out.order = OrderKind.Capture;
        out.target = hover;
        out.cursor = CursorKind.Capture;
        out.valid = true;
        return out;
      }
      if (caps.canAttack && (s.flags[hi] & EntityFlag.NotATarget) === 0) {
        out.order = OrderKind.Attack;
        out.target = hover;
        out.cursor = CursorKind.Attack;
        out.valid = true;
        return out;
      }
      // Unarmed selection: walk there instead of refusing. Refusing is the
      // more "correct" answer and the more annoying one.
      out.order = OrderKind.Move;
      out.cursor = CursorKind.Move;
      out.valid = true;
      return out;
    }

    if (hoverOwn && !isBuilding && roles.transportCapacity(world, hi) > 0 && caps.hasPassengers) {
      out.order = OrderKind.Enter;
      out.target = hover;
      out.cursor = CursorKind.Enter;
      out.valid = true;
      return out;
    }

    if (isBuilding && !hoverEnemy && s.hp[hi] < s.maxHp[hi] && caps.canRepair) {
      out.order = OrderKind.Repair;
      out.target = hover;
      out.cursor = CursorKind.Repair;
      out.valid = true;
      return out;
    }

    if (hoverOwn && isBuilding && caps.hasHarvester && (s.flags[hi] & EntityFlag.IsRefinery) !== 0) {
      // Right-clicking your own refinery with a harvester means "go unload".
      out.order = OrderKind.Harvest;
      out.target = hover;
      out.cursor = CursorKind.Harvest;
      out.valid = true;
      return out;
    }

    // Anything else friendly: move to it.
    out.order = OrderKind.Move;
    out.x = wx;
    out.z = wz;
    out.cursor = CursorKind.Move;
    out.valid = true;
    return out;
  }

  /* -- 6. ore ------------------------------------------------------------- */
  if (caps.hasHarvester) {
    const cx = worldToCell(wx);
    const cz = worldToCell(wz);
    if (world.ore.oreAt(cx, cz) > 0) {
      out.order = OrderKind.Harvest;
      out.x = wx;
      out.z = wz;
      out.cursor = CursorKind.Harvest;
      out.valid = true;
      return out;
    }
  }

  /* -- 7. plain ground ---------------------------------------------------- */
  out.order = OrderKind.Move;
  out.x = wx;
  out.z = wz;
  out.valid = true;
  // The cursor still says "no" over a cliff or open water even though the order
  // is issued — nav walks the group as close as it can get, which is what a
  // player expects, but the pointer should not have promised a clean arrival.
  out.cursor = passableForSelection(world, wx, wz) ? CursorKind.Move : CursorKind.NoMove;
  return out;
}

/** True when at least one common locomotor can stand on this cell. */
function passableForSelection(world: World, x: number, z: number): boolean {
  const cx = worldToCell(x);
  const cz = worldToCell(z);
  return (
    world.terrain.isPassable(cx, cz, Locomotor.Track) ||
    world.terrain.isPassable(cx, cz, Locomotor.Foot) ||
    world.terrain.isPassable(cx, cz, Locomotor.Hover)
  );
}

/* ==========================================================================
 * 3. THE FUNNEL
 * ========================================================================== */

/** Order feedback the overlay draws. */
export const enum FeedbackKind {
  Move = 0,
  Attack = 1,
  Special = 2,
}

export type OrderFeedback = (kind: FeedbackKind, x: number, z: number) => void;

/** Which marker an order deserves. */
export function feedbackFor(order: OrderKind): FeedbackKind {
  switch (order) {
    case OrderKind.Attack:
    case OrderKind.ForceAttack:
    case OrderKind.AttackMove:
      return FeedbackKind.Attack;
    case OrderKind.Move:
    case OrderKind.Scatter:
      return FeedbackKind.Move;
    default:
      return FeedbackKind.Special;
  }
}

/**
 * THE ONE DOOR. Every order in the game — human, hotkey or AI — goes through
 * here, is stamped onto the command bus, and is announced on the event bus.
 *
 * Returns false when there was nothing to order, or when `player` is not a real
 * participant — a command from a stale PlayerId would be applied to nobody and
 * would still burn a ring slot and an event dispatch.
 */
export function issueOrder(
  world: World,
  channels: Channels,
  player: PlayerId,
  order: OrderKind,
  ids: Int32Array | number[],
  count: number,
  x: number,
  z: number,
  target: EntityId = NONE,
  queued = false,
): boolean {
  if (count <= 0 || order === OrderKind.None) return false;
  if (world.players[player as number] === undefined) return false;

  channels.commands.issueOrder(player, order, ids, count, x, z, target, queued);

  const p = channels.events.payload('order:issued');
  p.player = player;
  p.order = order;
  p.count = count;
  p.x = x;
  p.z = z;
  p.target = target;
  channels.events.emitPooled('order:issued');
  return true;
}

/* ==========================================================================
 * 4. GROUP GEOMETRY
 *
 * FORMATION PRESERVATION IS NOT DONE HERE, AND THAT IS DELIBERATE.
 *
 * `src/sim/Steering.ts` already freezes a group's shape: every unit that
 * receives the SAME order point from the SAME player on the SAME tick keeps its
 * offset from the group centroid, uniformly shrunk to a disc sized by the
 * group's own count. That is the same rule this module would otherwise
 * implement, done one layer closer to the mover and with the flow-field sharing
 * intact (one goal -> one field instead of forty).
 *
 * So a group move issues ONE command with ONE destination, precisely so that
 * grouping heuristic fires. Two things still need a per-unit destination,
 * because no shared goal can express them:
 *
 *   - SCATTER: every unit must run somewhere DIFFERENT, by definition.
 *   - GUARD:   every unit holds where IT stands.
 *
 * `planScatter` covers the first; the second is one command per unit at its own
 * position, issued by the caller.
 * ========================================================================== */

/** Per-unit destinations. [x0,z0, x1,z1, ...] Valid until the next call. */
const DESTS = new Float32Array(MAX_SELECTION * 2);

/**
 * Deterministic scatter offsets: each unit gets a direction hashed from its own
 * handle, so the same order replays identically and no two units in a stack
 * pick the same escape route.
 */
export function planScatter(
  world: World,
  ids: Int32Array,
  count: number,
): Float32Array {
  const s = world.store;
  const n = Math.min(count, MAX_SELECTION);
  for (let i = 0; i < n; i++) {
    const idx = s.index(ids[i] as EntityId);
    if (idx < 0) {
      DESTS[i * 2] = 0;
      DESTS[i * 2 + 1] = 0;
      continue;
    }
    const h = hashU32((ids[i] >>> 0) ^ 0x9e3779b9);
    const angle = (h / 4294967296) * Math.PI * 2;
    // 3 to 7 metres — far enough to leave a splash radius, close enough that
    // the formation is recoverable.
    const dist = 3 + ((h >>> 16) / 65536) * 4;
    DESTS[i * 2] = clampWorld(s.posX[idx] + Math.cos(angle) * dist, CELL);
    DESTS[i * 2 + 1] = clampWorld(s.posZ[idx] + Math.sin(angle) * dist, CELL);
  }
  return DESTS;
}

/* ==========================================================================
 * 5. THE FALLBACK ORDER EXECUTOR
 * ========================================================================== */

let executionEnabled = true;

/**
 * Turn the fallback executor off. Call this from the real Command-phase orders
 * module's `init()`; from that moment this file writes no EntityStore column.
 */
export function setOrderExecutionEnabled(v: boolean): void {
  executionEnabled = v;
}

export function isOrderExecutionEnabled(): boolean {
  return executionEnabled;
}

/** One deferred command we drained but do not own. Pre-allocated. */
interface ParkedCommand {
  kind: CommandKind;
  player: PlayerId;
  order: OrderKind;
  target: EntityId;
  x: number;
  z: number;
  defId: number;
  tab: BuildTab;
  cx: number;
  cz: number;
  stance: Stance;
  queued: boolean;
  arg: number;
  entityCount: number;
  entities: Int32Array;
}

const PARK_CAPACITY = 32;

/**
 * Applies Order and SetRally commands to the EntityStore, maintains shift-queued
 * waypoints, and hands every other command kind back to the bus untouched.
 */
export class OrderExecutor {
  /* -- waypoint storage, generation-stamped so a recycled slot starts empty -- */
  private readonly wpKind = new Uint8Array(MAX_ENTITIES * MAX_WAYPOINTS);
  private readonly wpX = new Float32Array(MAX_ENTITIES * MAX_WAYPOINTS);
  private readonly wpZ = new Float32Array(MAX_ENTITIES * MAX_WAYPOINTS);
  private readonly wpTarget = new Int32Array(MAX_ENTITIES * MAX_WAYPOINTS);
  private readonly wpCount = new Uint8Array(MAX_ENTITIES);
  private readonly wpGen = new Uint16Array(MAX_ENTITIES);

  /** Commands drained but not ours, re-issued after the drain returns. */
  private readonly parked: ParkedCommand[] = [];
  private parkedCount = 0;
  private warnedForeign = false;

  /** Diagnostics for the F3 overlay. */
  ordersApplied = 0;
  waypointsQueued = 0;

  private readonly onCommand = (cmd: Command): void => {
    switch (cmd.kind) {
      case CommandKind.Order:
        this.applyOrder(cmd);
        break;
      case CommandKind.SetRally:
        this.applyRally(cmd);
        break;
      default:
        this.park(cmd);
        break;
    }
  };

  constructor(private readonly world: World, private readonly channels: Channels) {
    for (let i = 0; i < PARK_CAPACITY; i++) {
      this.parked.push({
        kind: CommandKind.None, player: 0 as PlayerId, order: OrderKind.None, target: NONE,
        x: 0, z: 0, defId: -1, tab: BuildTab.Structures, cx: 0, cz: 0, stance: Stance.Aggressive,
        queued: false, arg: 0, entityCount: 0, entities: new Int32Array(MAX_SELECTION),
      });
    }
  }

  /** Run at the very end of Phase.Command. */
  tick(): void {
    if (!executionEnabled) return;
    this.parkedCount = 0;
    this.channels.commands.drain(this.onCommand);
    this.reissueParked();
    this.advanceWaypoints();
  }

  /* -- application -------------------------------------------------------- */

  private applyOrder(cmd: Command): void {
    const s = this.world.store;
    const n = cmd.entityCount;
    for (let e = 0; e < n; e++) {
      const i = s.index(cmd.entities[e] as EntityId);
      if (i < 0) continue;
      if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      // Only the owner may order a unit. The bus stamps the player, so this is
      // the check that makes a forged command inert.
      if (s.owner[i] !== (cmd.player as number)) continue;

      if (cmd.queued && cmd.order !== OrderKind.Stop && s.orderKind[i] !== OrderKind.None) {
        this.pushWaypoint(i, cmd.order, cmd.x, cmd.z, cmd.target);
        continue;
      }
      this.clearWaypoints(i);
      this.write(i, cmd.order, cmd.x, cmd.z, cmd.target);
      this.ordersApplied++;
    }
  }

  /** Write one order onto one entity. The only place these columns are set. */
  private write(i: number, order: OrderKind, x: number, z: number, target: EntityId): void {
    const s = this.world.store;
    const mobile = (s.flags[i] & EntityFlag.CanMove) !== 0;

    s.orderKind[i] = order;
    s.orderTarget[i] = target as number;
    s.orderX[i] = x;
    s.orderZ[i] = z;

    switch (order) {
      case OrderKind.Move:
        if (!mobile) break;
        s.state[i] = UnitState.Moving;
        break;

      case OrderKind.AttackMove:
        if (!mobile) break;
        s.state[i] = UnitState.AttackMoving;
        break;

      case OrderKind.Attack:
      case OrderKind.ForceAttack:
        s.state[i] = UnitState.Attacking;
        break;

      case OrderKind.Stop:
        // Park it exactly where it stands: an arrival-based mover then has
        // nothing left to do, whatever module owns the movement.
        s.orderKind[i] = OrderKind.None;
        s.orderTarget[i] = 0;
        s.orderX[i] = s.posX[i];
        s.orderZ[i] = s.posZ[i];
        s.state[i] = UnitState.Idle;
        break;

      case OrderKind.Guard:
        s.guardX[i] = x;
        s.guardZ[i] = z;
        s.state[i] = mobile ? UnitState.Guarding : UnitState.Idle;
        break;

      case OrderKind.Scatter:
        if (!mobile) break;
        s.orderKind[i] = OrderKind.Move;
        s.state[i] = UnitState.Moving;
        break;

      case OrderKind.Harvest:
        s.state[i] = UnitState.SeekOre;
        break;

      case OrderKind.Deploy:
        // DEPLOY UNPACKS WHERE THE UNIT STANDS. It is not a move order with a
        // building on the end — that is RA1/RA2 behaviour to the letter, and it
        // is the only version with no failure mode (see the header of
        // src/sim/Deploy.ts). So the order point is rewritten to the unit's own
        // position, which also stops an in-flight move dead, and `state` is
        // left to `sim/deploy.system.ts`: it runs 500 slots later in this same
        // phase, validates the footprint, and either sets `UnitState.Deploying`
        // or refuses with `EvaLine.CannotDeployHere`. Setting Deploying here
        // would freeze any unit that cannot deploy at all, forever.
        s.orderX[i] = s.posX[i];
        s.orderZ[i] = s.posZ[i];
        s.state[i] = UnitState.Idle;
        break;

      case OrderKind.Capture:
      case OrderKind.Repair:
      case OrderKind.Enter:
        s.state[i] = mobile ? UnitState.Moving : UnitState.Idle;
        break;

      default:
        s.state[i] = UnitState.Idle;
        break;
    }
  }

  private applyRally(cmd: Command): void {
    const s = this.world.store;
    const i = s.index(cmd.target);
    if (i < 0) return;
    if (s.owner[i] !== (cmd.player as number)) return;
    const player = this.world.player(cmd.player);
    if (player === undefined) return;
    player.rallyX.set(cmd.target as number, cmd.x);
    player.rallyZ.set(cmd.target as number, cmd.z);
  }

  /* -- waypoints ----------------------------------------------------------- */

  private slotBase(i: number): number {
    return i * MAX_WAYPOINTS;
  }

  private ensureGeneration(i: number): void {
    const gen = this.world.store.gen[i];
    if (this.wpGen[i] !== gen) {
      this.wpGen[i] = gen;
      this.wpCount[i] = 0;
    }
  }

  private clearWaypoints(i: number): void {
    this.ensureGeneration(i);
    this.wpCount[i] = 0;
  }

  private pushWaypoint(i: number, order: OrderKind, x: number, z: number, target: EntityId): void {
    this.ensureGeneration(i);
    const c = this.wpCount[i];
    if (c >= MAX_WAYPOINTS) return;
    const b = this.slotBase(i) + c;
    this.wpKind[b] = order;
    this.wpX[b] = x;
    this.wpZ[b] = z;
    this.wpTarget[b] = target as number;
    this.wpCount[i] = c + 1;
    this.waypointsQueued++;
  }

  /**
   * Pop the next waypoint for anything that has arrived or gone idle. A unit
   * with a queue is never allowed to sit still.
   */
  private advanceWaypoints(): void {
    const s = this.world.store;
    const arrive2 = ARRIVE_RADIUS * ARRIVE_RADIUS;
    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      if (this.wpGen[i] !== s.gen[i] || this.wpCount[i] === 0) continue;
      if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) { this.wpCount[i] = 0; continue; }

      const dx = s.posX[i] - s.orderX[i];
      const dz = s.posZ[i] - s.orderZ[i];
      const arrived = s.state[i] === UnitState.Idle || (dx * dx + dz * dz) <= arrive2;
      if (!arrived) continue;

      const b = this.slotBase(i);
      const kind = this.wpKind[b] as OrderKind;
      const x = this.wpX[b];
      const z = this.wpZ[b];
      const target = this.wpTarget[b] as EntityId;

      // Shift the queue down. MAX_WAYPOINTS is 8, so this is cheaper than a
      // ring's bookkeeping and leaves the arrays trivially inspectable.
      const c = this.wpCount[i] - 1;
      for (let k = 0; k < c; k++) {
        this.wpKind[b + k] = this.wpKind[b + k + 1];
        this.wpX[b + k] = this.wpX[b + k + 1];
        this.wpZ[b + k] = this.wpZ[b + k + 1];
        this.wpTarget[b + k] = this.wpTarget[b + k + 1];
      }
      this.wpCount[i] = c;
      this.write(i, kind, x, z, target);
    }
  }

  /** Number of queued waypoints an entity is holding. For the overlay. */
  waypointCount(i: number): number {
    return this.wpGen[i] === this.world.store.gen[i] ? this.wpCount[i] : 0;
  }

  /** Read waypoint `k` of entity slot `i` into `out` as [x, z]. */
  waypointAt(i: number, k: number, out: Float32Array): boolean {
    if (this.waypointCount(i) <= k) return false;
    const b = this.slotBase(i) + k;
    out[0] = this.wpX[b];
    out[1] = this.wpZ[b];
    return true;
  }

  /* -- foreign traffic ------------------------------------------------------ */

  /** Copy a command we do not own so it can be re-issued after the drain. */
  private park(cmd: Command): void {
    if (!this.warnedForeign) {
      this.warnedForeign = true;
      console.info(
        '[input] a non-order command reached the fallback executor; it is being ' +
        'handed back to the bus. Once a real Phase.Command module exists, call ' +
        'setOrderExecutionEnabled(false) from its init().',
      );
    }
    if (this.parkedCount >= PARK_CAPACITY) return;
    const p = this.parked[this.parkedCount++];
    p.kind = cmd.kind;
    p.player = cmd.player;
    p.order = cmd.order;
    p.target = cmd.target;
    p.x = cmd.x;
    p.z = cmd.z;
    p.defId = cmd.defId;
    p.tab = cmd.tab;
    p.cx = cmd.cx;
    p.cz = cmd.cz;
    p.stance = cmd.stance;
    p.queued = cmd.queued;
    p.arg = cmd.arg;
    const n = Math.min(cmd.entityCount, p.entities.length);
    for (let i = 0; i < n; i++) p.entities[i] = cmd.entities[i];
    p.entityCount = n;
  }

  /** Put everything we parked back on the bus, in the order it arrived. */
  private reissueParked(): void {
    const bus = this.channels.commands;
    for (let i = 0; i < this.parkedCount; i++) {
      const p = this.parked[i];
      switch (p.kind) {
        case CommandKind.ProductionStart:
          bus.issueProductionStart(p.player, p.tab, p.defId, p.arg);
          break;
        case CommandKind.ProductionPause:
          bus.issueProductionPause(p.player, p.tab, p.arg !== 0);
          break;
        case CommandKind.ProductionCancel:
          bus.issueProductionCancel(p.player, p.tab, p.defId, p.arg);
          break;
        case CommandKind.PlaceBuilding:
          bus.issuePlaceBuilding(p.player, p.defId, p.cx, p.cz);
          break;
        case CommandKind.SellBuilding:
          bus.issueSell(p.player, p.target);
          break;
        case CommandKind.RepairToggle:
          bus.issueRepairToggle(p.player, p.target);
          break;
        case CommandKind.SetStance:
          bus.issueSetStance(p.player, p.entities, p.entityCount, p.stance);
          break;
        case CommandKind.SetPrimary:
          bus.issueSetPrimary(p.player, p.target);
          break;
        case CommandKind.SelfDestruct:
          bus.issueSelfDestruct(p.player, p.target);
          break;
        default:
          break;
      }
    }
    this.parkedCount = 0;
  }
}

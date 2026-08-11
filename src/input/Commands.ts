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
 * AND IT ANSWERS THAT QUESTION THROUGH THE FOG
 * --------------------------------------------
 * The hovered entity is run through `canInteractWith` (src/input/Selection.ts)
 * before it is allowed to mean anything. An enemy the local player cannot see
 * resolves as bare ground: cursor `Move`, order `Move`, target `NONE`. An enemy
 * STRUCTURE on explored ground resolves normally, because the renderer is still
 * drawing its remembered silhouette and refusing to target something visibly on
 * screen would be the worse bug. Force-fire (ctrl / F) is the one exception and
 * keeps working into pitch black — see the note above its branch.
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
  BuildTab, CommandKind, EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind, Stance,
  UnitState,
} from '../core/types';
import type { Command, DefTables, EntityId, PlayerId, UnitDef } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { clampWorld, hashU32, worldToCell } from '../core/math';
// The edges from src/input/** into src/sim/**, and they buy the thing this
// module exists for: "is this an MCV" is answered by exactly one function, so
// the D key, the deploy cursor and the order the sim actually runs cannot
// disagree. `isDeployable` reads `UnitDef.deploysInto` when a data module is
// bound and a three-row fallback when none is, which is the same answer
// `src/sim/deploy.system.ts` acts on. `transportService()` is the same bargain
// for "is anybody aboard": the D key, the HUD's Unload button and
// `sim/Transport.ts` all read one occupancy table rather than three. And
// `commanderPowerSeamOf` is the same bargain again for "is this power charged",
// reached from the ONE Phase.Command drain below rather than by a second
// consumer — the `CommandKind.Relocate` precedent, whose comment in
// `core/types.ts` records what happens when a verb skips the bus.
import { commanderPowerSeamOf } from '../sim/CommanderPowers';
import { isDeployable } from '../sim/Deploy';
import { transportService } from '../sim/Transport';
import { relocateSeamOf, snapRallyClear } from '../sim/Placement';
// The same shape as the `isDeployable` edge above, and bought for the same
// reason: "may this squad walk into that building" has exactly one answer,
// `GarrisonService.refusalFor`, and the cursor must not compute a second one.
// A copy of those seven conditions here is a copy that drifts — and the way it
// would drift is that the pointer promises a garrison and the men walk up to
// the wall and stand there, which is precisely the failure this module's
// header says is "structurally impossible".
import { garrisonService } from '../sim/Garrison';
import { CursorKind } from './Input';
import { canInteractWith, isEnemyOf } from './Selection';

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
 *   - seats are content, not physics: nothing in the flags or the store says
 *     "this hull has room for five men", so the heuristic answers 0 and
 *     `makeDefRoleResolver` reads `UnitDef.passengers`.
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

/**
 * A resolver backed by real def tables. `canCapture` and the seat count both
 * become the def's own fields.
 *
 * The seat count USED TO BE a substring match on the unit key against
 * `['ifv', 'apc', 'transport', 'flaktrack', 'bullfrog', 'riptide']`, awarding a
 * flat 5 to anything that matched, because `UnitDef` carried no passenger data
 * at all. Four of those six keys are not in this roster and never were; the two
 * that matched were given a capacity no simulation code could read, which is
 * how the Hover Transport came to offer an `Enter` cursor that did nothing.
 * `UnitDef.passengers` is now real content and this reads it.
 */
export function makeDefRoleResolver(tables: DefTables): RoleResolver {
  const units = tables.units;
  const seats = new Int8Array(units.length);
  for (let d = 0; d < units.length; d++) {
    const p = units[d].passengers;
    seats[d] = p > 127 ? 127 : p < 0 ? 0 : p | 0;
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
  /**
   * Own mobile units in the selection that FLY (`Locomotor.Air`).
   *
   * A count rather than a flag because the question the cursor asks is not "is
   * anything here an aircraft" but "is EVERYTHING here an aircraft" — a gunship
   * escorting four tanks must still be told the cliff is a bad destination,
   * because four fifths of that selection cannot follow.
   */
  airCount: number;
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
  out.airCount = 0;
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
    if ((f & EntityFlag.CanMove) !== 0) {
      out.mobileCount++;
      if (s.locomotor[i] === Locomotor.Air) out.airCount++;
    }
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
    canAttack: false, canCapture: false, canRepair: false, airCount: 0,
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
 * Collect the local player's selected transports that have somebody aboard.
 *
 * The sibling of `gatherDeployable`, on the same key and for the same gesture:
 * D means "unpack where you stand", and a loaded transport and an MCV are the
 * two things in this game that can. A mixed selection unloads the transports
 * and leaves the escort alone, which is why this is a gatherer and not a filter.
 *
 * Asks `transportService()` rather than `roleResolver().transportCapacity()`,
 * because the question is not "does this def have seats" but "is anybody
 * actually in there" — and the service is the only thing that knows.
 */
export function gatherLoadedTransports(
  world: World,
  ids: Int32Array,
  count: number,
  out: Int32Array,
): number {
  const svc = transportService();
  if (svc === null) return 0;
  const s = world.store;
  const local = world.localPlayer as number;
  let n = 0;
  for (let k = 0; k < count && n < out.length; k++) {
    const i = s.index(ids[k] as EntityId);
    if (i < 0 || s.owner[i] !== local) continue;
    if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    // Already unloading: a second D press must not re-issue every tick.
    if ((s.orderKind[i] as OrderKind) === OrderKind.Unload) continue;
    if (!svc.isLoadedAt(i)) continue;
    out[n++] = ids[k];
  }
  return n;
}

/**
 * True when slot `i` belongs to a `Faction.Neutral` player — Gaia, the owner of
 * every rock, wreck, crate and civilian structure on the map.
 *
 * NOT "has no owner": a neutral structure has a real `PlayerId` and a real
 * entry in `world.players`, and that is exactly why `isEnemyOf` says false for
 * it (Gaia is allied to everyone in both directions). The distinction the
 * resolver needs is "allied because we are on the same side" versus "allied
 * because it is scenery", and only the faction can tell them apart.
 */
function isNeutralOwned(world: World, i: number): boolean {
  const p = world.players[world.store.owner[i]];
  return p !== undefined && p.faction === Faction.Neutral;
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

  // A hover the local player cannot see is NOT a hover. `pickEntity` already
  // refuses to return one, but this resolver is the thing that decides what a
  // click MEANS and it does not take that on trust: the AI, a test and a HUD
  // widget can all hand it a handle that never went past the cursor. The result
  // is the classic behaviour — the pointer over a shrouded enemy reads as bare
  // ground and a right-click there is a move order, exactly as if nothing were
  // standing on it.
  const hi = s.index(hover);
  const hoverValid = hi >= 0
    && (s.flags[hi] & EntityFlag.Alive) !== 0
    && canInteractWith(world, local, hi);
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
  // FORCE-FIRE IS THE DELIBERATE EXCEPTION and the reason "you cannot attack
  // what you cannot see" is not the whole rule. It shells a POINT, not a unit:
  // `out.x/out.z` are still the raw ground hit, so ctrl+click into pitch-black
  // shroud is a legal, useful order and always has been. What it must not do is
  // acquire a handle it was never allowed to see — `hoverValid` is already false
  // there, so the order goes out with `target = NONE` and the shell lands where
  // the player aimed instead of tracking something invisible.
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

    /* -- 5b. the civilian block -------------------------------------------
     * A NEUTRAL STRUCTURE IS NEITHER `hoverOwn` NOR `hoverEnemy`, and that one
     * fact is why both of these mechanics were unreachable from the mouse.
     * Gaia (`ScenarioBuilder.gaia`) is allied to every player in both
     * directions, so `isEnemyOf` answers false for an oil derrick and the
     * resolver fell straight through every branch above to "anything else
     * friendly: move to it". `CaptureService` has captured neutral structures
     * outright since it was written (its rule 1, named for "oil derricks,
     * hospitals, civilian blocks") and `GarrisonService` has accepted a
     * neutral owner since ITS first line — and no click could ever produce
     * either order, because no click could produce the order KIND.
     *
     * ENGINEER FIRST. An engineer takes the deed permanently; infantry only
     * borrow it for as long as they stand inside. With both in the selection
     * the permanent answer is the one the player meant, which is also the RA2
     * priority.
     *
     * ORDER MATTERS AGAINST REPAIR, below. `RoleResolver.canRepair` is
     * `canCapture` in both implementations, so an engineer hovering a DAMAGED
     * neutral derrick would otherwise resolve as Repair — and `Capture.resolve`
     * treats a neutral target as never friendly, so the engineer would arrive
     * carrying an order the sim does not implement for that target.
     *
     * The garrison branch asks the SERVICE rather than re-deriving
     * eligibility, and answers Move when no service is installed. That is not
     * a stub: a world with no garrison system genuinely cannot garrison, and
     * the honest cursor for it is the one the player already gets.            */
    if (isBuilding && !hoverEnemy && !hoverOwn && caps.canCapture && isNeutralOwned(world, hi)) {
      out.order = OrderKind.Capture;
      out.target = hover;
      out.cursor = CursorKind.Capture;
      out.valid = true;
      return out;
    }
    if (isBuilding && caps.hasPassengers && !caps.canCapture
      && (garrisonService()?.canGarrison(hover, local) ?? false)) {
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
  out.cursor = passableForSelection(world, caps, wx, wz) ? CursorKind.Move : CursorKind.NoMove;
  return out;
}

/**
 * True when the SELECTION could arrive at this cell.
 *
 * This function was named for the selection while ignoring it entirely: it
 * asked whether Track, Foot or Hover could stand on the cell and nothing else.
 * That was a complete answer for as long as those were the only ways to travel.
 * `Locomotor.Air` ended that — aircraft ignore the grid, so a flight of
 * gunships was being shown the "no move" cursor over every cliff and every
 * stretch of open water on the map, which is precisely where you send them.
 *
 * The order always issued; only the pointer lied. That makes it cosmetic in the
 * sense that nothing was unreachable, and NOT cosmetic in the sense that the
 * cursor is how a player learns what a unit can do.
 *
 * The test is "every mobile unit here flies", not "one does". A gunship
 * escorting four tanks still deserves the warning, because the escort is what
 * will fail to arrive.
 */
function passableForSelection(
  world: World,
  caps: SelectionCapabilities,
  x: number,
  z: number,
): boolean {
  if (caps.mobileCount > 0 && caps.airCount === caps.mobileCount) return true;
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

/** Rally snap output. Module-level so `applyRally` never allocates. */
const RALLY_SNAP = new Float64Array(2);

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
      case CommandKind.Relocate:
        this.applyRelocate(cmd);
        break;
      case CommandKind.UsePower:
        this.applyPower(cmd);
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

  /**
   * Move a standing structure. The last ordinary gameplay verb that reached the
   * simulation WITHOUT passing this bus.
   *
   * The HUD used to call `globalThis.__vmRelocate.commit(...)` straight from a
   * click handler, so a relocation was invisible to anything watching the
   * command stream — a replay recorder, a spectator, a multiplayer link — while
   * every move the AI made was visible. `CommandKind.Relocate` closes that, and
   * with it CLAUDE.md's "the AI issues the same commands the player does"
   * becomes true rather than nearly true.
   *
   * HANDLED HERE RATHER THAN IN `sim.relocate`, and the reason is a trap worth
   * writing down: `CommandBus.drain` is DESTRUCTIVE and resets the whole ring.
   * A second drainer inside Phase.Command would consume every OTHER command in
   * the same pass — every ProductionStart and PlaceBuilding that
   * `reissueParked` had just put back for Phase.Production to collect — and
   * they would vanish with no error anywhere. One drainer per phase; this is
   * it.
   *
   * The seam is the same duck-typed one the ghost commits through, and it
   * degrades the same way: with no relocate service installed this is a no-op
   * rather than a throw.
   *
   * `arg` is the facing in degrees, or -1 for "keep the current one" — the
   * encoding `RelocateService.commit` already used, so nothing below changed.
   */
  private applyRelocate(cmd: Command): void {
    relocateSeamOf()?.commit(
      cmd.player, cmd.target, cmd.cx, cmd.cz, cmd.arg < 0 ? undefined : cmd.arg,
    );
  }

  /**
   * Call a commander power. `arg` is the `CommanderPowerId`, `x`/`z` the point.
   *
   * HERE FOR THE SAME REASON `applyRelocate` IS: `CommandBus.drain` is
   * destructive, so a second drainer inside Phase.Command would swallow every
   * command `reissueParked` had just put back for Phase.Production. One drainer
   * per phase; this is it, and the power service is reached through the same
   * duck-typed seam, which degrades the same way — with no power system
   * installed this is a no-op rather than a throw.
   *
   * The seam refuses an unknown id, a charge that has not finished and a slot
   * that is not a player, so nothing here re-checks any of it. Ownership of the
   * POWER is deliberately not checked anywhere in the simulation: see the
   * determinism argument at the top of `src/sim/CommanderPowers.ts`.
   */
  private applyPower(cmd: Command): void {
    commanderPowerSeamOf()?.use(cmd.player, cmd.arg, cmd.x, cmd.z);
  }

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

      case OrderKind.Unload:
        // UNLOAD HAPPENS WHERE THE HULL STANDS, exactly as Deploy does and for
        // the identical reason: "drive there, then put them down" has to decide
        // what to do when the destination turns out to be unreachable, and
        // every answer to that either re-paths forever or drops a squad
        // somewhere the player did not ask for. So the order point is rewritten
        // to the transport's own position, which also stops an in-flight move
        // dead. State stays Idle and `sim/Transport.ts` clears the order at
        // Phase.Cleanup once the men are actually out — a refusal leaves it
        // standing, so a transport still over water unloads the moment it
        // reaches a coast.
        s.orderX[i] = s.posX[i];
        s.orderZ[i] = s.posZ[i];
        s.state[i] = UnitState.Idle;
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
    // Store where a unit can actually STAND. The overlay draws this map
    // verbatim and Production copies it into orderX/orderZ AND guardX/guardZ,
    // so a point inside a footprint is a promise the sim cannot keep:
    // NavAssigner takes the order point as the goal unchanged, Movement will
    // not put a hull centre in a blocked cell, and the arrival test can
    // therefore never fire. The unit parks metres short of the flag.
    snapRallyClear(this.world, cmd.x, cmd.z, RALLY_SNAP);
    player.rallyX.set(cmd.target as number, RALLY_SNAP[0]);
    player.rallyZ.set(cmd.target as number, RALLY_SNAP[1]);
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
    // Wrapped so everything below is stamped `reissued`. These are the SAME
    // player actions going round again for a later phase, not new ones, and a
    // recorder that cannot tell the difference logs each click three times.
    this.channels.commands.markReissue(() => { this.reissueParkedInner(); });
  }

  private reissueParkedInner(): void {
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
          // `arg` is the placement facing; dropping it would un-rotate a
          // structure just because the command was parked for one tick.
          bus.issuePlaceBuilding(p.player, p.defId, p.cx, p.cz, p.arg);
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
        case CommandKind.Relocate:
          // Handled directly in `onCommand`, so it should never be parked —
          // but this switch DROPS anything it has no case for, silently, and
          // that is how a kind disappears when somebody reorders a phase.
          bus.issueRelocate(p.player, p.target, p.cx, p.cz, p.arg);
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

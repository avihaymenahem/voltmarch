/**
 * ============================================================================
 * VOLTMARCH — src/sim/BuildQueue.ts
 * ============================================================================
 * THE FOUR QUEUES. C&C RULES, NOT STARCRAFT RULES.
 *
 * A player has exactly four production queues, one per sidebar tab, and they
 * belong to the PLAYER — not to a building. Every Barracks feeds the same
 * infantry queue; a second Barracks does not give you a second queue, it makes
 * the one queue 35% faster (FACTORY_SPEED_BONUS). Losing your last Barracks
 * does not lose the queue, it freezes it. That single decision is most of what
 * separates a Command & Conquer build loop from a Blizzard one, and it is the
 * reason `ProductionQueue` in core/types.ts is indexed by BuildTab and carries
 * a `factoryCount` rather than an owner handle.
 *
 * MONEY IS PAID BY THE DRIP, NOT UP FRONT
 * ---------------------------------------
 * `item.spent` accumulates the credits actually paid so far, and a cancel
 * refunds exactly that number — never the full cost, never a percentage. So
 * queueing a Sledge and cancelling it at 90% costs you nothing but the
 * time, which is precisely the C&C "queue as a bank" behaviour players expect.
 *
 * Because payment is per tick, a poor player does not stop — they crawl. A tick
 * that can only afford 40% of its increment advances 40% of its increment. That
 * is deliberate: with harvesters trickling in, build speed tracking income is
 * what makes a refinery feel like a build-speed upgrade. Only when the player
 * is paying literally nothing, for longer than PRODUCTION.fundsHoldGraceSeconds,
 * does the head flip to ON HOLD and EVA complain.
 *
 * WHAT THIS FILE DOES NOT KNOW
 * ----------------------------
 * Nothing about the world, entities, tech, placement or rendering. It is handed
 * a `QueueHooks` by Production.ts and talks to the game exclusively through it,
 * which is what lets the whole queue machine be unit-tested with three numbers
 * and no World at all.
 * ============================================================================
 */

import {
  FACTORY_SPEED_BONUS, FACTORY_SPEED_CAP, MAX_PLAYERS, MAX_QUEUE_DEPTH, PRODUCTION,
} from '../core/config';
import { BUILD_TAB_COUNT, UpgradeLever } from '../core/types';
import type { BuildTab, PlayerState, ProductionItem } from '../core/types';
import { upgradeGlobalMul } from './Upgrades';

/* ==========================================================================
 * 1. HOLD STATE
 *
 * `ProductionItem.onHold` is a single boolean, but the HUD needs to say WHY
 * (a paused item reads differently from a broke one) and the queue needs to
 * know whether to auto-resume. So the reason lives here, per (player, tab).
 * ========================================================================== */

export const enum HoldReason {
  /** Running normally. */
  None = 0,
  /** The player clicked pause. Only the player can clear this. */
  Player = 1,
  /** Nothing was paid for longer than the grace window. Clears itself. */
  Funds = 2,
  /** Every factory servicing this tab is dead or still under construction. */
  NoFactory = 3,
  /** A finished structure is sitting on the cursor waiting to be planted. */
  AwaitingPlacement = 4,
}

/** Human-readable, for the HUD tooltip and the debug overlay. */
export const HOLD_REASON_TEXT: readonly string[] = [
  '',
  'On hold',
  'Insufficient funds',
  'No factory',
  'Ready — choose a location',
];

/* ==========================================================================
 * 2. THE HOST INTERFACE
 * ========================================================================== */

/** The only two numbers the queue needs about a buildable. */
export interface QueueItemInfo {
  readonly cost: number;
  /** Seconds at full power with exactly one factory. */
  readonly buildTime: number;
}

/**
 * Everything the queue asks of the game. Implemented by ProductionService.
 * Every callback is optional-free on purpose: a silently missing notification
 * is a HUD that never updates, and that bug is invisible in code review.
 */
export interface QueueHooks {
  /** Static content lookup. Null cancels the item as unbuildable. */
  info(player: PlayerState, defId: number, isBuilding: boolean): QueueItemInfo | null;
  /** Deduct up to `amount` credits. Returns what was actually taken. */
  charge(player: PlayerState, amount: number): number;
  /** Hand credits back (cancel, or a refused item). */
  refund(player: PlayerState, amount: number): void;

  started(player: PlayerState, tab: BuildTab, item: ProductionItem): void;
  progressed(player: PlayerState, tab: BuildTab, item: ProductionItem): void;
  /** progress hit 1. For a unit: egress it. For a structure: hand it to placement. */
  ready(player: PlayerState, tab: BuildTab, item: ProductionItem): void;
  cancelled(player: PlayerState, tab: BuildTab, item: ProductionItem, refunded: number): void;
  holdChanged(player: PlayerState, tab: BuildTab, reason: HoldReason): void;
}

/* ==========================================================================
 * 3. THE QUEUE MACHINE
 * ========================================================================== */

/** Speed multiplier from N factories servicing one tab. */
export function factorySpeed(factoryCount: number): number {
  if (factoryCount <= 1) return 1;
  return Math.min(FACTORY_SPEED_CAP, 1 + FACTORY_SPEED_BONUS * (factoryCount - 1));
}

/**
 * Progress-per-second multiplier for one production tab under its live power,
 * factory-count and upgrade state.
 *
 * The HUD reads this same derivation so an authored 8-second build in a total
 * blackout is presented as the roughly 32-second build the queue will deliver.
 */
export function effectiveBuildRate(player: PlayerState, factoryCount: number): number {
  return Math.max(0.05, player.buildSpeedMul)
    * factorySpeed(factoryCount)
    * upgradeGlobalMul(player, UpgradeLever.BuildSpeed);
}

/** Flat index into the per-(player, tab) side arrays. */
function slotOf(player: PlayerState, tab: BuildTab): number {
  return (player.id as number) * BUILD_TAB_COUNT + (tab as number);
}

/**
 * Owns the four queues of every player. One instance per match, held by
 * ProductionService.
 */
export class BuildQueues {
  /** HoldReason per (player, tab). */
  private readonly hold = new Uint8Array(MAX_PLAYERS * BUILD_TAB_COUNT);
  /** Seconds the head has been paying nothing, per (player, tab). */
  private readonly starve = new Float32Array(MAX_PLAYERS * BUILD_TAB_COUNT);
  /**
   * Recycled ProductionItem structs. A queue churns a few items a second for a
   * whole match; without a pool that is a few thousand short-lived objects and
   * a GC saw-tooth over a 20 minute soak.
   */
  private readonly pool: ProductionItem[] = [];

  /**
   * Queue depth per player. Production keeps this at the authored cap in every
   * release build; the development Cheat Engine may raise only the local
   * player's slot so a load test can stage a very large batch without changing
   * AI behaviour or the rules seen by another player.
   */
  private readonly depthLimit = new Uint16Array(MAX_PLAYERS).fill(MAX_QUEUE_DEPTH);

  constructor(private readonly hooks: QueueHooks) {}

  /* -- queries ----------------------------------------------------------- */

  /** The item currently being built, or null. */
  head(player: PlayerState, tab: BuildTab): ProductionItem | null {
    const items = player.queues[tab as number].items;
    return items.length > 0 ? items[0] : null;
  }

  depth(player: PlayerState, tab: BuildTab): number {
    return player.queues[tab as number].items.length;
  }

  /** How many of one def are queued, including the one being built. */
  countOf(player: PlayerState, tab: BuildTab, defId: number, isBuilding: boolean): number {
    const items = player.queues[tab as number].items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].defId === defId && items[i].isBuilding === isBuilding) n++;
    }
    return n;
  }

  holdReason(player: PlayerState, tab: BuildTab): HoldReason {
    return this.hold[slotOf(player, tab)] as HoldReason;
  }

  isPaused(player: PlayerState, tab: BuildTab): boolean {
    return this.hold[slotOf(player, tab)] === HoldReason.Player;
  }

  /** Development seam owned by ProductionService; normal callers never need it. */
  setDepthLimit(player: PlayerState, limit: number): void {
    this.depthLimit[player.id as number] = Math.max(1, Math.min(4096, limit | 0));
  }

  /* -- mutation ---------------------------------------------------------- */

  /**
   * Append `count` copies of a buildable. Returns how many were actually
   * queued — fewer than asked when the queue hits MAX_QUEUE_DEPTH, zero when
   * the def is unknown.
   *
   * Nothing is charged here. The first tick of `advance` starts paying.
   */
  enqueue(
    player: PlayerState,
    tab: BuildTab,
    defId: number,
    isBuilding: boolean,
    count = 1,
  ): number {
    const info = this.hooks.info(player, defId, isBuilding);
    if (info === null) return 0;
    const q = player.queues[tab as number];
    let added = 0;
    for (let n = 0; n < count; n++) {
      if (q.items.length >= this.depthLimit[player.id as number]) break;
      const item = this.take();
      item.defId = defId;
      item.isBuilding = isBuilding;
      item.progress = 0;
      item.spent = 0;
      item.cost = info.cost;
      item.ready = false;
      item.onHold = false;
      q.items.push(item);
      added++;
      // Only the head is "started" — the rest are just waiting in line, and a
      // HUD that announced five simultaneous starts would be lying.
      if (q.items.length === 1) {
        this.clearHold(player, tab);
        this.hooks.started(player, tab, item);
      }
    }
    return added;
  }

  /**
   * Remove one item and refund exactly what it cost so far.
   * `slot` -1 cancels the LAST matching item, which is what a right-click on a
   * cameo means: you are undoing your most recent click, not destroying the
   * thing that is 95% built.
   */
  cancel(player: PlayerState, tab: BuildTab, defId: number, slot = -1): boolean {
    const q = player.queues[tab as number];
    const items = q.items;
    let index = -1;
    if (slot >= 0) {
      if (slot < items.length && (defId < 0 || items[slot].defId === defId)) index = slot;
    } else {
      for (let i = items.length - 1; i >= 0; i--) {
        if (defId < 0 || items[i].defId === defId) { index = i; break; }
      }
    }
    if (index < 0) return false;

    const item = items[index];
    const refunded = item.spent;
    items.splice(index, 1);
    if (refunded > 0) this.hooks.refund(player, refunded);
    this.hooks.cancelled(player, tab, item, refunded);

    if (index === 0) {
      // The head died: whatever was blocking it is no longer relevant, and the
      // structure that was waiting to be planted is gone with it.
      q.awaitingPlacement = false;
      this.clearHold(player, tab);
      this.starve[slotOf(player, tab)] = 0;
      const next = items.length > 0 ? items[0] : null;
      if (next !== null) this.hooks.started(player, tab, next);
    }
    this.release(item);
    return true;
  }

  /** Cancel everything in a tab, refunding each item. Used on defeat/teardown. */
  cancelAll(player: PlayerState, tab: BuildTab): number {
    let n = 0;
    while (this.cancel(player, tab, -1, player.queues[tab as number].items.length - 1)) n++;
    return n;
  }

  /**
   * Player pause/resume of the head. A funds hold is NOT a pause: resuming
   * something the bank refused would just re-hold it next tick, so resume only
   * clears a Player hold.
   */
  setPaused(player: PlayerState, tab: BuildTab, paused: boolean): void {
    const s = slotOf(player, tab);
    const current = this.hold[s] as HoldReason;
    if (paused) {
      if (current === HoldReason.AwaitingPlacement) return;
      if (current === HoldReason.Player) return;
      this.setHold(player, tab, HoldReason.Player);
    } else {
      if (current !== HoldReason.Player) return;
      this.clearHold(player, tab);
      this.starve[s] = 0;
    }
  }

  /**
   * Drop the head. Called by Production once a ready item has actually left:
   * the vehicle drove out, or the structure was planted.
   */
  completeHead(player: PlayerState, tab: BuildTab): ProductionItem | null {
    const q = player.queues[tab as number];
    if (q.items.length === 0) return null;
    const item = q.items.shift()!;
    q.awaitingPlacement = false;
    this.clearHold(player, tab);
    this.starve[slotOf(player, tab)] = 0;
    if (q.items.length > 0) this.hooks.started(player, tab, q.items[0]);
    this.release(item);
    return item;
  }

  /** Wipe every queue of a player (match reset, defeat). No refunds. */
  reset(player: PlayerState): void {
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const q = player.queues[t];
      for (let i = 0; i < q.items.length; i++) this.release(q.items[i]);
      q.items.length = 0;
      q.awaitingPlacement = false;
      this.hold[slotOf(player, t as BuildTab)] = HoldReason.None;
      this.starve[slotOf(player, t as BuildTab)] = 0;
    }
  }

  /* -- the tick ---------------------------------------------------------- */

  /**
   * Advance all four queues of one player by `dt` seconds.
   * `progressTick` is true on the ticks where a `production:progress` event is
   * allowed out (throttled to HUD rate by the caller).
   */
  advance(player: PlayerState, dt: number, progressTick: boolean): void {
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      this.advanceTab(player, t as BuildTab, dt, progressTick);
    }
  }

  private advanceTab(
    player: PlayerState,
    tab: BuildTab,
    dt: number,
    progressTick: boolean,
  ): void {
    const q = player.queues[tab as number];
    const item = q.items.length > 0 ? q.items[0] : null;
    const s = slotOf(player, tab);

    if (item === null) {
      if (this.hold[s] !== HoldReason.None) this.setHold(player, tab, HoldReason.None);
      this.starve[s] = 0;
      return;
    }

    // A finished item is not a stalled item. It is waiting on the player (place
    // it) or on the world (clear the factory door), and neither is this file's
    // problem.
    if (item.ready) {
      const reason = item.isBuilding ? HoldReason.AwaitingPlacement : HoldReason.None;
      if (this.hold[s] !== reason) this.setHold(player, tab, reason);
      item.onHold = item.isBuilding;
      return;
    }

    if (this.hold[s] === HoldReason.Player) {
      item.onHold = true;
      return;
    }

    if (q.factoryCount <= 0) {
      if (this.hold[s] !== HoldReason.NoFactory) this.setHold(player, tab, HoldReason.NoFactory);
      item.onHold = true;
      return;
    }

    const info = this.hooks.info(player, item.defId, item.isBuilding);
    if (info === null || info.buildTime <= 0) {
      // Content vanished under us (a def table swap between matches). Refund
      // and drop rather than dividing by zero forever.
      this.cancel(player, tab, item.defId, 0);
      return;
    }

    // Three independent speed terms, and they are three because they mean three
    // different things: the power supply (written every tick by `Power.ts`, so
    // it can never be pre-multiplied into anything), the factory count, and the
    // upgrade the player bought. The clamp stays on the POWER term alone —
    // config's "Never zero, that is a soft lock" is about a blackout, and an
    // upgrade multiplier is never below 1.
    const speed = effectiveBuildRate(player, q.factoryCount);
    let dProgress = (dt * speed) / info.buildTime;
    const remaining = 1 - item.progress;
    if (dProgress > remaining) dProgress = remaining;

    // Charge for exactly the slice we are about to build, and build only the
    // slice we managed to pay for.
    const want = item.cost * dProgress;
    const paid = want > 0 ? this.hooks.charge(player, want) : 0;
    const fraction = want > 0 ? paid / want : 1;

    if (want > 0 && paid <= 0) {
      this.starve[s] += dt;
      if (this.starve[s] >= PRODUCTION.fundsHoldGraceSeconds) {
        if (this.hold[s] !== HoldReason.Funds) this.setHold(player, tab, HoldReason.Funds);
        item.onHold = true;
      }
      return;
    }

    // Any real payment clears the stall, including a partial one.
    if (fraction > 0.999) this.starve[s] = 0;
    else this.starve[s] = Math.max(0, this.starve[s] - dt);
    if (this.hold[s] === HoldReason.Funds || this.hold[s] === HoldReason.NoFactory) {
      this.clearHold(player, tab);
    }
    item.onHold = false;

    item.spent += paid;
    item.progress += dProgress * fraction;

    if (item.progress >= 1 - 1e-6) {
      item.progress = 1;
      item.ready = true;
      if (item.isBuilding) {
        q.awaitingPlacement = true;
        this.setHold(player, tab, HoldReason.AwaitingPlacement);
        item.onHold = true;
      }
      this.hooks.ready(player, tab, item);
    } else if (progressTick) {
      this.hooks.progressed(player, tab, item);
    }
  }

  /* -- internals --------------------------------------------------------- */

  private setHold(player: PlayerState, tab: BuildTab, reason: HoldReason): void {
    const s = slotOf(player, tab);
    if (this.hold[s] === reason) return;
    this.hold[s] = reason;
    this.hooks.holdChanged(player, tab, reason);
  }

  private clearHold(player: PlayerState, tab: BuildTab): void {
    this.setHold(player, tab, HoldReason.None);
  }

  private take(): ProductionItem {
    const item = this.pool.pop();
    if (item !== undefined) return item;
    return { defId: -1, isBuilding: false, progress: 0, spent: 0, cost: 0, ready: false, onHold: false };
  }

  private release(item: ProductionItem): void {
    // Bounded: a pool bigger than every queue on the map can ever be is a leak
    // in slow motion.
    if (this.pool.length >= MAX_PLAYERS * BUILD_TAB_COUNT * MAX_QUEUE_DEPTH) return;
    item.defId = -1;
    item.progress = 0;
    item.spent = 0;
    item.cost = 0;
    item.ready = false;
    item.onHold = false;
    this.pool.push(item);
  }
}

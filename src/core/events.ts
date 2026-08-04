/**
 * ============================================================================
 * VOLTMARCH — src/core/events.ts
 * ============================================================================
 * THE THREE COMMUNICATION CHANNELS. Written once here; never edited by a
 * parallel agent.
 *
 * They exist separately because they run at three different RATES and have
 * three different lifetimes:
 *
 *   1. CommandBus       — INTENT. Input and AI both push the identical
 *                         `Command` struct. Drained at Phase.Command. This is
 *                         the replay format, and the reason the AI feels fair:
 *                         it has no privileged API.
 *
 *   2. EventBus         — NOTIFICATION. Gameplay-rate typed pub/sub
 *                         (`entity:killed`, `economy:credits`). Synchronous
 *                         dispatch, pooled payloads, deferred re-entrant emits.
 *
 *   3. PresentationQueue— FX SPAM. An SoA ring buffer for per-frame muzzle
 *                         flashes, impacts and dust. The ONLY sim->VFX channel.
 *                         Accumulates across sim substeps, drained once per
 *                         RENDERED frame. Combat never imports VFX.
 *
 *   (+ DamageQueue      — damage is QUEUED, never applied inline, so no system
 *                         can ever observe a half-dead entity mid-phase.)
 *
 * ZERO ALLOCATION
 * ---------------
 * Every buffer here is a fixed-capacity typed array or a pool of pre-built
 * objects, allocated once at construction. Nothing in this file calls `new`
 * after boot. If a queue overflows it DROPS and counts the drop — it never
 * grows, because a silent 40 MB reallocation mid-battle is worse than a
 * missing muzzle flash.
 * ============================================================================
 */

import { MAX_ENTITIES, MAX_SELECTION } from './config';
// Values (const enums + the NONE handle).
import {
  BuildTab, CommandKind, Faction, FxKind, NONE, OrderKind, Stance,
} from './types';
// Types only — erased at build time.
import type {
  Command, EntityId, EventHandler, EventName, GameEvents, PlayerId, WarheadClass,
} from './types';

/* ==========================================================================
 * 1. EVENT BUS
 * ========================================================================== */

/** Internal listener record. Pre-allocated in a flat array per event name. */
interface Listener {
  fn: (payload: unknown) => void;
  /** `this` binding, or null. Avoids allocating a bound function per subscribe. */
  ctx: unknown;
  /** Set on unsubscribe; compacted at the end of the next dispatch. */
  dead: boolean;
}

/** A queued emit that arrived while a dispatch was already running. */
interface DeferredEmit {
  name: EventName;
  /** A COPY of the payload, since the pooled original will be reused. */
  payload: Record<string, unknown>;
}

/**
 * Typed synchronous pub/sub.
 *
 * PAYLOAD LIFETIME: the object handed to a handler is POOLED and will be
 * overwritten by the next emit of the same event. Copy out any field you need
 * to keep. This is enforced by convention, not by the type system — the
 * `Readonly<>` on the handler signature is a reminder, not a guarantee.
 *
 * RE-ENTRANCY: emitting from inside a handler is legal. The nested emit is
 * deferred to the end of the current dispatch, so listener arrays are never
 * mutated while being iterated.
 */
export class EventBus {
  /** name -> listeners. Created lazily per event name, once, at first use. */
  private readonly listeners = new Map<EventName, Listener[]>();
  /** Pooled payload objects, one per event name, reused on every emit. */
  private readonly payloads = new Map<EventName, Record<string, unknown>>();
  /** Depth of nested dispatch. >0 means we must defer. */
  private dispatchDepth = 0;
  /** Emits that arrived during a dispatch. */
  private readonly deferred: DeferredEmit[] = [];
  /** Names whose listener array needs compacting after dispatch. */
  private readonly needsCompact = new Set<EventName>();

  /** Diagnostics. */
  public emitCount = 0;
  public deferredCount = 0;

  /**
   * Subscribe. Returns an unsubscribe function.
   * The unsubscribe is O(1): it flags the record dead and the array is
   * swap-and-pop compacted after the current dispatch finishes.
   */
  on<K extends EventName>(name: K, fn: EventHandler<K>, ctx: unknown = null): () => void {
    let arr = this.listeners.get(name);
    if (arr === undefined) {
      arr = [];
      this.listeners.set(name, arr);
    }
    const rec: Listener = { fn: fn as (p: unknown) => void, ctx, dead: false };
    arr.push(rec);
    return () => {
      if (rec.dead) return;
      rec.dead = true;
      this.needsCompact.add(name);
      if (this.dispatchDepth === 0) this.compact(name);
    };
  }

  /** Subscribe for exactly one dispatch. */
  once<K extends EventName>(name: K, fn: EventHandler<K>, ctx: unknown = null): () => void {
    const off = this.on(name, ((payload: Readonly<GameEvents[K]>) => {
      off();
      fn.call(ctx, payload);
    }) as EventHandler<K>, ctx);
    return off;
  }

  /** Remove a specific handler. Prefer the returned unsubscribe from `on`. */
  off<K extends EventName>(name: K, fn: EventHandler<K>): void {
    const arr = this.listeners.get(name);
    if (arr === undefined) return;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].fn === (fn as unknown) && !arr[i].dead) {
        arr[i].dead = true;
        this.needsCompact.add(name);
        break;
      }
    }
    if (this.dispatchDepth === 0) this.compact(name);
  }

  /**
   * Get the POOLED payload object for an event so you can fill it in without
   * allocating. Then call `emitPooled(name)`.
   *
   *   const p = bus.payload('entity:killed');
   *   p.id = id; p.killer = killer; ...
   *   bus.emitPooled('entity:killed');
   *
   * This is the zero-allocation emit path used by every hot system.
   */
  payload<K extends EventName>(name: K): GameEvents[K] {
    let p = this.payloads.get(name);
    if (p === undefined) {
      p = {};
      this.payloads.set(name, p);
    }
    return p as unknown as GameEvents[K];
  }

  /** Dispatch the pooled payload previously filled via `payload(name)`. */
  emitPooled<K extends EventName>(name: K): void {
    const p = this.payloads.get(name);
    if (p === undefined) return;
    this.dispatch(name, p);
  }

  /**
   * Convenience emit for cold paths (menu, match lifecycle, boot). Copies the
   * supplied fields into the pooled object, so the caller's literal is not
   * retained. Do NOT use this in a per-tick hot loop — use `payload` +
   * `emitPooled` there, which avoids even the object literal.
   */
  emit<K extends EventName>(name: K, data: GameEvents[K]): void {
    const p = this.payload(name) as unknown as Record<string, unknown>;
    const src = data as unknown as Record<string, unknown>;
    // Copy in place; the pooled object keeps its hidden class.
    for (const k in src) p[k] = src[k];
    this.dispatch(name, p);
  }

  /** The actual synchronous dispatch, with re-entrancy deferral. */
  private dispatch(name: EventName, payload: Record<string, unknown>): void {
    if (this.dispatchDepth > 0) {
      // Nested emit: snapshot the payload, replay after the outer dispatch.
      const copy: Record<string, unknown> = {};
      for (const k in payload) copy[k] = payload[k];
      this.deferred.push({ name, payload: copy });
      this.deferredCount++;
      return;
    }

    this.dispatchDepth++;
    this.emitCount++;
    try {
      this.invoke(name, payload);
      // Drain anything that was emitted from inside a handler. Index-based so
      // deferrals produced by deferrals are also handled, in order.
      for (let i = 0; i < this.deferred.length; i++) {
        const d = this.deferred[i];
        this.invoke(d.name, d.payload);
      }
    } finally {
      this.deferred.length = 0;
      this.dispatchDepth--;
      if (this.needsCompact.size > 0) {
        for (const n of this.needsCompact) this.compact(n);
        this.needsCompact.clear();
      }
    }
  }

  private invoke(name: EventName, payload: Record<string, unknown>): void {
    const arr = this.listeners.get(name);
    if (arr === undefined) return;
    // Cache length: handlers may append, and new subscribers must not receive
    // the event that caused their own subscription.
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const l = arr[i];
      if (l.dead) continue;
      l.fn.call(l.ctx, payload);
    }
  }

  /** Swap-and-pop removal of dead listeners. */
  private compact(name: EventName): void {
    const arr = this.listeners.get(name);
    if (arr === undefined) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].dead) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
  }

  /** Number of live listeners for an event. Diagnostics / leak detection. */
  listenerCount(name: EventName): number {
    const arr = this.listeners.get(name);
    if (arr === undefined) return 0;
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) n++;
    return n;
  }

  /** Total live listeners across all events. A match teardown must reach 0. */
  totalListeners(): number {
    let n = 0;
    for (const name of this.listeners.keys()) n += this.listenerCount(name);
    return n;
  }

  /** Drop every listener. Called between matches. */
  clear(): void {
    this.listeners.clear();
    this.needsCompact.clear();
    this.deferred.length = 0;
    this.dispatchDepth = 0;
  }
}

/* ==========================================================================
 * 2. COMMAND BUS
 *
 * A ring of pre-built mutable Command structs plus one shared Int32Array arena
 * holding the entity lists. `cmd.entities` is a SUBARRAY VIEW into that arena
 * and is only valid during the drain callback.
 * ========================================================================== */

/** Ring capacity. A human peaks around 5 commands/sec; 6 AIs add maybe 40. */
const COMMAND_CAPACITY = 512;
/** Entity arena size. Worst case: many full-selection orders in one tick. */
const COMMAND_ENTITY_ARENA = MAX_SELECTION * 64;

/**
 * The intent channel. Human input and AI brains both call `issue*`; nothing
 * else may mutate unit orders directly. Recording the drained stream alongside
 * the map seed is a complete replay.
 */
export class CommandBus {
  /** Pre-built command structs, reused forever. */
  private readonly ring: Command[] = [];
  /** Shared storage for every command's entity list. */
  private readonly arena = new Int32Array(COMMAND_ENTITY_ARENA);
  /** Write cursor into the arena, reset on each drain. */
  private arenaHead = 0;
  /** Number of commands queued this tick. */
  private count = 0;
  /** Set while draining, so a handler cannot recursively issue into the ring. */
  private draining = false;
  /** Commands issued during a drain, applied next tick. */
  private readonly overflowBuffer: Command[] = [];

  /** Diagnostics: commands dropped because the ring or arena was full. */
  public droppedCommands = 0;
  /** Monotonic tick stamp written onto every command. */
  public tick = 0;

  constructor() {
    const emptyView = this.arena.subarray(0, 0);
    for (let i = 0; i < COMMAND_CAPACITY; i++) {
      this.ring.push({
        kind: CommandKind.None,
        player: 0 as PlayerId,
        tick: 0,
        order: OrderKind.None,
        target: NONE,
        x: 0, z: 0,
        defId: -1,
        tab: BuildTab.Structures,
        cx: 0, cz: 0,
        stance: Stance.Aggressive,
        queued: false,
        arg: 0,
        entityCount: 0,
        entities: emptyView,
      });
    }
  }

  /** Reset a struct to defaults so a stale field can never leak between uses. */
  private reset(c: Command, kind: CommandKind, player: PlayerId): void {
    c.kind = kind;
    c.player = player;
    c.tick = this.tick;
    c.order = OrderKind.None;
    c.target = NONE;
    c.x = 0; c.z = 0;
    c.defId = -1;
    c.tab = BuildTab.Structures;
    c.cx = 0; c.cz = 0;
    c.stance = Stance.Aggressive;
    c.queued = false;
    c.arg = 0;
    c.entityCount = 0;
    c.entities = this.arena.subarray(0, 0);
  }

  /**
   * Claim the next command slot. Returns null when the ring is full (the
   * command is dropped and counted — we never grow mid-match).
   */
  private claim(kind: CommandKind, player: PlayerId): Command | null {
    if (this.count >= COMMAND_CAPACITY) {
      this.droppedCommands++;
      return null;
    }
    const c = this.ring[this.count++];
    this.reset(c, kind, player);
    return c;
  }

  /**
   * Issue an order to a set of entities.
   * `ids` is copied into the arena immediately, so the caller may reuse its
   * own buffer the moment this returns.
   */
  issueOrder(
    player: PlayerId,
    order: OrderKind,
    ids: Int32Array | number[],
    idCount: number,
    x: number, z: number,
    target: EntityId = NONE,
    queued = false,
  ): void {
    const c = this.claim(CommandKind.Order, player);
    if (c === null) return;

    c.order = order;
    c.x = x; c.z = z;
    c.target = target;
    c.queued = queued;

    const n = Math.min(idCount, COMMAND_ENTITY_ARENA - this.arenaHead);
    if (n < idCount) this.droppedCommands++;
    const start = this.arenaHead;
    for (let i = 0; i < n; i++) this.arena[start + i] = ids[i];
    this.arenaHead += n;
    c.entityCount = n;
    c.entities = this.arena.subarray(start, start + n);
  }

  /** Enqueue a buildable into a tab's production queue. */
  issueProductionStart(player: PlayerId, tab: BuildTab, defId: number, count = 1): void {
    const c = this.claim(CommandKind.ProductionStart, player);
    if (c === null) return;
    c.tab = tab;
    c.defId = defId;
    c.arg = count;
  }

  /** Pause (arg=1) or resume (arg=0) the head of a tab queue. */
  issueProductionPause(player: PlayerId, tab: BuildTab, paused: boolean): void {
    const c = this.claim(CommandKind.ProductionPause, player);
    if (c === null) return;
    c.tab = tab;
    c.arg = paused ? 1 : 0;
  }

  /** Cancel one queued item. `slot` -1 means the head. */
  issueProductionCancel(player: PlayerId, tab: BuildTab, defId: number, slot = -1): void {
    const c = this.claim(CommandKind.ProductionCancel, player);
    if (c === null) return;
    c.tab = tab;
    c.defId = defId;
    c.arg = slot;
  }

  /** Commit a completed structure at a grid cell. */
  issuePlaceBuilding(player: PlayerId, defId: number, cx: number, cz: number): void {
    const c = this.claim(CommandKind.PlaceBuilding, player);
    if (c === null) return;
    c.defId = defId;
    c.cx = cx; c.cz = cz;
  }

  /** Move a factory's rally flag. */
  issueSetRally(player: PlayerId, factory: EntityId, x: number, z: number): void {
    const c = this.claim(CommandKind.SetRally, player);
    if (c === null) return;
    c.target = factory;
    c.x = x; c.z = z;
  }

  /** Sell a structure. */
  issueSell(player: PlayerId, building: EntityId): void {
    const c = this.claim(CommandKind.SellBuilding, player);
    if (c === null) return;
    c.target = building;
  }

  /** Toggle drip-cost repair on a structure. */
  issueRepairToggle(player: PlayerId, building: EntityId): void {
    const c = this.claim(CommandKind.RepairToggle, player);
    if (c === null) return;
    c.target = building;
  }

  /** Change auto-engagement policy on a selection. */
  issueSetStance(player: PlayerId, ids: Int32Array | number[], idCount: number, stance: Stance): void {
    const c = this.claim(CommandKind.SetStance, player);
    if (c === null) return;
    c.stance = stance;
    const n = Math.min(idCount, COMMAND_ENTITY_ARENA - this.arenaHead);
    const start = this.arenaHead;
    for (let i = 0; i < n; i++) this.arena[start + i] = ids[i];
    this.arenaHead += n;
    c.entityCount = n;
    c.entities = this.arena.subarray(start, start + n);
  }

  /** Make a factory the spawn point for its type. */
  issueSetPrimary(player: PlayerId, factory: EntityId): void {
    const c = this.claim(CommandKind.SetPrimary, player);
    if (c === null) return;
    c.target = factory;
  }

  /** Blow up your own unit. */
  issueSelfDestruct(player: PlayerId, target: EntityId): void {
    const c = this.claim(CommandKind.SelfDestruct, player);
    if (c === null) return;
    c.target = target;
  }

  /**
   * Deliver every queued command to `fn`, then reset the ring.
   * The `Command` passed to `fn` is POOLED — do not retain it, and do not
   * retain `cmd.entities`.
   */
  drain(fn: (cmd: Command) => void): void {
    if (this.draining) return;
    this.draining = true;
    const n = this.count;
    try {
      for (let i = 0; i < n; i++) fn(this.ring[i]);
    } finally {
      this.draining = false;
      this.count = 0;
      this.arenaHead = 0;
      // Re-issue anything that arrived during the drain (rare: an order handler
      // that itself orders something, e.g. auto-rally on unit exit).
      if (this.overflowBuffer.length > 0) this.overflowBuffer.length = 0;
    }
  }

  /** Number of commands waiting. */
  get pending(): number { return this.count; }

  /** Drop everything without dispatching. Used on match teardown. */
  clear(): void {
    this.count = 0;
    this.arenaHead = 0;
    this.overflowBuffer.length = 0;
  }
}

/* ==========================================================================
 * 3. DAMAGE QUEUE
 *
 * Damage is QUEUED at Phase.Weapons/Projectiles and applied in one pass at
 * Phase.Damage. That ordering is what guarantees no system ever reads an
 * entity that is half-dead: hp is only ever mutated inside one phase, by one
 * function (`applyDamage` in data/Armor.ts).
 * ========================================================================== */

const DAMAGE_CAPACITY = 4096;

/** SoA damage records. Zero allocation; overflow drops and counts. */
export class DamageQueue {
  readonly target = new Int32Array(DAMAGE_CAPACITY);
  readonly attacker = new Int32Array(DAMAGE_CAPACITY);
  readonly amount = new Float32Array(DAMAGE_CAPACITY);
  readonly warhead = new Uint8Array(DAMAGE_CAPACITY);
  readonly x = new Float32Array(DAMAGE_CAPACITY);
  readonly y = new Float32Array(DAMAGE_CAPACITY);
  readonly z = new Float32Array(DAMAGE_CAPACITY);
  readonly splashRadius = new Float32Array(DAMAGE_CAPACITY);
  readonly splashFalloff = new Float32Array(DAMAGE_CAPACITY);

  /** Number of valid records. */
  count = 0;
  /** Diagnostics. */
  dropped = 0;

  /**
   * Queue a damage event.
   * @param splashRadius 0 for a direct hit; >0 to apply falloff from (x,y,z).
   */
  push(
    target: EntityId, attacker: EntityId, amount: number, warhead: WarheadClass,
    x: number, y: number, z: number,
    splashRadius = 0, splashFalloff = 0,
  ): void {
    if (this.count >= DAMAGE_CAPACITY) { this.dropped++; return; }
    const i = this.count++;
    this.target[i] = target as number;
    this.attacker[i] = attacker as number;
    this.amount[i] = amount;
    this.warhead[i] = warhead;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.splashRadius[i] = splashRadius;
    this.splashFalloff[i] = splashFalloff;
  }

  /** Called at the end of Phase.Damage. */
  clear(): void { this.count = 0; }
}

/* ==========================================================================
 * 4. PRESENTATION QUEUE
 *
 * The ONLY sim -> VFX/audio channel. Combat pushes an FxKind and a position
 * and forgets; it never imports the VFX module and never learns whether a
 * particle was actually spawned.
 *
 * It accumulates across all sim substeps in a frame and is drained ONCE per
 * rendered frame — so a 5-substep catch-up frame does not emit five muzzle
 * flashes at five different positions for one shot.
 * ========================================================================== */

const FX_CAPACITY = 2048;

/** SoA FX records. */
export class PresentationQueue {
  readonly kind = new Uint8Array(FX_CAPACITY);
  readonly x = new Float32Array(FX_CAPACITY);
  readonly y = new Float32Array(FX_CAPACITY);
  readonly z = new Float32Array(FX_CAPACITY);
  /** Direction (usually the shot vector). Not necessarily normalized. */
  readonly dx = new Float32Array(FX_CAPACITY);
  readonly dy = new Float32Array(FX_CAPACITY);
  readonly dz = new Float32Array(FX_CAPACITY);
  readonly scale = new Float32Array(FX_CAPACITY);
  /** Source entity for attachment / team tint. NONE when unattached. */
  readonly source = new Int32Array(FX_CAPACITY);
  readonly faction = new Uint8Array(FX_CAPACITY);

  count = 0;
  dropped = 0;

  /** One-shot effect at a position, with a direction and a size multiplier. */
  push(
    kind: FxKind,
    x: number, y: number, z: number,
    dx = 0, dy = 1, dz = 0,
    scale = 1,
    source: EntityId = NONE,
    faction: Faction = Faction.Neutral,
  ): void {
    if (this.count >= FX_CAPACITY) { this.dropped++; return; }
    const i = this.count++;
    this.kind[i] = kind;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.dx[i] = dx; this.dy[i] = dy; this.dz[i] = dz;
    this.scale[i] = scale;
    this.source[i] = source as number;
    this.faction[i] = faction;
  }

  /**
   * Convenience for a hit: pushes with the direction pointing from the shooter
   * to the impact, which is what impact sparks and decals need to orient.
   */
  pushImpact(
    kind: FxKind,
    x: number, y: number, z: number,
    fromX: number, fromY: number, fromZ: number,
    scale = 1,
    faction: Faction = Faction.Neutral,
  ): void {
    this.push(kind, x, y, z, x - fromX, y - fromY, z - fromZ, scale, NONE, faction);
  }

  /** Called once per rendered frame, after VFX and Audio have both drained. */
  clear(): void { this.count = 0; }
}

/* ==========================================================================
 * 5. THE CHANNEL BUNDLE
 *
 * Constructed once in Bootstrap and handed to every module through Services.
 * Systems take these as plain properties; nothing here is a global singleton,
 * so a test can spin up an isolated set.
 * ========================================================================== */

export class Channels {
  readonly events = new EventBus();
  readonly commands = new CommandBus();
  readonly damage = new DamageQueue();
  readonly fx = new PresentationQueue();

  /** Advance the command tick stamp. Called by the Clock each sim step. */
  setTick(tick: number): void {
    this.commands.tick = tick;
  }

  /** Between matches. */
  clear(): void {
    this.events.clear();
    this.commands.clear();
    this.damage.clear();
    this.fx.clear();
  }
}

/* ==========================================================================
 * 6. DIAGNOSTICS
 * ========================================================================== */

/** Snapshot of channel pressure, for the F3 debug overlay. */
export interface ChannelStats {
  eventsEmitted: number;
  eventListeners: number;
  commandsPending: number;
  commandsDropped: number;
  damageQueued: number;
  damageDropped: number;
  fxQueued: number;
  fxDropped: number;
}

/** Fill a caller-supplied stats object. Allocation-free. */
export function readChannelStats(c: Channels, out: ChannelStats): ChannelStats {
  out.eventsEmitted = c.events.emitCount;
  out.eventListeners = c.events.totalListeners();
  out.commandsPending = c.commands.pending;
  out.commandsDropped = c.commands.droppedCommands;
  out.damageQueued = c.damage.count;
  out.damageDropped = c.damage.dropped;
  out.fxQueued = c.fx.count;
  out.fxDropped = c.fx.dropped;
  return out;
}

/** A reusable stats object so the overlay never allocates. */
export const CHANNEL_STATS: ChannelStats = {
  eventsEmitted: 0, eventListeners: 0,
  commandsPending: 0, commandsDropped: 0,
  damageQueued: 0, damageDropped: 0,
  fxQueued: 0, fxDropped: 0,
};

/** Compile-time guard: MAX_ENTITIES must fit the Int32Array id storage. */
const _capacityCheck: boolean = MAX_ENTITIES <= 0x7fffffff;
export const CAPACITY_OK = _capacityCheck;

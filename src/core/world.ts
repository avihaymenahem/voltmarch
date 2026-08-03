/**
 * ============================================================================
 * RED ALERT — src/core/world.ts
 * ============================================================================
 * THE ENTITY STORE, THE SPATIAL INDEX, AND THE WORLD BUNDLE.
 *
 * LAYOUT: STRUCTURE OF ARRAYS, FIXED CAPACITY, ALLOCATED ONCE.
 * -----------------------------------------------------------
 * ~55 parallel typed arrays x 4096 slots, about 1.1 MB, allocated at
 * construction and never resized. This is the layout because:
 *   - A movement pass touching posX/posZ/velX/velZ streams four contiguous
 *     arrays instead of chasing 200 pointers through the heap.
 *   - The render bridge can read the prev and cur columns and interpolate
 *     without any per-entity object at all.
 *   - Nothing allocates during a match, so the heap stays flat and there is no
 *     GC pause in the frame loop.
 *
 * HANDLES: `[gen:12][index:20]`, 0 is never valid, generations start at 1.
 * A handle held across a death resolves to "dead" instead of silently
 * addressing whatever unit recycled the slot. THIS IS NOT OPTIONAL — a raw
 * index stored in `targetId` would make every unit auto-retarget a newly
 * spawned unit the instant its old target died.
 *
 * DEATH IS TWO-PHASE:
 *   `markDead()` only sets the PENDING_DESTROY flag. The slot is not freed and
 *   the generation is not bumped until `flushDestroyed()` runs at Phase.Cleanup.
 *   That is what guarantees no system in phases 100..1300 ever observes a
 *   half-dead entity, and why `targetId` can be trusted for a whole tick.
 *
 * WRITE OWNERSHIP: see the normative table in loop.ts. File-disjointness alone
 * does not stop two modules writing `velX` — the table does.
 * ============================================================================
 */

import {
  MAX_ENTITIES, MAX_PLAYERS, MAX_SELECTION, MAX_QUERY_RESULTS,
  SPATIAL_CELL, SPATIAL_DIM, MAP_SIZE, CELL, MAP_CELLS,
  BASE_STORAGE, START_CREDITS, CONTROL_GROUP_COUNT, BUILD_TAB_ORDER,
} from './config';
import {
  EntityFlag, EntityKind, ENTITY_KIND_COUNT, Faction, Locomotor, NONE,
  OrderKind, Stance, UnitState, ArmorClass,
  makeHandle, handleIndex, handleGen,
} from './types';
import type {
  EntityId, PlayerId, PlayerState, ProductionQueue, SelectionState,
  ITerrain, IOreField, INav, IVision, IVfx, IAudio,
} from './types';
import { clamp, distSq2, worldToCell, clampCell, isInMap } from './math';

/* ==========================================================================
 * 1. ENTITY STORE
 * ========================================================================== */

/**
 * Fixed-capacity SoA entity storage.
 *
 * FROZEN after the foundation lands. If your module needs one more float per
 * entity, you allocate a `PerEntityF32` in YOUR file — you do not add a column
 * here. That rule is what stops 15 agents each adding "just one more field"
 * and turning this into a 4 MB cache-hostile blob.
 */
export class EntityStore {
  readonly capacity = MAX_ENTITIES;

  /* -- identity ---------------------------------------------------------- */
  /** Generation stamp per slot. Starts at 1; bumped on every free. */
  readonly gen = new Uint16Array(MAX_ENTITIES);
  /** EntityFlag bitfield. The cheapest per-entity predicate. */
  readonly flags = new Uint32Array(MAX_ENTITIES);
  /** EntityKind. */
  readonly kind = new Uint8Array(MAX_ENTITIES);
  /** Owning PlayerId. */
  readonly owner = new Uint8Array(MAX_ENTITIES);
  /** Faction, cached from the owner so render never touches PlayerState. */
  readonly faction = new Uint8Array(MAX_ENTITIES);
  /** Index into the unit or building def table. -1 for props. */
  readonly defId = new Int16Array(MAX_ENTITIES);
  /** ModelRegistry id, cached at spawn. */
  readonly modelId = new Uint16Array(MAX_ENTITIES);
  /** Stable per-entity random 0..1, so two tanks never wear identically. */
  readonly seed = new Float32Array(MAX_ENTITIES);
  /** Sim tick this entity was created on. */
  readonly spawnTick = new Int32Array(MAX_ENTITIES);

  /* -- transform (current) ----------------------------------------------- */
  readonly posX = new Float32Array(MAX_ENTITIES);
  readonly posY = new Float32Array(MAX_ENTITIES);
  readonly posZ = new Float32Array(MAX_ENTITIES);
  /** Hull yaw, radians, wrapped to (-PI,PI]. 0 faces +Z. */
  readonly yaw = new Float32Array(MAX_ENTITIES);
  /** Turret yaw in WORLD space (not relative to the hull). */
  readonly turretYaw = new Float32Array(MAX_ENTITIES);
  /** Gun elevation, radians. */
  readonly barrelPitch = new Float32Array(MAX_ENTITIES);
  /** Hull pitch/roll from the ground normal. Render-only; makes tanks sit. */
  readonly hullPitch = new Float32Array(MAX_ENTITIES);
  readonly hullRoll = new Float32Array(MAX_ENTITIES);

  /* -- transform (previous tick, for render interpolation) ---------------- */
  readonly prevX = new Float32Array(MAX_ENTITIES);
  readonly prevY = new Float32Array(MAX_ENTITIES);
  readonly prevZ = new Float32Array(MAX_ENTITIES);
  readonly prevYaw = new Float32Array(MAX_ENTITIES);
  readonly prevTurretYaw = new Float32Array(MAX_ENTITIES);
  readonly prevBarrelPitch = new Float32Array(MAX_ENTITIES);

  /* -- movement ---------------------------------------------------------- */
  readonly velX = new Float32Array(MAX_ENTITIES);
  readonly velZ = new Float32Array(MAX_ENTITIES);
  /** Yaw the steering layer wants; Movement turns toward it at turnRate. */
  readonly desiredYaw = new Float32Array(MAX_ENTITIES);
  /** Current scalar speed, m/s. */
  readonly speed = new Float32Array(MAX_ENTITIES);
  readonly maxSpeed = new Float32Array(MAX_ENTITIES);
  readonly accel = new Float32Array(MAX_ENTITIES);
  /** Hull turn rate, radians/sec. */
  readonly turnRate = new Float32Array(MAX_ENTITIES);
  /** Turret slew rate, radians/sec. */
  readonly turretTurnRate = new Float32Array(MAX_ENTITIES);
  readonly locomotor = new Uint8Array(MAX_ENTITIES);
  /** Collision/separation radius, metres. */
  readonly radius = new Float32Array(MAX_ENTITIES);
  /** Cached grid cell, updated by Movement. */
  readonly cellX = new Int16Array(MAX_ENTITIES);
  readonly cellZ = new Int16Array(MAX_ENTITIES);
  /** Flow-field handle currently in use, or -1. */
  readonly navField = new Int16Array(MAX_ENTITIES);
  /** Accumulated tread scroll, drives the tread material UV. */
  readonly treadPhase = new Float32Array(MAX_ENTITIES);

  /* -- health and combat -------------------------------------------------- */
  readonly hp = new Float32Array(MAX_ENTITIES);
  readonly maxHp = new Float32Array(MAX_ENTITIES);
  readonly armorClass = new Uint8Array(MAX_ENTITIES);
  /** Vision radius, metres. */
  readonly sight = new Float32Array(MAX_ENTITIES);
  /** Index into the weapon table, or -1. */
  readonly weaponIndex = new Int16Array(MAX_ENTITIES);
  /** Seconds until the weapon can fire again. */
  readonly cooldown = new Float32Array(MAX_ENTITIES);
  /** Shots remaining in the current burst. */
  readonly burstLeft = new Uint8Array(MAX_ENTITIES);
  /** Current target handle, or NONE. Generation-checked on read. */
  readonly targetId = new Int32Array(MAX_ENTITIES);
  /** Sim time of the last damage taken. Drives smoke and retaliation. */
  readonly lastHitTime = new Float32Array(MAX_ENTITIES);
  /** Who last hit us, for retaliation. */
  readonly lastAttackerId = new Int32Array(MAX_ENTITIES);
  readonly veterancy = new Uint8Array(MAX_ENTITIES);
  readonly killCount = new Uint16Array(MAX_ENTITIES);
  /** 0 = cannot crush. Higher crushes lower. */
  readonly crushLevel = new Uint8Array(MAX_ENTITIES);
  /** Minimum crushLevel needed to crush this. 0 = uncrushable. */
  readonly crushableBy = new Uint8Array(MAX_ENTITIES);

  /* -- orders and behaviour ---------------------------------------------- */
  readonly state = new Uint8Array(MAX_ENTITIES);
  readonly orderKind = new Uint8Array(MAX_ENTITIES);
  readonly orderTarget = new Int32Array(MAX_ENTITIES);
  readonly orderX = new Float32Array(MAX_ENTITIES);
  readonly orderZ = new Float32Array(MAX_ENTITIES);
  readonly stance = new Uint8Array(MAX_ENTITIES);
  /** Where a Guard-stance unit returns to. */
  readonly guardX = new Float32Array(MAX_ENTITIES);
  readonly guardZ = new Float32Array(MAX_ENTITIES);

  /* -- economy ------------------------------------------------------------ */
  /** Ore units currently carried. */
  readonly cargo = new Float32Array(MAX_ENTITIES);
  readonly cargoMax = new Float32Array(MAX_ENTITIES);
  /** Refinery a harvester is assigned to, or NONE. */
  readonly dockTarget = new Int32Array(MAX_ENTITIES);

  /* -- buildings ---------------------------------------------------------- */
  /** 0..1 construction progress. 1 = complete. */
  readonly buildProgress = new Float32Array(MAX_ENTITIES);
  /** Footprint in CELLS. 0 for units. */
  readonly footprintW = new Uint8Array(MAX_ENTITIES);
  readonly footprintH = new Uint8Array(MAX_ENTITIES);
  /** Positive generates power, negative consumes. */
  readonly powerDraw = new Int16Array(MAX_ENTITIES);

  /* -- presentation-only (written by anim, read by the bridge) ------------ */
  /** Recoil offset in metres along -forward, decays each frame. */
  readonly recoil = new Float32Array(MAX_ENTITIES);
  /** Animation clip index (infantry poses / building sub-anims). */
  readonly animClip = new Uint8Array(MAX_ENTITIES);
  /** Normalized time within the clip. */
  readonly animTime = new Float32Array(MAX_ENTITIES);
  /** Emissive multiplier, ramped by tesla charge / build completion. */
  readonly emissive = new Float32Array(MAX_ENTITIES);

  /* -- allocator ---------------------------------------------------------- */
  /** LIFO free list of slot indices. */
  private readonly freeList = new Int32Array(MAX_ENTITIES);
  private freeCount = 0;
  /** Highest slot ever handed out. Bounds the dense-list rebuild. */
  private highWater = 0;

  /* -- dense lists (maintained incrementally, always exact) --------------- */
  /** All live slots, densely packed. */
  readonly alive = new Int32Array(MAX_ENTITIES);
  aliveCount = 0;
  /** Position of each slot inside `alive`, for O(1) swap-remove. */
  private readonly alivePos = new Int32Array(MAX_ENTITIES);
  /** Per-kind dense lists. */
  readonly byKind: Int32Array[] = [];
  readonly byKindCount = new Int32Array(ENTITY_KIND_COUNT);
  private readonly byKindPos = new Int32Array(MAX_ENTITIES);

  /** Slots flagged for destruction this tick, drained by flushDestroyed. */
  private readonly pending = new Int32Array(MAX_ENTITIES);
  private pendingCount = 0;

  /** Diagnostics: allocation failed because the store was full. */
  public allocFailures = 0;

  constructor() {
    // Free list is a LIFO stack; seed it in reverse so slot 0 is handed out
    // first, which makes debug output readable.
    for (let i = 0; i < MAX_ENTITIES; i++) {
      this.freeList[i] = MAX_ENTITIES - 1 - i;
      this.gen[i] = 1;
      this.defId[i] = -1;
      this.weaponIndex[i] = -1;
      this.navField[i] = -1;
    }
    this.freeCount = MAX_ENTITIES;
    for (let k = 0; k < ENTITY_KIND_COUNT; k++) {
      this.byKind.push(new Int32Array(MAX_ENTITIES));
    }
  }

  /* -- handle resolution -------------------------------------------------- */

  /**
   * Resolve a handle to a slot index, or -1 if it is stale/invalid.
   * THE ONLY correct way to turn a stored handle into an index.
   */
  index(h: EntityId): number {
    if ((h as number) === 0) return -1;
    const i = handleIndex(h);
    if (i >= MAX_ENTITIES) return -1;
    return this.gen[i] === handleGen(h) ? i : -1;
  }

  /** True if the handle refers to a live, non-pending entity. */
  isAlive(h: EntityId): boolean {
    const i = this.index(h);
    if (i < 0) return false;
    return (this.flags[i] & (EntityFlag.Alive | EntityFlag.PendingDestroy)) === EntityFlag.Alive;
  }

  /** True if the handle resolves at all, even if it is pending destruction. */
  exists(h: EntityId): boolean {
    return this.index(h) >= 0;
  }

  /** Build the handle for a slot index. */
  handleOf(i: number): EntityId {
    return makeHandle(i, this.gen[i]);
  }

  /** Test a flag by handle. Returns false for stale handles. */
  hasFlag(h: EntityId, flag: EntityFlag): boolean {
    const i = this.index(h);
    return i >= 0 && (this.flags[i] & flag) !== 0;
  }

  /* -- allocation --------------------------------------------------------- */

  /**
   * Claim a slot and initialise every column to a safe default.
   * Returns NONE when the store is full (counted in `allocFailures`) — it
   * NEVER grows, because a mid-battle 1 MB reallocation is a guaranteed hitch.
   */
  alloc(
    kind: EntityKind,
    defId: number,
    owner: PlayerId,
    faction: Faction,
    x: number, y: number, z: number,
    yaw = 0,
  ): EntityId {
    if (this.freeCount === 0) {
      this.allocFailures++;
      return NONE;
    }
    const i = this.freeList[--this.freeCount];
    if (i > this.highWater) this.highWater = i;

    // Identity
    this.flags[i] = EntityFlag.Alive;
    this.kind[i] = kind;
    this.owner[i] = owner as number;
    this.faction[i] = faction;
    this.defId[i] = defId;
    this.modelId[i] = 0;
    // Deterministic per-entity randomness derived from the slot AND the
    // generation, so a recycled slot does not inherit the previous unit's wear.
    this.seed[i] = ((i * 2654435761 + this.gen[i] * 40503) >>> 0) / 4294967296;
    this.spawnTick[i] = 0;

    // Transform
    this.posX[i] = x; this.posY[i] = y; this.posZ[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.yaw[i] = yaw; this.prevYaw[i] = yaw;
    this.turretYaw[i] = yaw; this.prevTurretYaw[i] = yaw;
    this.barrelPitch[i] = 0; this.prevBarrelPitch[i] = 0;
    this.hullPitch[i] = 0; this.hullRoll[i] = 0;

    // Movement
    this.velX[i] = 0; this.velZ[i] = 0;
    this.desiredYaw[i] = yaw;
    this.speed[i] = 0; this.maxSpeed[i] = 0;
    this.accel[i] = 0; this.turnRate[i] = 0; this.turretTurnRate[i] = 0;
    this.locomotor[i] = Locomotor.Static;
    this.radius[i] = 1;
    this.cellX[i] = clampCell(worldToCell(x));
    this.cellZ[i] = clampCell(worldToCell(z));
    this.navField[i] = -1;
    this.treadPhase[i] = 0;

    // Combat
    this.hp[i] = 1; this.maxHp[i] = 1;
    this.armorClass[i] = ArmorClass.Light;
    this.sight[i] = 0;
    this.weaponIndex[i] = -1;
    this.cooldown[i] = 0; this.burstLeft[i] = 0;
    this.targetId[i] = 0;
    this.lastHitTime[i] = -1e9;
    this.lastAttackerId[i] = 0;
    this.veterancy[i] = 0; this.killCount[i] = 0;
    this.crushLevel[i] = 0; this.crushableBy[i] = 0;

    // Orders
    this.state[i] = UnitState.Idle;
    this.orderKind[i] = OrderKind.None;
    this.orderTarget[i] = 0;
    this.orderX[i] = x; this.orderZ[i] = z;
    this.stance[i] = Stance.Aggressive;
    this.guardX[i] = x; this.guardZ[i] = z;

    // Economy
    this.cargo[i] = 0; this.cargoMax[i] = 0;
    this.dockTarget[i] = 0;

    // Buildings
    this.buildProgress[i] = 1;
    this.footprintW[i] = 0; this.footprintH[i] = 0;
    this.powerDraw[i] = 0;

    // Presentation
    this.recoil[i] = 0;
    this.animClip[i] = 0; this.animTime[i] = 0;
    this.emissive[i] = 1;

    // Dense lists
    this.alivePos[i] = this.aliveCount;
    this.alive[this.aliveCount++] = i;
    const kc = this.byKindCount[kind];
    this.byKindPos[i] = kc;
    this.byKind[kind][kc] = i;
    this.byKindCount[kind] = kc + 1;

    return makeHandle(i, this.gen[i]);
  }

  /**
   * Flag an entity for destruction. It stays readable for the rest of the tick
   * and is actually freed in `flushDestroyed()` at Phase.Cleanup.
   * Idempotent — double-marking is harmless and common (splash + a bullet).
   */
  markDead(h: EntityId): boolean {
    const i = this.index(h);
    if (i < 0) return false;
    if ((this.flags[i] & EntityFlag.Alive) === 0) return false;
    if ((this.flags[i] & EntityFlag.PendingDestroy) !== 0) return false;
    this.flags[i] |= EntityFlag.PendingDestroy;
    this.pending[this.pendingCount++] = i;
    return true;
  }

  /** True if this entity is scheduled to die at the end of this tick. */
  isPendingDestroy(h: EntityId): boolean {
    const i = this.index(h);
    return i >= 0 && (this.flags[i] & EntityFlag.PendingDestroy) !== 0;
  }

  /**
   * Actually free every entity marked this tick.
   * `onFree` is called with the slot index BEFORE the generation is bumped, so
   * a listener can still read the entity's final state (position, owner, def)
   * to emit `entity:killed` and spawn a wreck.
   *
   * Returns the number of entities freed.
   */
  flushDestroyed(onFree?: (index: number) => void): number {
    const n = this.pendingCount;
    for (let p = 0; p < n; p++) {
      const i = this.pending[p];
      if ((this.flags[i] & EntityFlag.Alive) === 0) continue;
      if (onFree !== undefined) onFree(i);

      // Remove from the per-kind dense list (swap with the tail).
      const k = this.kind[i];
      const list = this.byKind[k];
      const kc = this.byKindCount[k] - 1;
      const kp = this.byKindPos[i];
      const kmoved = list[kc];
      list[kp] = kmoved;
      this.byKindPos[kmoved] = kp;
      this.byKindCount[k] = kc;

      // Remove from the all-alive dense list.
      const ac = this.aliveCount - 1;
      const ap = this.alivePos[i];
      const amoved = this.alive[ac];
      this.alive[ap] = amoved;
      this.alivePos[amoved] = ap;
      this.aliveCount = ac;

      // Invalidate every outstanding handle to this slot.
      this.flags[i] = 0;
      this.gen[i] = (this.gen[i] + 1) & 0xfff;
      // Generation 0 would make handle(slot 0) === NONE. Skip it forever.
      if (this.gen[i] === 0) this.gen[i] = 1;

      this.freeList[this.freeCount++] = i;
    }
    this.pendingCount = 0;
    return n;
  }

  /**
   * Copy every interpolated column into its `prev` twin.
   * Six typed-array memcpys, roughly 10 microseconds at 4096 slots. Called at
   * the START of each sim step, so the render bridge can lerp prev->cur by
   * alpha and hide the fact that the sim only runs at 30 Hz.
   */
  snapshotPrev(): void {
    this.prevX.set(this.posX);
    this.prevY.set(this.posY);
    this.prevZ.set(this.posZ);
    this.prevYaw.set(this.yaw);
    this.prevTurretYaw.set(this.turretYaw);
    this.prevBarrelPitch.set(this.barrelPitch);
  }

  /** Live entities. */
  get count(): number { return this.aliveCount; }
  /** Slots available. */
  get free(): number { return this.freeCount; }

  /** Reset everything. Between matches only. */
  reset(): void {
    this.flags.fill(0);
    this.aliveCount = 0;
    this.pendingCount = 0;
    this.byKindCount.fill(0);
    this.highWater = 0;
    this.allocFailures = 0;
    for (let i = 0; i < MAX_ENTITIES; i++) {
      this.freeList[i] = MAX_ENTITIES - 1 - i;
      this.gen[i] = 1;
    }
    this.freeCount = MAX_ENTITIES;
  }
}

/* ==========================================================================
 * 2. PER-ENTITY SIDE ARRAYS
 *
 * THE ESCAPE HATCH THAT KEEPS EntityStore FROZEN.
 *
 * Your module needs "just one more float per unit"? Allocate one of these in
 * YOUR file, module-private. It is generation-stamped, so a recycled slot
 * reads as absent instead of inheriting the dead unit's value — which is
 * exactly the bug a raw parallel array would give you.
 * ========================================================================== */

/** Generation-stamped float side array. */
export class PerEntityF32 {
  readonly data = new Float32Array(MAX_ENTITIES);
  private readonly stamp = new Uint16Array(MAX_ENTITIES);

  constructor(private readonly store: EntityStore, readonly defaultValue = 0) {}

  /** Read, returning `defaultValue` for stale or never-set slots. */
  get(h: EntityId): number {
    const i = this.store.index(h);
    if (i < 0 || this.stamp[i] !== this.store.gen[i]) return this.defaultValue;
    return this.data[i];
  }

  /** Write. Silently ignores stale handles. */
  set(h: EntityId, v: number): void {
    const i = this.store.index(h);
    if (i < 0) return;
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v;
  }

  /** Fast path when you already have a validated slot index. */
  getAt(i: number): number {
    return this.stamp[i] === this.store.gen[i] ? this.data[i] : this.defaultValue;
  }

  setAt(i: number, v: number): void {
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v;
  }

  /** True if a value has been written for the CURRENT occupant of the slot. */
  has(h: EntityId): boolean {
    const i = this.store.index(h);
    return i >= 0 && this.stamp[i] === this.store.gen[i];
  }

  clear(h: EntityId): void {
    const i = this.store.index(h);
    if (i >= 0) this.stamp[i] = 0;
  }
}

/** Generation-stamped uint32 side array. Same contract as PerEntityF32. */
export class PerEntityU32 {
  readonly data = new Uint32Array(MAX_ENTITIES);
  private readonly stamp = new Uint16Array(MAX_ENTITIES);

  constructor(private readonly store: EntityStore, readonly defaultValue = 0) {}

  get(h: EntityId): number {
    const i = this.store.index(h);
    if (i < 0 || this.stamp[i] !== this.store.gen[i]) return this.defaultValue;
    return this.data[i];
  }
  set(h: EntityId, v: number): void {
    const i = this.store.index(h);
    if (i < 0) return;
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v >>> 0;
  }
  getAt(i: number): number {
    return this.stamp[i] === this.store.gen[i] ? this.data[i] : this.defaultValue;
  }
  setAt(i: number, v: number): void {
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v >>> 0;
  }
  has(h: EntityId): boolean {
    const i = this.store.index(h);
    return i >= 0 && this.stamp[i] === this.store.gen[i];
  }
  clear(h: EntityId): void {
    const i = this.store.index(h);
    if (i >= 0) this.stamp[i] = 0;
  }
}

/** Generation-stamped int16 side array. */
export class PerEntityI16 {
  readonly data = new Int16Array(MAX_ENTITIES);
  private readonly stamp = new Uint16Array(MAX_ENTITIES);

  constructor(private readonly store: EntityStore, readonly defaultValue = 0) {}

  get(h: EntityId): number {
    const i = this.store.index(h);
    if (i < 0 || this.stamp[i] !== this.store.gen[i]) return this.defaultValue;
    return this.data[i];
  }
  set(h: EntityId, v: number): void {
    const i = this.store.index(h);
    if (i < 0) return;
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v;
  }
  getAt(i: number): number {
    return this.stamp[i] === this.store.gen[i] ? this.data[i] : this.defaultValue;
  }
  setAt(i: number, v: number): void {
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v;
  }
  clear(h: EntityId): void {
    const i = this.store.index(h);
    if (i >= 0) this.stamp[i] = 0;
  }
}

/**
 * Generation-stamped object side array. Use SPARINGLY — one of these per
 * module is fine; one per entity per module is how you get a GC pause.
 */
export class PerEntityObj<T> {
  private readonly data: (T | undefined)[] = new Array(MAX_ENTITIES);
  private readonly stamp = new Uint16Array(MAX_ENTITIES);

  constructor(private readonly store: EntityStore) {}

  get(h: EntityId): T | undefined {
    const i = this.store.index(h);
    if (i < 0 || this.stamp[i] !== this.store.gen[i]) return undefined;
    return this.data[i];
  }
  set(h: EntityId, v: T): void {
    const i = this.store.index(h);
    if (i < 0) return;
    this.stamp[i] = this.store.gen[i];
    this.data[i] = v;
  }
  /** Release the reference so the object can be collected. */
  clear(h: EntityId): void {
    const i = this.store.index(h);
    if (i >= 0) { this.stamp[i] = 0; this.data[i] = undefined; }
  }
}

/* ==========================================================================
 * 3. SPATIAL INDEX
 *
 * A uniform grid rebuilt EVERY TICK by counting sort into flat typed arrays.
 * Rebuilding beats incremental maintenance here: at 250 moving entities the
 * whole rebuild is ~50 microseconds, and it has no per-move bookkeeping, no
 * stale-bucket bugs, and no allocation.
 *
 * Buildings are inserted into every cell of their footprint, so a query near
 * the corner of a Construction Yard finds it.
 *
 * ALL queries write into a caller-supplied Int32Array and return a count.
 * Nothing here allocates.
 * ========================================================================== */

/** Entries capacity: every entity may occupy several buckets. */
const SPATIAL_ENTRY_CAPACITY = MAX_ENTITIES * 8;

export class SpatialIndex {
  private readonly cellCount = SPATIAL_DIM * SPATIAL_DIM;
  /** Prefix-sum bucket starts, length cellCount + 1. */
  private readonly bucketStart: Int32Array;
  /** Scratch counter reused each rebuild. */
  private readonly bucketCount: Int32Array;
  /** Flat entity-index entries, grouped by bucket. */
  private readonly entries = new Int32Array(SPATIAL_ENTRY_CAPACITY);
  private entryTotal = 0;

  /**
   * Dedupe stamps: a multi-cell building would otherwise appear several times
   * in one circle query. A rising query id avoids clearing this array.
   */
  private readonly visited = new Int32Array(MAX_ENTITIES);
  private queryId = 0;

  /** Diagnostics. */
  public lastRebuildEntries = 0;
  public overflowed = false;

  constructor(private readonly store: EntityStore) {
    this.bucketStart = new Int32Array(this.cellCount + 1);
    this.bucketCount = new Int32Array(this.cellCount);
  }

  /** World coordinate -> bucket axis index. */
  private axis(w: number): number {
    const c = (w / SPATIAL_CELL) | 0;
    return c < 0 ? 0 : c >= SPATIAL_DIM ? SPATIAL_DIM - 1 : c;
  }

  /**
   * Rebuild from scratch. Call ONCE per tick at Phase.SpatialRebuild.
   * Nothing may move after this point in the tick, or queries will lie.
   */
  rebuild(): void {
    const s = this.store;
    const n = s.aliveCount;
    this.bucketCount.fill(0);
    this.overflowed = false;

    // Pass 1: count entries per bucket.
    let total = 0;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const fw = s.footprintW[i];
      if (fw > 0) {
        // Building: cover the whole footprint.
        const halfW = fw * CELL * 0.5;
        const halfH = s.footprintH[i] * CELL * 0.5;
        const x0 = this.axis(s.posX[i] - halfW), x1 = this.axis(s.posX[i] + halfW);
        const z0 = this.axis(s.posZ[i] - halfH), z1 = this.axis(s.posZ[i] + halfH);
        for (let bz = z0; bz <= z1; bz++) {
          for (let bx = x0; bx <= x1; bx++) {
            this.bucketCount[bz * SPATIAL_DIM + bx]++;
            total++;
          }
        }
      } else {
        this.bucketCount[this.axis(s.posZ[i]) * SPATIAL_DIM + this.axis(s.posX[i])]++;
        total++;
      }
    }

    if (total > SPATIAL_ENTRY_CAPACITY) {
      // Cannot happen with the current capacities, but never silently corrupt.
      this.overflowed = true;
      total = SPATIAL_ENTRY_CAPACITY;
    }
    this.entryTotal = total;
    this.lastRebuildEntries = total;

    // Prefix sum -> bucket starts. bucketCount is reused as a write cursor.
    let acc = 0;
    for (let b = 0; b < this.cellCount; b++) {
      this.bucketStart[b] = acc;
      acc += this.bucketCount[b];
      this.bucketCount[b] = this.bucketStart[b];
    }
    this.bucketStart[this.cellCount] = acc;

    // Pass 2: scatter.
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const fw = s.footprintW[i];
      if (fw > 0) {
        const halfW = fw * CELL * 0.5;
        const halfH = s.footprintH[i] * CELL * 0.5;
        const x0 = this.axis(s.posX[i] - halfW), x1 = this.axis(s.posX[i] + halfW);
        const z0 = this.axis(s.posZ[i] - halfH), z1 = this.axis(s.posZ[i] + halfH);
        for (let bz = z0; bz <= z1; bz++) {
          for (let bx = x0; bx <= x1; bx++) {
            const b = bz * SPATIAL_DIM + bx;
            const w = this.bucketCount[b];
            if (w < SPATIAL_ENTRY_CAPACITY) { this.entries[w] = i; this.bucketCount[b] = w + 1; }
          }
        }
      } else {
        const b = this.axis(s.posZ[i]) * SPATIAL_DIM + this.axis(s.posX[i]);
        const w = this.bucketCount[b];
        if (w < SPATIAL_ENTRY_CAPACITY) { this.entries[w] = i; this.bucketCount[b] = w + 1; }
      }
    }
  }

  /**
   * Every entity whose CENTRE is within `r` of (x,z).
   * Writes slot indices into `out`, returns how many were written.
   *
   * Note: slot INDICES, not handles — you already hold the store, and the
   * results are only valid until the next rebuild, so a generation check would
   * be pure overhead. Convert with `store.handleOf(i)` if you need to retain.
   */
  queryCircle(x: number, z: number, r: number, out: Int32Array, maxOut = out.length): number {
    const s = this.store;
    const r2 = r * r;
    const bx0 = this.axis(x - r), bx1 = this.axis(x + r);
    const bz0 = this.axis(z - r), bz1 = this.axis(z + r);
    const qid = ++this.queryId;
    let count = 0;

    for (let bz = bz0; bz <= bz1; bz++) {
      const row = bz * SPATIAL_DIM;
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = row + bx;
        const end = this.bucketCount[b];
        for (let e = this.bucketStart[b]; e < end; e++) {
          const i = this.entries[e];
          if (this.visited[i] === qid) continue;
          this.visited[i] = qid;
          const dx = s.posX[i] - x, dz = s.posZ[i] - z;
          if (dx * dx + dz * dz > r2) continue;
          if (count >= maxOut) return count;
          out[count++] = i;
        }
      }
    }
    return count;
  }

  /**
   * Like queryCircle, but the test includes each entity's own radius — i.e.
   * "everything that OVERLAPS this circle". This is the correct test for
   * splash damage: a tank whose centre is 6 m from a blast still takes damage
   * if its hull reaches in.
   */
  queryCircleFat(x: number, z: number, r: number, out: Int32Array, maxOut = out.length): number {
    const s = this.store;
    // Widen the bucket sweep by the largest plausible entity radius (a 3x3
    // building's half-diagonal is ~8.5 m).
    const pad = r + 10;
    const bx0 = this.axis(x - pad), bx1 = this.axis(x + pad);
    const bz0 = this.axis(z - pad), bz1 = this.axis(z + pad);
    const qid = ++this.queryId;
    let count = 0;

    for (let bz = bz0; bz <= bz1; bz++) {
      const row = bz * SPATIAL_DIM;
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = row + bx;
        const end = this.bucketCount[b];
        for (let e = this.bucketStart[b]; e < end; e++) {
          const i = this.entries[e];
          if (this.visited[i] === qid) continue;
          this.visited[i] = qid;
          const rr = r + s.radius[i];
          const dx = s.posX[i] - x, dz = s.posZ[i] - z;
          if (dx * dx + dz * dz > rr * rr) continue;
          if (count >= maxOut) return count;
          out[count++] = i;
        }
      }
    }
    return count;
  }

  /** Every entity whose centre lies inside an axis-aligned rect. */
  queryRect(
    minX: number, minZ: number, maxX: number, maxZ: number,
    out: Int32Array, maxOut = out.length,
  ): number {
    const s = this.store;
    const bx0 = this.axis(minX), bx1 = this.axis(maxX);
    const bz0 = this.axis(minZ), bz1 = this.axis(maxZ);
    const qid = ++this.queryId;
    let count = 0;

    for (let bz = bz0; bz <= bz1; bz++) {
      const row = bz * SPATIAL_DIM;
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = row + bx;
        const end = this.bucketCount[b];
        for (let e = this.bucketStart[b]; e < end; e++) {
          const i = this.entries[e];
          if (this.visited[i] === qid) continue;
          this.visited[i] = qid;
          const px = s.posX[i], pz = s.posZ[i];
          if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
          if (count >= maxOut) return count;
          out[count++] = i;
        }
      }
    }
    return count;
  }

  /**
   * Nearest entity to (x,z) within `r` that passes a bit-mask filter.
   * Closure-free and allocation-free, which is why it takes masks rather than
   * a predicate — targeting calls this for a slice of the army every tick.
   *
   * @param ownerMask   Bit i set = player i is an acceptable owner. ~0 for any.
   * @param requireFlags All of these EntityFlags must be set. 0 for none.
   * @param rejectFlags  None of these EntityFlags may be set. 0 for none.
   * @returns the slot index, or -1.
   */
  nearest(
    x: number, z: number, r: number,
    ownerMask: number, requireFlags: number, rejectFlags: number,
  ): number {
    const s = this.store;
    const bx0 = this.axis(x - r), bx1 = this.axis(x + r);
    const bz0 = this.axis(z - r), bz1 = this.axis(z + r);
    let best = -1;
    let bestD2 = r * r;

    for (let bz = bz0; bz <= bz1; bz++) {
      const row = bz * SPATIAL_DIM;
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = row + bx;
        const end = this.bucketCount[b];
        for (let e = this.bucketStart[b]; e < end; e++) {
          const i = this.entries[e];
          const f = s.flags[i];
          if ((f & requireFlags) !== requireFlags) continue;
          if ((f & rejectFlags) !== 0) continue;
          if ((ownerMask & (1 << s.owner[i])) === 0) continue;
          const dx = s.posX[i] - x, dz = s.posZ[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
      }
    }
    return best;
  }

  /**
   * Single-point pick: the entity whose radius contains (x,z), preferring the
   * smallest (so clicking a tank parked beside a Construction Yard selects the
   * tank). Returns a slot index, or -1.
   */
  pick(x: number, z: number, rejectFlags: number = EntityFlag.NotSelectable): number {
    const s = this.store;
    const bx = this.axis(x), bz = this.axis(z);
    let best = -1;
    let bestR = Infinity;

    // Scan the 3x3 neighbourhood: a big building's centre may be a bucket away.
    for (let dz = -1; dz <= 1; dz++) {
      const rz = bz + dz;
      if (rz < 0 || rz >= SPATIAL_DIM) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const rx = bx + dx;
        if (rx < 0 || rx >= SPATIAL_DIM) continue;
        const b = rz * SPATIAL_DIM + rx;
        const end = this.bucketCount[b];
        for (let e = this.bucketStart[b]; e < end; e++) {
          const i = this.entries[e];
          if ((s.flags[i] & rejectFlags) !== 0) continue;
          let hit = false;
          if (s.footprintW[i] > 0) {
            const halfW = s.footprintW[i] * CELL * 0.5;
            const halfH = s.footprintH[i] * CELL * 0.5;
            hit = Math.abs(x - s.posX[i]) <= halfW && Math.abs(z - s.posZ[i]) <= halfH;
          } else {
            const rr = s.radius[i];
            hit = distSq2(x, z, s.posX[i], s.posZ[i]) <= rr * rr;
          }
          if (!hit) continue;
          const size = s.footprintW[i] > 0 ? s.footprintW[i] * CELL : s.radius[i];
          if (size < bestR) { bestR = size; best = i; }
        }
      }
    }
    return best;
  }

  /** Total entries in the last rebuild. Diagnostics. */
  get entryCount(): number { return this.entryTotal; }
}

/* ==========================================================================
 * 4. PLAYER STATE
 * ========================================================================== */

/** Build an empty production queue for a tab. */
function makeQueue(tab: number): ProductionQueue {
  return { tab, items: [], factoryCount: 0, awaitingPlacement: false } as ProductionQueue;
}

/** Construct a fully-initialised PlayerState. */
export function createPlayerState(
  id: PlayerId, faction: Faction, name: string, isHuman: boolean, isLocal: boolean,
): PlayerState {
  return {
    id,
    faction,
    name,
    isHuman,
    isLocal,
    defeated: false,
    // Allied with yourself, and nobody else.
    allyMask: 1 << (id as number),
    credits: START_CREDITS,
    storageMax: BASE_STORAGE,
    powerProduced: 0,
    powerConsumed: 0,
    buildSpeedMul: 1,
    queues: BUILD_TAB_ORDER.map(makeQueue),
    techMask: new Uint8Array(256),
    hasRadar: false,
    rallyX: new Map<number, number>(),
    rallyZ: new Map<number, number>(),
    entityCount: new Int32Array(ENTITY_KIND_COUNT),
    buildingCount: new Int32Array(256),
    stats: {
      unitsBuilt: 0, unitsLost: 0, unitsKilled: 0,
      buildingsBuilt: 0, buildingsLost: 0, buildingsKilled: 0,
      oreMined: 0, creditsSpent: 0, peakArmyValue: 0,
    },
    aiDifficulty: 1,
    aiPersonality: 0,
  };
}

/** Empty selection state with pre-allocated buffers. */
export function createSelectionState(): SelectionState {
  const groups: Int32Array[] = [];
  for (let i = 0; i < CONTROL_GROUP_COUNT; i++) groups.push(new Int32Array(MAX_SELECTION));
  return {
    ids: new Int32Array(MAX_SELECTION),
    count: 0,
    isBuilding: false,
    homogeneousDef: -1,
    groups,
    groupCounts: new Int32Array(CONTROL_GROUP_COUNT),
  };
}

/* ==========================================================================
 * 5. DEFAULT PORT IMPLEMENTATIONS
 *
 * Null objects so the game RUNS before terrain, nav and fog-of-war exist.
 * Each owning module replaces its port at init(). These are deliberately the
 * "everything is flat, open and visible" answers — the failure mode is a
 * boring-looking game, never a crash.
 * ========================================================================== */

/** Flat ground at y=0, everything passable and buildable. */
class FlatTerrain implements ITerrain {
  private readonly occupant = new Int32Array(MAP_CELLS * MAP_CELLS);
  private version = 0;

  heightAt(): number { return 0; }
  normalAt(_x: number, _z: number, out: Float32Array): Float32Array {
    out[0] = 0; out[1] = 1; out[2] = 0; return out;
  }
  slopeAt(): number { return 0; }
  isPassable(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.occupant[cz * MAP_CELLS + cx] === 0;
  }
  isBuildable(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.occupant[cz * MAP_CELLS + cx] === 0;
  }
  isOccupied(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.occupant[cz * MAP_CELLS + cx] !== 0;
  }
  markOccupied(cx: number, cz: number, w: number, h: number, id: EntityId): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = id as number;
      }
    }
    this.version++;
  }
  clearOccupied(cx: number, cz: number, w: number, h: number): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = 0;
      }
    }
    this.version++;
  }
  occupancyVersion(): number { return this.version; }
  isWater(): boolean { return false; }
  raycastGround(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean {
    // Analytic ray vs the y=0 plane. Exactly what the real terrain does first.
    if (Math.abs(dy) < 1e-6) return false;
    const t = -oy / dy;
    if (t < 0) return false;
    out[0] = ox + dx * t;
    out[1] = 0;
    out[2] = oz + dz * t;
    return true;
  }
}

/** No ore anywhere. Harvesters idle politely instead of crashing. */
class EmptyOreField implements IOreField {
  oreAt(): number { return 0; }
  takeOre(): number { return 0; }
  oreValue(): number { return 1; }
  findOre(): boolean { return false; }
  totalOre(): number { return 0; }
}

/** Straight-line movement: sample() always points at the goal. */
class DirectNav implements INav {
  private readonly goals: number[] = [];
  private next = 1;

  requestField(goalCx: number, goalCz: number): number {
    const id = this.next++;
    this.goals[id * 2] = (goalCx + 0.5) * CELL;
    this.goals[id * 2 + 1] = (goalCz + 0.5) * CELL;
    return id;
  }
  addRef(): void { /* refcounting is a no-op without a cache */ }
  release(): void { /* nothing to evict */ }
  isReady(): boolean { return true; }
  sample(field: number, x: number, z: number, out: Float32Array): boolean {
    if (field <= 0 || field * 2 + 1 >= this.goals.length) return false;
    const gx = this.goals[field * 2], gz = this.goals[field * 2 + 1];
    const dx = gx - x, dz = gz - z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-4) { out[0] = 0; out[1] = 0; return true; }
    out[0] = dx / l; out[1] = dz / l;
    return true;
  }
  isDirectPathClear(): boolean { return true; }
  nearestReachable(cx: number, cz: number, _loco: Locomotor, out: Int32Array): boolean {
    out[0] = clampCell(cx); out[1] = clampCell(cz);
    return true;
  }
}

/** Everything visible to everyone. The map reads as fully scouted. */
class OpenVision implements IVision {
  private readonly full = new Uint8Array(MAP_CELLS * MAP_CELLS).fill(0b11);
  isVisibleAt(): boolean { return true; }
  isExplored(): boolean { return true; }
  canSee(): boolean { return true; }
  hasRadar(): boolean { return true; }
  gridFor(): Uint8Array { return this.full; }
}

/** Silently swallows every effect. */
class NullVfx implements IVfx {
  play(): void {}
  attach(): number { return -1; }
  detach(): void {}
  decal(): void {}
  shake(): void {}
  particleCount(): number { return 0; }
}

/** Silently swallows every sound. */
class NullAudio implements IAudio {
  play(): void {}
  ui(): void {}
  eva(): void {}
  setIntensity(): void {}
}

/* ==========================================================================
 * 6. THE WORLD
 *
 * One object handed to every system. Holds the store, the index, the players,
 * and the swappable ports.
 * ========================================================================== */

export class World {
  readonly store = new EntityStore();
  readonly spatial = new SpatialIndex(this.store);
  readonly selection = createSelectionState();

  /** Dense player list. Index === PlayerId. */
  readonly players: PlayerState[] = [];
  /** The player whose HUD is on screen. */
  localPlayer: PlayerId = 0 as PlayerId;

  /** Current sim tick, mirrored from the Clock for convenience. */
  tick = 0;
  /** Simulated seconds since match start. */
  time = 0;

  /* -- ports: default null objects, replaced by owning modules at init ----- */
  terrain: ITerrain = new FlatTerrain();
  ore: IOreField = new EmptyOreField();
  nav: INav = new DirectNav();
  vision: IVision = new OpenVision();
  vfx: IVfx = new NullVfx();
  audio: IAudio = new NullAudio();

  /**
   * Shared query scratch buffer. A system may use this for the duration of one
   * call and must not retain it. Systems that need results to survive a nested
   * call own their own buffer.
   */
  readonly queryScratch = new Int32Array(MAX_QUERY_RESULTS);
  readonly queryScratchB = new Int32Array(MAX_QUERY_RESULTS);

  /* -- players ------------------------------------------------------------ */

  addPlayer(faction: Faction, name: string, isHuman: boolean, isLocal: boolean): PlayerId {
    const id = this.players.length as PlayerId;
    if (this.players.length >= MAX_PLAYERS) return 0 as PlayerId;
    const p = createPlayerState(id, faction, name, isHuman, isLocal);
    this.players.push(p);
    if (isLocal) this.localPlayer = id;
    return id;
  }

  player(id: PlayerId): PlayerState {
    return this.players[id as number];
  }

  /** True if `a` and `b` are on the same side (including a === b). */
  areAllied(a: PlayerId, b: PlayerId): boolean {
    const pa = this.players[a as number];
    if (pa === undefined) return false;
    return (pa.allyMask & (1 << (b as number))) !== 0;
  }

  /** Bit mask of every player that `viewer` considers hostile. */
  enemyMask(viewer: PlayerId): number {
    const pa = this.players[viewer as number];
    if (pa === undefined) return 0;
    let mask = 0;
    for (let i = 0; i < this.players.length; i++) {
      if ((pa.allyMask & (1 << i)) === 0) mask |= (1 << i);
    }
    return mask;
  }

  /** Bit mask of every player allied to `viewer`. */
  allyMask(viewer: PlayerId): number {
    const pa = this.players[viewer as number];
    return pa === undefined ? 0 : pa.allyMask;
  }

  /* -- convenience accessors ---------------------------------------------- */

  /** Position of an entity into `out` as [x,y,z]. Returns false if stale. */
  getPosition(h: EntityId, out: Float32Array): boolean {
    const i = this.store.index(h);
    if (i < 0) return false;
    out[0] = this.store.posX[i];
    out[1] = this.store.posY[i];
    out[2] = this.store.posZ[i];
    return true;
  }

  /** Distance between two entities, or Infinity if either is stale. */
  distanceBetween(a: EntityId, b: EntityId): number {
    const s = this.store;
    const ia = s.index(a), ib = s.index(b);
    if (ia < 0 || ib < 0) return Infinity;
    return Math.sqrt(distSq2(s.posX[ia], s.posZ[ia], s.posX[ib], s.posZ[ib]));
  }

  /**
   * Surface-to-surface distance: subtracts both radii, clamped at 0. This is
   * the distance a weapon range check should use — otherwise a Harvester
   * (radius 2.2 m) is unhittable at the edge of a short-ranged weapon.
   */
  gapBetween(a: EntityId, b: EntityId): number {
    const s = this.store;
    const ia = s.index(a), ib = s.index(b);
    if (ia < 0 || ib < 0) return Infinity;
    const d = Math.sqrt(distSq2(s.posX[ia], s.posZ[ia], s.posX[ib], s.posZ[ib]));
    return Math.max(0, d - s.radius[ia] - s.radius[ib]);
  }

  /** Clamp a world position into the playable area. Writes into `out`. */
  clampToMap(x: number, z: number, out: Float32Array): Float32Array {
    out[0] = clamp(x, 0, MAP_SIZE);
    out[1] = clamp(z, 0, MAP_SIZE);
    return out;
  }

  /** Reset for a new match. Ports are NOT reset — modules re-register at init. */
  reset(): void {
    this.store.reset();
    this.players.length = 0;
    this.selection.count = 0;
    this.selection.groupCounts.fill(0);
    this.tick = 0;
    this.time = 0;
  }
}

/**
 * ============================================================================
 * RED ALERT — src/sim/Flowfield.ts
 * ============================================================================
 * GOAL-BUCKETED FLOW FIELDS. The reason 200 units can be ordered across the
 * map in one click and the frame budget does not move.
 *
 * WHY NOT A*
 * ----------
 * Per-unit A* costs O(n) searches for one order. Forty tanks sent to one point
 * run forty searches that all discover the same corridor and then all follow
 * slightly different lines through it, which is both slow AND ugly (the column
 * frays). A flow field inverts the problem: ONE Dijkstra expansion from the
 * GOAL produces a direction for every cell on the map, and every unit sharing
 * that goal reads it in O(1). Goals quantise into FLOWFIELD_GOAL_BUCKET-cell
 * buckets so a 40-unit order collapses to one field, not forty.
 *
 * THREE LAYERS, EACH CACHED SEPARATELY
 * ------------------------------------
 *  1. COST FIELD — one Uint8Array per MoveClass. Terrain passability + slope +
 *     water + roads + building footprints + a "do not hug the wall" penalty
 *     ring. Rebuilt only when `ITerrain.occupancyVersion()` changes, i.e. when
 *     a building is placed, sold or destroyed.
 *  2. INTEGRATION FIELD — Int32 cost-to-goal per cell, expanded from the goal
 *     under a per-tick budget (FLOWFIELD_BUDGET_CELLS across ALL fields), so a
 *     new order never spikes a frame.
 *  3. FLOW FIELD — Int8 quantised unit vector per cell, computed in one pass
 *     when the integration completes. Sampling is then 4 cell reads and a
 *     bilinear blend.
 *
 * WHY SPFA AND NOT A BINARY HEAP
 * ------------------------------
 * The expansion is a queue-based label-correcting Dijkstra (SPFA). It yields
 * the identical exact shortest-path result as a heap Dijkstra, but its whole
 * working state is a ring buffer of cell indices plus an in-queue byte — two
 * flat typed arrays that can be preallocated per expander and carried across
 * ticks when the budget runs out mid-expansion. A binary heap would need its
 * own 64 KB key/value pair arrays per in-flight field and could not be paused
 * as cheaply. On a grid where 90% of edges cost exactly COST_UNIT, SPFA does
 * ~1.05 relaxations per cell.
 *
 * MOVE CLASSES vs LOCOMOTORS
 * --------------------------
 * `Locomotor` (core/types) has no Naval or Air member — hovercraft, ships and
 * aircraft all spawn as `Locomotor.Hover` today. `MoveClass` is the pathing
 * vocabulary and adds those two. `moveClassForLocomotor` is the default
 * mapping; Movement.ts owns the per-entity override (`setMoveClass`).
 *
 * DETERMINISM
 * -----------
 * Nothing here reads a clock or `Math.random`. Ring order, tie-breaks and
 * eviction are all index-ordered, so two runs from one seed expand the same
 * cells in the same order.
 * ============================================================================
 */

import {
  CELL, MAP_CELLS, MAP_CELL_COUNT,
  FLOWFIELD_CACHE_SIZE, FLOWFIELD_GOAL_BUCKET, FLOWFIELD_BUDGET_CELLS,
  NAV_COST_ROAD, NAV_COST_ROUGH, NAV_COST_RAMP, NAV_COST_WALL_HUG,
  NAV_FIELD_EXPANDERS, NAV_MIN_EXPANDER_BUDGET, NAV_SNAP_SEARCH_CELLS,
  WATER_LEVEL,
} from '../core/config';
import { Locomotor } from '../core/types';
import type { INav, ITerrain } from '../core/types';
import { clampCell, isInMap, worldToCell } from '../core/math';
import {
  COST_BLOCKED, COST_UNIT, PASS_HOVER, getTerrain, type Terrain,
} from '../world/Terrain';
import { SurfaceId } from '../world/Biomes';
import { getRoads, isCarriageway, roadMoveMultiplier } from '../world/Roads';

/* ==========================================================================
 * 1. MOVE CLASSES
 * ========================================================================== */

/**
 * How an entity is allowed to traverse the grid. A superset of `Locomotor`:
 * ships and aircraft share `Locomotor.Hover` in the entity store because the
 * core enum is frozen, so pathing carries its own vocabulary.
 */
export const enum MoveClass {
  /** Infantry. Climbs anything short of a cliff, ignores roads. */
  Foot = 0,
  /** Tracked. Turns in place, punished on rough ground, mildly likes roads. */
  Track = 1,
  /** Wheeled. Loves roads, hates rough ground, needs a turning circle. */
  Wheel = 2,
  /** Hovercraft — amphibious. Land and water, immune to slope cost. */
  Hover = 3,
  /** Ships. WATER ONLY. */
  Naval = 4,
  /** Aircraft. Ignores the grid entirely; fields for this class are direct. */
  Air = 5,
}
export const MOVE_CLASS_COUNT = 6;

/** Human-readable names, for the boot log and the debug overlay. */
export const MOVE_CLASS_NAMES: readonly string[] =
  ['foot', 'track', 'wheel', 'hover', 'naval', 'air'];

/** Default mapping. `Locomotor.Static` never pathfinds; it maps to Foot. */
export function moveClassForLocomotor(loco: number): MoveClass {
  switch (loco) {
    case Locomotor.Foot: return MoveClass.Foot;
    case Locomotor.Track: return MoveClass.Track;
    case Locomotor.Wheel: return MoveClass.Wheel;
    case Locomotor.Hover: return MoveClass.Hover;
    default: return MoveClass.Foot;
  }
}

/** The `Locomotor` a MoveClass reports to `ITerrain.isPassable`. */
export function locomotorForMoveClass(cls: MoveClass): Locomotor {
  switch (cls) {
    case MoveClass.Track: return Locomotor.Track;
    case MoveClass.Wheel: return Locomotor.Wheel;
    case MoveClass.Hover:
    case MoveClass.Naval: return Locomotor.Hover;
    default: return Locomotor.Foot;
  }
}

/** True for classes that are unaffected by ground obstacles. */
export function isFlying(cls: MoveClass): boolean {
  return cls === MoveClass.Air;
}

/** True for classes that live on water. */
export function isFloating(cls: MoveClass): boolean {
  return cls === MoveClass.Naval;
}

/* ==========================================================================
 * 2. CONSTANTS AND SCRATCH
 * ========================================================================== */

/** Unreached. Deliberately not Infinity so the field can stay an Int32Array. */
const INF = 0x7fffffff;

/** sqrt(2), the diagonal step multiplier. */
const DIAG = 1.4142135623730951;

/** 8-neighbourhood, orthogonals first so the cheap cases hit early. */
const NX = new Int8Array([1, -1, 0, 0, 1, 1, -1, -1]);
const NZ = new Int8Array([0, 0, 1, -1, 1, -1, 1, -1]);
/** Index of the first diagonal in the tables above. */
const FIRST_DIAG = 4;

/** Ring-buffer capacity: the in-queue guard caps distinct members at one map. */
const QUEUE_CAP = MAP_CELL_COUNT + 1;

/* ==========================================================================
 * 3. COST FIELDS
 * ========================================================================== */

/**
 * One traversal-cost grid per MoveClass. `COST_UNIT` (100) is 1.0x; anything
 * >= COST_BLOCKED (255) is impassable.
 *
 * Rebuilt wholesale rather than patched: 16384 cells is ~40 microseconds and it
 * happens only when a structure appears or dies. An incremental patch would
 * need to re-derive the wall-hug ring around the edit anyway, which is most of
 * the work, for a much larger bug surface.
 */
class CostGrid {
  readonly cost = new Uint8Array(MAP_CELL_COUNT);
  /** Cost version this was built from. -1 = never built. */
  version = -1;
}

/* ==========================================================================
 * 4. FIELDS AND EXPANDERS
 * ========================================================================== */

/** One cached flow field. Buffers are allocated once and reused forever. */
class Field {
  /** Slot index; also the public handle. */
  readonly id: number;
  cls: MoveClass = MoveClass.Foot;
  /** Bucket-quantised, reachability-snapped goal cell. */
  goalCx = -1;
  goalCz = -1;
  /** Goal cell centre in metres, cached so sampling never recomputes it. */
  goalX = 0;
  goalZ = 0;
  /** Outstanding `requestField`/`addRef` claims. */
  refs = 0;
  /** Request serial, for LRU eviction. */
  lastUse = 0;
  /** True once the integration AND the flow pass have finished. */
  ready = false;
  /** Air: no expansion at all, `sample` points straight at the goal. */
  direct = false;
  /** Cost-grid version this was expanded against; a mismatch forces a redo. */
  costVersion = -1;
  /** True while waiting for an expander slot. */
  pending = false;

  /** Cost-to-goal in cost units. INF where unreached. */
  readonly dist = new Int32Array(MAP_CELL_COUNT);
  /** Quantised unit vector per cell, [x,z] pairs scaled by 127. */
  readonly flow = new Int8Array(MAP_CELL_COUNT * 2);

  constructor(id: number) { this.id = id; }

  /** Wipe every claim. Called on eviction and on dispose. */
  reset(): void {
    this.cls = MoveClass.Foot;
    this.goalCx = -1; this.goalCz = -1;
    this.refs = 0;
    this.ready = false;
    this.direct = false;
    this.costVersion = -1;
    this.pending = false;
  }
}

/**
 * A paused Dijkstra. One per concurrently-expanding field; the pool is small
 * (NAV_FIELD_EXPANDERS) because in practice one or two fields are in flight at
 * a time and each carries 80 KB of working state.
 */
class Expander {
  readonly queue = new Int32Array(QUEUE_CAP);
  readonly inQueue = new Uint8Array(MAP_CELL_COUNT);
  head = 0;
  tail = 0;
  count = 0;
  /** The field being expanded, or null when this expander is free. */
  field: Field | null = null;
  /** The cost grid the expansion reads. */
  cost: Uint8Array | null = null;

  get busy(): boolean { return this.field !== null; }

  /** Begin a fresh expansion from `field`'s goal. */
  begin(field: Field, cost: Uint8Array): void {
    this.field = field;
    this.cost = cost;
    this.head = 0; this.tail = 0; this.count = 0;
    field.dist.fill(INF);
    this.inQueue.fill(0);

    const gi = field.goalCz * MAP_CELLS + field.goalCx;
    field.dist[gi] = 0;
    this.push(gi);
  }

  push(cell: number): void {
    this.queue[this.tail] = cell;
    this.tail = this.tail + 1 === QUEUE_CAP ? 0 : this.tail + 1;
    this.count++;
    this.inQueue[cell] = 1;
  }

  pop(): number {
    const c = this.queue[this.head];
    this.head = this.head + 1 === QUEUE_CAP ? 0 : this.head + 1;
    this.count--;
    this.inQueue[c] = 0;
    return c;
  }

  /** Release without finishing (field evicted or invalidated mid-flight). */
  abandon(): void {
    this.field = null;
    this.cost = null;
    this.count = 0;
    this.head = 0;
    this.tail = 0;
  }

  /**
   * Relax up to `budget` cells. Returns the number actually processed, so the
   * caller can hand the remainder to the next expander.
   */
  step(budget: number): number {
    const f = this.field;
    const cost = this.cost;
    if (f === null || cost === null) return 0;
    const dist = f.dist;
    let done = 0;

    while (this.count > 0 && done < budget) {
      const c = this.pop();
      const dc = dist[c];
      const cx = c % MAP_CELLS;
      const cz = (c / MAP_CELLS) | 0;
      done++;

      for (let d = 0; d < 8; d++) {
        const nx = cx + NX[d];
        const nz = cz + NZ[d];
        if (nx < 0 || nz < 0 || nx >= MAP_CELLS || nz >= MAP_CELLS) continue;
        const n = nz * MAP_CELLS + nx;
        const nc = cost[n];
        if (nc >= COST_BLOCKED) continue;

        let stepCost = nc;
        if (d >= FIRST_DIAG) {
          // No corner cutting: a tank may not squeeze between two building
          // corners that touch only diagonally. Without this, columns clip
          // through wall joints and look like they are phasing.
          if (cost[cz * MAP_CELLS + nx] >= COST_BLOCKED) continue;
          if (cost[nz * MAP_CELLS + cx] >= COST_BLOCKED) continue;
          stepCost = (nc * DIAG) | 0;
        }

        const nd = dc + stepCost;
        if (nd < dist[n]) {
          dist[n] = nd;
          if (this.inQueue[n] === 0) this.push(n);
        }
      }
    }
    return done;
  }

  /** True when the frontier is empty and the field can be finalised. */
  get finished(): boolean { return this.count === 0; }
}

/* ==========================================================================
 * 5. THE CACHE
 * ========================================================================== */

/** Diagnostics, mutated in place so reading them never allocates. */
export interface NavStats {
  fields: number;
  ready: number;
  pending: number;
  refs: number;
  cellsThisTick: number;
  rebuilds: number;
  misses: number;
  evictions: number;
}

/**
 * The `INav` implementation. One instance, published as `world.nav` by
 * `pathing.system.ts`.
 */
export class FlowFieldCache implements INav {
  private readonly fields: Field[] = [];
  private readonly expanders: Expander[] = [];
  private readonly grids: CostGrid[] = [];

  /** Bumped whenever any cost grid must be re-derived. */
  private costVersion = 0;
  /** Last `occupancyVersion()` we reacted to. */
  private seenOccupancy = -1;
  /** Monotonic request serial for LRU. */
  private serial = 1;

  /** The port, always present (the foundation ships a FlatTerrain). */
  private port: ITerrain;
  /** The concrete terrain when the terrain module is live, else null. */
  private terrain: Terrain | null = null;

  /** Ring of field ids waiting for an expander. */
  private readonly pendingRing = new Int32Array(FLOWFIELD_CACHE_SIZE + 1);
  private pendingHead = 0;
  private pendingTail = 0;
  private pendingCount = 0;

  readonly stats: NavStats = {
    fields: 0, ready: 0, pending: 0, refs: 0,
    cellsThisTick: 0, rebuilds: 0, misses: 0, evictions: 0,
  };

  constructor(port: ITerrain) {
    this.port = port;
    this.terrain = getTerrain();
    for (let i = 0; i < FLOWFIELD_CACHE_SIZE; i++) this.fields.push(new Field(i));
    for (let i = 0; i < NAV_FIELD_EXPANDERS; i++) this.expanders.push(new Expander());
    for (let i = 0; i < MOVE_CLASS_COUNT; i++) this.grids.push(new CostGrid());
  }

  /** Re-point at a terrain that landed after construction. */
  setTerrain(port: ITerrain): void {
    this.port = port;
    this.terrain = getTerrain();
    this.invalidateAll();
  }

  /* -- cost ------------------------------------------------------------- */

  /**
   * Cost grid for a class, rebuilt on demand. Public so Steering can read the
   * exact same numbers the field was built from when it tests a lookahead cell.
   */
  costGridFor(cls: MoveClass): Uint8Array {
    // Sync here as well as in `update()`: a query issued between ticks (the
    // placement validator, the AI, a test) must see a building that landed
    // this frame, not last tick's world.
    this.syncOccupancy();
    const g = this.grids[cls];
    if (g.version !== this.costVersion) this.rebuildCost(cls, g);
    return g.cost;
  }

  /** React to a structure appearing or dying. Idempotent and cheap. */
  private syncOccupancy(): void {
    const occ = this.port.occupancyVersion();
    if (occ === this.seenOccupancy) return;
    this.seenOccupancy = occ;
    this.invalidateAll();
  }

  /** Traversal cost of one cell, `COST_BLOCKED` when impassable. */
  costAt(cx: number, cz: number, cls: MoveClass): number {
    if (!isInMap(cx, cz)) return COST_BLOCKED;
    return this.costGridFor(cls)[cz * MAP_CELLS + cx];
  }

  /** True when `cls` may occupy the cell. */
  isPassableClass(cx: number, cz: number, cls: MoveClass): boolean {
    if (cls === MoveClass.Air) return isInMap(cx, cz);
    if (!isInMap(cx, cz)) return false;
    return this.costGridFor(cls)[cz * MAP_CELLS + cx] < COST_BLOCKED;
  }

  /**
   * Derive one class's cost grid from the terrain.
   *
   * Passability comes from terrain's `passGrid` bitfield when the real terrain
   * module is live (one array read per cell), and from the `ITerrain` port
   * otherwise. Naval inverts the test — a ship needs the cells a tank cannot
   * use — which is why this cannot just read `costGrid` and be done: terrain
   * marks every water cell COST_BLOCKED because it is authored for ground.
   */
  private rebuildCost(cls: MoveClass, g: CostGrid): void {
    const cost = g.cost;
    const t = this.terrain;
    const port = this.port;
    const loco = locomotorForMoveClass(cls);
    const passBit = 1 << loco;

    if (cls === MoveClass.Air) {
      // Aircraft ignore the grid. A uniform grid keeps every other code path
      // (nearestReachable, isDirectPathClear, costAt) branch-free for them.
      cost.fill(COST_UNIT);
      g.version = this.costVersion;
      this.stats.rebuilds++;
      return;
    }

    const roads = getRoads() !== null;
    const roadCost = Math.max(1, Math.round(COST_UNIT * NAV_COST_ROAD[cls]));
    const roughCost = Math.max(1, Math.round(COST_UNIT * NAV_COST_ROUGH[cls]));
    const rampCost = Math.max(1, Math.round(COST_UNIT * NAV_COST_RAMP));

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      const row = cz * MAP_CELLS;
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = row + cx;

        // --- passability ---------------------------------------------------
        let ok: boolean;
        let water: boolean;
        if (t !== null) {
          water = t.waterGrid[i] !== 0;
          ok = (t.passGrid[i] & passBit) !== 0;
        } else {
          water = port.isWater(cx, cz);
          ok = port.isPassable(cx, cz, loco);
        }
        if (cls === MoveClass.Naval) {
          // Ships need water AND enough of it: `passGrid`'s hover bit already
          // excludes cliffs and the map border, which is exactly the shoreline
          // test we want.
          ok = water && (t !== null ? (t.passGrid[i] & PASS_HOVER) !== 0 : true);
        } else if (cls !== MoveClass.Hover && water) {
          ok = false;
        }
        // Structures block everything that touches the ground.
        if (ok && port.isOccupied(cx, cz)) ok = false;

        if (!ok) { cost[i] = COST_BLOCKED; continue; }

        // --- cost ----------------------------------------------------------
        // Road first: a carriageway is the one thing that makes a cell CHEAP,
        // and it is what makes convoys spontaneously form up on the network
        // instead of cutting across the grass. The road module owns its own
        // 2 m mask, so we ask it at the cell centre rather than guessing from
        // the terrain splat.
        let c = COST_UNIT;
        const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
        const onRoad = roads && cls !== MoveClass.Naval && isCarriageway(wx, wz);
        if (onRoad) {
          c = Math.max(1, Math.round(roadCost * roadMoveMultiplier(wx, wz)));
        } else if (t !== null) {
          const surface = t.surface[i] as SurfaceId;
          if (surface === SurfaceId.Concrete || surface === SurfaceId.Paving) {
            // Painted paving on a map with no road network (bases, pads).
            c = roadCost;
          } else if (t.rampGrid[i] !== 0) {
            c = rampCost;
          } else if (cls !== MoveClass.Hover && cls !== MoveClass.Naval
                     && t.costGrid[i] > COST_UNIT && t.costGrid[i] < COST_BLOCKED) {
            // Terrain already classified this cell as rough; scale its verdict
            // by how much THIS chassis minds.
            c = roughCost;
          }
        }
        cost[i] = c;
      }
    }

    // --- wall-hug penalty ---------------------------------------------------
    // A pure shortest path glues itself to every obstacle corner, so a column
    // rounding a Construction Yard scrapes the wall and the tail catches on it.
    // One dilation pass costs 16k reads and buys a metre of clearance.
    const hug = NAV_COST_WALL_HUG;
    if (hug > 1) {
      for (let cz = 0; cz < MAP_CELLS; cz++) {
        const row = cz * MAP_CELLS;
        for (let cx = 0; cx < MAP_CELLS; cx++) {
          const i = row + cx;
          if (cost[i] >= COST_BLOCKED) continue;
          let adjacent = false;
          if (cx > 0 && cost[i - 1] >= COST_BLOCKED) adjacent = true;
          else if (cx < MAP_CELLS - 1 && cost[i + 1] >= COST_BLOCKED) adjacent = true;
          else if (cz > 0 && cost[i - MAP_CELLS] >= COST_BLOCKED) adjacent = true;
          else if (cz < MAP_CELLS - 1 && cost[i + MAP_CELLS] >= COST_BLOCKED) adjacent = true;
          if (adjacent) {
            const v = Math.round(cost[i] * hug);
            cost[i] = v >= COST_BLOCKED ? COST_BLOCKED - 1 : v;
          }
        }
      }
    }

    g.version = this.costVersion;
    this.stats.rebuilds++;
  }

  /* -- invalidation ------------------------------------------------------ */

  /**
   * Throw away every cost grid and force every live field to re-expand.
   * Called when a building is placed or dies, or when the terrain is replaced.
   */
  invalidateAll(): void {
    this.costVersion++;
    for (let i = 0; i < this.expanders.length; i++) this.expanders[i].abandon();
    // Drain the ring FIRST and clear every `pending` flag with it, or
    // `enqueuePending` below sees a stale flag and silently drops the field —
    // which strands it un-expanded forever.
    this.pendingHead = 0; this.pendingTail = 0; this.pendingCount = 0;
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      f.pending = false;
      if (f.goalCx < 0) continue;
      f.ready = false;
      f.costVersion = -1;
    }
    // Everything still claimed goes back in the queue.
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.goalCx >= 0 && f.refs > 0 && !f.direct) this.enqueuePending(f);
    }
  }

  /**
   * Footprint-scoped invalidation. Coarse on purpose: a flow field is global,
   * so any edit changes it everywhere downstream of the edit. The signature
   * keeps the door open for a future region-scoped rebuild without changing
   * every call site.
   */
  invalidate(_cx: number, _cz: number, _w: number, _h: number): void {
    this.invalidateAll();
  }

  /* -- field lifecycle --------------------------------------------------- */

  /** Quantise one axis of a goal to its bucket representative cell. */
  private bucket(c: number): number {
    const b = FLOWFIELD_GOAL_BUCKET;
    const q = Math.floor(clampCell(c) / b) * b + (b >> 1);
    return clampCell(q);
  }

  /** INav: request by `Locomotor`. */
  requestField(goalCx: number, goalCz: number, loco: Locomotor): number {
    return this.requestFieldClass(goalCx, goalCz, moveClassForLocomotor(loco));
  }

  /**
   * Request a field toward (goalCx, goalCz) for `cls`. The goal is quantised
   * into a FLOWFIELD_GOAL_BUCKET bucket and then snapped to the nearest cell
   * the class can actually stand on, so an order onto a cliff or into a
   * building still produces a usable field.
   *
   * Returns a field handle, or -1 when the cache is fully pinned (in which
   * case the caller should fall back to direct seek — see Steering.ts).
   */
  requestFieldClass(goalCx: number, goalCz: number, cls: MoveClass): number {
    let gx = this.bucket(goalCx);
    let gz = this.bucket(goalCz);

    if (cls !== MoveClass.Air && !this.isPassableClass(gx, gz, cls)) {
      if (this.snapToReachable(gx, gz, cls, SNAP_OUT)) {
        gx = SNAP_OUT[0]; gz = SNAP_OUT[1];
      } else if (this.snapToReachable(clampCell(goalCx), clampCell(goalCz), cls, SNAP_OUT)) {
        gx = SNAP_OUT[0]; gz = SNAP_OUT[1];
      } else {
        return -1;
      }
    }

    // --- hit ---------------------------------------------------------------
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.goalCx === gx && f.goalCz === gz && f.cls === cls && f.goalCx >= 0) {
        f.refs++;
        f.lastUse = this.serial++;
        return f.id;
      }
    }

    // --- miss: find a slot -------------------------------------------------
    this.stats.misses++;
    let victim: Field | null = null;
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.refs > 0) continue;
      if (f.goalCx < 0) { victim = f; break; }          // never used — free
      if (victim === null || f.lastUse < victim.lastUse) victim = f;
    }
    if (victim === null) return -1;                      // every field pinned
    if (victim.goalCx >= 0) this.stats.evictions++;

    this.detachExpander(victim);
    victim.reset();
    victim.cls = cls;
    victim.goalCx = gx;
    victim.goalCz = gz;
    victim.goalX = (gx + 0.5) * CELL;
    victim.goalZ = (gz + 0.5) * CELL;
    victim.refs = 1;
    victim.lastUse = this.serial++;
    victim.costVersion = this.costVersion;

    if (cls === MoveClass.Air) {
      // No expansion: `sample` returns the bearing to the goal.
      victim.direct = true;
      victim.ready = true;
    } else {
      this.enqueuePending(victim);
    }
    return victim.id;
  }

  addRef(field: number): void {
    const f = this.fieldAt(field);
    if (f === null) return;
    f.refs++;
    f.lastUse = this.serial++;
  }

  release(field: number): void {
    const f = this.fieldAt(field);
    if (f === null) return;
    if (f.refs > 0) f.refs--;
    // The field STAYS cached at refs 0 — the next order to the same bucket
    // (which is what a repath or a follow-up click is) then costs nothing.
  }

  isReady(field: number): boolean {
    const f = this.fieldAt(field);
    return f !== null && f.ready;
  }

  /** The world position this field flows toward. Writes [x,z]. */
  goalOf(field: number, out: Float32Array): boolean {
    const f = this.fieldAt(field);
    if (f === null) return false;
    out[0] = f.goalX; out[1] = f.goalZ;
    return true;
  }

  /** The MoveClass a field was built for, or -1. */
  classOf(field: number): number {
    const f = this.fieldAt(field);
    return f === null ? -1 : f.cls;
  }

  /** Cost-to-goal at a cell in cost units, or -1 when unreached. */
  costToGoal(field: number, cx: number, cz: number): number {
    const f = this.fieldAt(field);
    if (f === null || !isInMap(cx, cz)) return -1;
    if (f.direct) return 0;
    const d = f.dist[cz * MAP_CELLS + cx];
    return d === INF ? -1 : d;
  }

  private fieldAt(field: number): Field | null {
    if (field < 0 || field >= this.fields.length) return null;
    const f = this.fields[field];
    return f.goalCx < 0 ? null : f;
  }

  private enqueuePending(f: Field): void {
    if (f.pending) return;
    f.pending = true;
    this.pendingRing[this.pendingTail] = f.id;
    this.pendingTail = this.pendingTail + 1 === this.pendingRing.length ? 0 : this.pendingTail + 1;
    this.pendingCount++;
  }

  private dequeuePending(): Field | null {
    while (this.pendingCount > 0) {
      const id = this.pendingRing[this.pendingHead];
      this.pendingHead = this.pendingHead + 1 === this.pendingRing.length ? 0 : this.pendingHead + 1;
      this.pendingCount--;
      const f = this.fields[id];
      if (f.pending && f.goalCx >= 0 && !f.ready) { f.pending = false; return f; }
      f.pending = false;
    }
    return null;
  }

  private detachExpander(f: Field): void {
    for (let i = 0; i < this.expanders.length; i++) {
      if (this.expanders[i].field === f) { this.expanders[i].abandon(); return; }
    }
  }

  /* -- per-tick work ----------------------------------------------------- */

  /**
   * Advance every in-flight expansion by at most `budget` cells IN TOTAL.
   * Called once per tick from Phase.PathRequest.
   */
  update(budget: number = FLOWFIELD_BUDGET_CELLS): void {
    // 1. React to structures appearing or dying.
    this.syncOccupancy();

    // 2. Anything stale that still has claims goes back in the queue.
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.goalCx < 0 || f.direct) continue;
      if (f.costVersion !== this.costVersion && f.refs > 0) {
        f.costVersion = this.costVersion;
        f.ready = false;
        this.detachExpander(f);
        this.enqueuePending(f);
      }
    }

    // 3. Fill free expanders.
    for (let i = 0; i < this.expanders.length; i++) {
      const e = this.expanders[i];
      if (e.busy) continue;
      const f = this.dequeuePending();
      if (f === null) break;
      f.costVersion = this.costVersion;
      e.begin(f, this.costGridFor(f.cls));
    }

    // 4. Spend the budget. Split evenly so one huge field cannot starve a
    //    second order issued on the same tick.
    let active = 0;
    for (let i = 0; i < this.expanders.length; i++) if (this.expanders[i].busy) active++;
    let spent = 0;
    if (active > 0) {
      const share = Math.max(NAV_MIN_EXPANDER_BUDGET, (budget / active) | 0);
      for (let i = 0; i < this.expanders.length; i++) {
        const e = this.expanders[i];
        if (!e.busy) continue;
        const allowance = Math.min(share, budget - spent);
        if (allowance <= 0) break;
        spent += e.step(allowance);
        if (e.finished) {
          const f = e.field!;
          this.buildFlow(f, e.cost!);
          f.ready = true;
          e.abandon();
        }
      }
    }

    this.refreshStats(spent);
  }

  /**
   * One pass over the integration field turning cost-to-goal into a direction
   * per cell: point at whichever 8-neighbour is cheapest. The quantised Int8
   * storage costs 32 KB per field and makes `sample` four array reads.
   */
  private buildFlow(f: Field, cost: Uint8Array): void {
    const dist = f.dist;
    const flow = f.flow;
    flow.fill(0);

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      const row = cz * MAP_CELLS;
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = row + cx;
        const di = dist[i];
        if (di === INF || di === 0) continue;   // unreached, or the goal itself

        let best = di;
        let bx = 0, bz = 0;
        for (let d = 0; d < 8; d++) {
          const nx = cx + NX[d];
          const nz = cz + NZ[d];
          if (nx < 0 || nz < 0 || nx >= MAP_CELLS || nz >= MAP_CELLS) continue;
          if (d >= FIRST_DIAG) {
            if (cost[row + nx] >= COST_BLOCKED) continue;
            if (cost[nz * MAP_CELLS + cx] >= COST_BLOCKED) continue;
          }
          const nd = dist[nz * MAP_CELLS + nx];
          if (nd < best) { best = nd; bx = NX[d]; bz = NZ[d]; }
        }
        if (bx === 0 && bz === 0) continue;

        if (bx !== 0 && bz !== 0) {
          // 127 / sqrt(2) — keeps the quantised vector unit length.
          flow[i * 2] = bx * 90;
          flow[i * 2 + 1] = bz * 90;
        } else {
          flow[i * 2] = bx * 127;
          flow[i * 2 + 1] = bz * 127;
        }
      }
    }
  }

  private refreshStats(cells: number): void {
    const s = this.stats;
    let fields = 0, ready = 0, refs = 0;
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.goalCx < 0) continue;
      fields++;
      if (f.ready) ready++;
      refs += f.refs;
    }
    s.fields = fields;
    s.ready = ready;
    s.refs = refs;
    s.pending = this.pendingCount;
    s.cellsThisTick = cells;
  }

  /* -- sampling ---------------------------------------------------------- */

  /**
   * Bilinear flow direction at a world position, written into `out` as
   * [dx, dz] (unit length). False when the position has no direction at all —
   * outside the map, or standing in a pocket the expansion never reached.
   *
   * The blend is over the four cell CENTRES surrounding the sample, weighted
   * by proximity, and cells with no direction are dropped from the blend
   * rather than contributing a zero (which would drag the result toward a
   * wall). That is what stops a column from visibly stair-stepping down a
   * diagonal corridor.
   */
  sample(field: number, x: number, z: number, out: Float32Array): boolean {
    const f = this.fieldAt(field);
    if (f === null) return false;

    if (f.direct) {
      const dx = f.goalX - x, dz = f.goalZ - z;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l < 1e-4) { out[0] = 0; out[1] = 0; return true; }
      out[0] = dx / l; out[1] = dz / l;
      return true;
    }

    const fx = x / CELL - 0.5;
    const fz = z / CELL - 0.5;
    const c0x = Math.floor(fx);
    const c0z = Math.floor(fz);
    const tx = fx - c0x;
    const tz = fz - c0z;

    let ax = 0, az = 0, wsum = 0;
    const flow = f.flow;
    for (let k = 0; k < 4; k++) {
      const ox = k & 1;
      const oz = k >> 1;
      const cx = c0x + ox;
      const cz = c0z + oz;
      if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) continue;
      const w = (ox === 0 ? 1 - tx : tx) * (oz === 0 ? 1 - tz : tz);
      if (w <= 0) continue;
      const i = (cz * MAP_CELLS + cx) * 2;
      const vx = flow[i], vz = flow[i + 1];
      if (vx === 0 && vz === 0) continue;
      ax += vx * w; az += vz * w; wsum += w;
    }

    if (wsum > 0) {
      const l = Math.sqrt(ax * ax + az * az);
      if (l > 1e-4) { out[0] = ax / l; out[1] = az / l; return true; }
    }

    // No flow anywhere near: either we are standing on the goal, or we are
    // stranded. Head for the goal directly and let steering sort it out.
    const cx = worldToCell(x), cz = worldToCell(z);
    if (!isInMap(cx, cz)) return false;
    if (f.dist[cz * MAP_CELLS + cx] === INF && !(cx === f.goalCx && cz === f.goalCz)) {
      return false;
    }
    const dx = f.goalX - x, dz = f.goalZ - z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-4) { out[0] = 0; out[1] = 0; return true; }
    out[0] = dx / l; out[1] = dz / l;
    return true;
  }

  /* -- queries ----------------------------------------------------------- */

  /** INav: straight-line clearance test by `Locomotor`. */
  isDirectPathClear(
    x0: number, z0: number, x1: number, z1: number, loco: Locomotor,
  ): boolean {
    return this.isDirectPathClearClass(x0, z0, x1, z1, moveClassForLocomotor(loco));
  }

  /**
   * Supercover line walk: every cell the segment touches must be traversable.
   * This is the string-pulling test — when it passes, a unit ignores the flow
   * field and drives straight, which is what removes the last of the grid
   * stair-stepping on open ground.
   */
  isDirectPathClearClass(
    x0: number, z0: number, x1: number, z1: number, cls: MoveClass,
  ): boolean {
    if (cls === MoveClass.Air) return true;
    const cost = this.costGridFor(cls);

    let cx = worldToCell(x0);
    let cz = worldToCell(z0);
    const ex = worldToCell(x1);
    const ez = worldToCell(z1);
    if (!isInMap(cx, cz) || !isInMap(ex, ez)) return false;
    if (cost[cz * MAP_CELLS + cx] >= COST_BLOCKED) return false;

    const dx = x1 - x0;
    const dz = z1 - z0;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    // Parametric (t in 0..1 along the segment) distance to the next grid line.
    let tMaxX = adx > 1e-9 ? (dx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (dz > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / adz : Infinity;
    const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
    const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;

    // Bounded so a degenerate input can never spin: a diagonal crossing of the
    // whole map touches at most 2*MAP_CELLS cells.
    for (let guard = 0; guard < MAP_CELLS * 2 + 2; guard++) {
      if (cx === ex && cz === ez) return true;
      // Both parameters past the far endpoint: the segment ended inside the
      // cell we are standing in, and it was clear.
      if (tMaxX > 1 && tMaxZ > 1) return true;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; }
      else { cz += stepZ; tMaxZ += tDeltaZ; }
      if (!isInMap(cx, cz)) return false;
      if (cost[cz * MAP_CELLS + cx] >= COST_BLOCKED) return false;
    }
    return true;
  }

  /** INav: nearest standable cell by `Locomotor`. Writes [cx,cz]. */
  nearestReachable(cx: number, cz: number, loco: Locomotor, out: Int32Array): boolean {
    return this.snapToReachable(clampCell(cx), clampCell(cz), moveClassForLocomotor(loco), out);
  }

  /**
   * Outward ring search for a cell `cls` can stand on. Rings are walked in a
   * fixed order (+X edge, +Z edge, -X edge, -Z edge) so the answer is stable
   * across runs — a wobbling "nearest" would desync a replay.
   */
  snapToReachable(cx: number, cz: number, cls: MoveClass, out: Int32Array): boolean {
    cx = clampCell(cx); cz = clampCell(cz);
    if (this.isPassableClass(cx, cz, cls)) { out[0] = cx; out[1] = cz; return true; }
    for (let r = 1; r <= NAV_SNAP_SEARCH_CELLS; r++) {
      for (let d = -r; d <= r; d++) {
        if (this.tryCell(cx + d, cz - r, cls, out)) return true;
        if (this.tryCell(cx + d, cz + r, cls, out)) return true;
      }
      for (let d = -r + 1; d <= r - 1; d++) {
        if (this.tryCell(cx - r, cz + d, cls, out)) return true;
        if (this.tryCell(cx + r, cz + d, cls, out)) return true;
      }
    }
    return false;
  }

  private tryCell(cx: number, cz: number, cls: MoveClass, out: Int32Array): boolean {
    if (!this.isPassableClass(cx, cz, cls)) return false;
    out[0] = cx; out[1] = cz;
    return true;
  }

  /**
   * Surface height a unit of this class rides at. Ground classes conform to
   * the heightfield; ships sit on the waterline; hovercraft take whichever is
   * higher so an amphibian crossing a beach never dips through the sand.
   */
  rideHeight(cls: MoveClass, x: number, z: number): number {
    const ground = this.port.heightAt(x, z);
    if (cls === MoveClass.Naval) return WATER_LEVEL;
    if (cls === MoveClass.Hover) return ground > WATER_LEVEL ? ground : WATER_LEVEL;
    return ground;
  }

  /** The terrain port, for callers that already hold the cache. */
  get terrainPort(): ITerrain { return this.port; }

  /** Fully clear the cache. Between matches only. */
  reset(): void {
    for (let i = 0; i < this.expanders.length; i++) this.expanders[i].abandon();
    for (let i = 0; i < this.fields.length; i++) this.fields[i].reset();
    this.pendingHead = 0; this.pendingTail = 0; this.pendingCount = 0;
    this.costVersion++;
    this.seenOccupancy = -1;
    this.serial = 1;
  }

  dispose(): void {
    this.reset();
  }
}

/** Scratch for goal snapping. Module-level so `requestField` never allocates. */
const SNAP_OUT = new Int32Array(2);

/* ==========================================================================
 * 6. MODULE ACCESSOR
 *
 * `world.nav` is the port and covers most needs. This is for the two callers
 * (Steering, Movement) that want the MoveClass-aware surface the port cannot
 * express, plus anything that wants to read cost cells for a debug overlay.
 * ========================================================================== */

let active: FlowFieldCache | null = null;

export function getNav(): FlowFieldCache | null {
  return active;
}

export function setActiveNav(next: FlowFieldCache | null): void {
  active = next;
}

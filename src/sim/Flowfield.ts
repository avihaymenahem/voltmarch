/**
 * ============================================================================
 * VOLTMARCH — src/sim/Flowfield.ts
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
 *  1. COST FIELD — TWO Uint8Arrays per MoveClass. `hard` is physics: terrain
 *     passability + slope + water + building footprints. `cost` is planning:
 *     the same thing plus roads, the CLEARANCE rule (§4c — a slot narrower than
 *     the hull is not a corridor) and a "do not hug the wall" penalty ring.
 *     Movement asks `hard`, the planner asks `cost`, and they are separate
 *     because a planning rule applied to physics imprisons units. Rebuilt only
 *     when `ITerrain.occupancyVersion()` changes, i.e. when a building is
 *     placed, sold or destroyed.
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
 * `Locomotor` (core/types) has an Air member and no Naval one, so aircraft
 * declare themselves in the entity store and ships still spawn as
 * `Locomotor.Hover`. `MoveClass` is the pathing vocabulary and carries both.
 * `moveClassForLocomotor` is the default mapping; Movement.ts owns the
 * per-entity override (`setMoveClass`), which is what promotes a Hover hull
 * standing in water to Naval.
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
  NAV_FIELD_EXPANDERS, NAV_MIN_EXPANDER_BUDGET, NAV_MIN_CORRIDOR_CELLS,
  NAV_SNAP_SEARCH_CELLS, WATER_LEVEL,
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
 * ships still share `Locomotor.Hover` in the entity store (there is no Naval
 * member), so pathing carries its own vocabulary. Air is the one class that is
 * BOTH — `Locomotor.Air` exists and maps straight through.
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
    case Locomotor.Air: return MoveClass.Air;
    default: return MoveClass.Foot;
  }
}

/**
 * The `Locomotor` a MoveClass reports to `ITerrain.isPassable`.
 *
 * Air deliberately answers `Foot` and NOT `Locomotor.Air`. This is the
 * terrain-passability question, and `passGrid` has no bit 5 — asking it about
 * an aircraft would return "impassable everywhere". The only caller is
 * `rebuildCost`, which returns for Air before it ever reads this, so the value
 * is a safe default rather than a claim; keeping it `Foot` means a future
 * caller gets a sane grid instead of a sealed map.
 */
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
  /**
   * The ROUTING grid: what the planner is allowed to send a unit down. It is
   * the physical grid plus the clearance rule (§3b) plus the wall-hug ring.
   */
  readonly cost = new Uint8Array(MAP_CELL_COUNT);
  /**
   * The PHYSICAL grid: `COST_BLOCKED` only where the ground or a structure
   * genuinely forbids the class. Never carries the clearance demotion.
   *
   * The split exists because the two questions are different and conflating
   * them is how a clearance rule turns into a freeze. "Do not PLAN a route
   * through this slot" is a planning rule and belongs in `cost`. "This unit may
   * not occupy this cell" is a physics rule, and applying the planning rule
   * there would imprison every unit that is already standing in a slot when the
   * building next to it finishes — the exact failure the clearance rule exists
   * to prevent, inflicted by the fix.
   */
  readonly hard = new Uint8Array(MAP_CELL_COUNT);
  /** Cells the clearance rule demoted this build. Diagnostics. */
  narrow = 0;
  /** Cells it had to hand back because they were the only way through. */
  restored = 0;
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
 * 4b. CONNECTIVITY — WHICH CELLS CAN ACTUALLY REACH WHICH
 *
 * A flow field answers "which way to the goal", but it says nothing useful
 * when there IS no way: the integration simply never reaches the unit's cell,
 * `sample` falls through to the raw bearing, and the unit drives into the
 * cliff and stays there. The reported bug — "tanks spawned in a valley cannot
 * get out" — is exactly that failure, and it is invisible because grinding
 * against a wall looks like pathing rather than like an error.
 *
 * So the grid is also LABELLED: every passable cell carries the id of its
 * connected component. Two cells are mutually reachable iff their labels
 * match, which turns "is this order even possible?" from a search into two
 * array reads, cheap enough to ask every tick for every unit.
 *
 * 4-CONNECTED, deliberately. The expander is 8-connected but refuses to cut
 * corners (both orthogonal neighbours of a diagonal step must be open), so two
 * areas touching only at a corner are NOT mutually reachable — labelling them
 * 8-connected would call an impossible order possible, which is the exact
 * class of lie this layer exists to stop.
 * ========================================================================== */

/**
 * A stranded region at or below this many cells is a POCKET: a hole in the
 * map, not a plateau or an island worth fighting over. For scale,
 * `TERRAIN_MIN_REGION_CELLS` (28) is the size below which the generator's ramp
 * carver deliberately gives up, and every stranded pocket measured on the
 * shipping seeds came in under it — so this threshold has real headroom while
 * staying far below anything a player would call terrain.
 */
export const NAV_POCKET_MAX_CELLS = 96;

/**
 * Cells of contiguous open water below which a map has no navy.
 *
 * See `mapSupportsNaval`. Declared beside the other connectivity constants
 * because it is the same kind of fact about the same labelling.
 */
export const NAVAL_MAP_MIN_CELLS = 400;

/**
 * Ring radius, in cells, for every region-aware search here (retargeting an
 * unreachable goal, lifting a trapped unit out of a pocket). 40 cells is 160 m
 * — far enough to escape any pocket the generator can leave behind, short
 * enough that a failed search is bounded work and a successful one never
 * teleports a unit across the map.
 */
export const NAV_REGION_SEARCH_CELLS = 40;

/** Labelled connected components of one passability mask. */
class RegionGrid {
  /** Component id per cell. 0 = impassable. */
  readonly label = new Int32Array(MAP_CELL_COUNT);
  /** `sizes[k]` is the cell count of component k. Index 0 is unused. */
  readonly sizes: number[] = [0];
  /** Id of the largest component, or 0 when nothing is passable. */
  main = 0;
  /** Number of distinct components. */
  count = 0;
  /** Total passable cells across every component. */
  passable = 0;
  /** Cost/occupancy version this labelling was derived from. -1 = never. */
  version = -1;
}

/**
 * Flood-fill scratch. Module level and shared because `labelRegions` is
 * synchronous and non-reentrant, and because every cell is pushed at most once
 * (the label is written on push), so the stack can never exceed one map.
 */
const REGION_STACK = new Int32Array(MAP_CELL_COUNT);
/** Scratch passability mask, filled immediately before each labelling. */
const OPEN_MASK = new Uint8Array(MAP_CELL_COUNT);

/** 4-connected flood label of `open` (non-zero = passable) into `g`. */
function labelRegions(open: Uint8Array, g: RegionGrid): void {
  const id = g.label;
  const sizes = g.sizes;
  id.fill(0);
  sizes.length = 1;
  sizes[0] = 0;

  let next = 0;
  let passable = 0;

  for (let start = 0; start < MAP_CELL_COUNT; start++) {
    if (id[start] !== 0 || open[start] === 0) continue;
    next++;
    let area = 0;
    let sp = 0;
    REGION_STACK[sp++] = start;
    id[start] = next;

    while (sp > 0) {
      const c = REGION_STACK[--sp];
      area++;
      const cx = c % MAP_CELLS;
      const cz = (c / MAP_CELLS) | 0;
      if (cx > 0) {
        const n = c - 1;
        if (id[n] === 0 && open[n] !== 0) { id[n] = next; REGION_STACK[sp++] = n; }
      }
      if (cx < MAP_CELLS - 1) {
        const n = c + 1;
        if (id[n] === 0 && open[n] !== 0) { id[n] = next; REGION_STACK[sp++] = n; }
      }
      if (cz > 0) {
        const n = c - MAP_CELLS;
        if (id[n] === 0 && open[n] !== 0) { id[n] = next; REGION_STACK[sp++] = n; }
      }
      if (cz < MAP_CELLS - 1) {
        const n = c + MAP_CELLS;
        if (id[n] === 0 && open[n] !== 0) { id[n] = next; REGION_STACK[sp++] = n; }
      }
    }
    sizes[next] = area;
    passable += area;
  }

  let main = 0;
  for (let k = 1; k <= next; k++) if (main === 0 || sizes[k] > sizes[main]) main = k;
  g.count = next;
  g.main = main;
  g.passable = passable;
}

/**
 * Outward ring search for the nearest cell belonging to `region`. Rings are
 * walked in exactly the order `snapToReachable` uses (+Z edge, -Z edge, then
 * the two X edges), so two runs of one seed pick the same cell and a replay
 * cannot desync on a rescue.
 */
function nearestCellInRegion(
  g: RegionGrid, cx: number, cz: number, region: number, maxRadius: number, out: Int32Array,
): boolean {
  cx = clampCell(cx); cz = clampCell(cz);
  if (region <= 0) return false;
  if (g.label[cz * MAP_CELLS + cx] === region) { out[0] = cx; out[1] = cz; return true; }

  for (let r = 1; r <= maxRadius; r++) {
    for (let d = -r; d <= r; d++) {
      if (regionHit(g, cx + d, cz - r, region, out)) return true;
      if (regionHit(g, cx + d, cz + r, region, out)) return true;
    }
    for (let d = -r + 1; d <= r - 1; d++) {
      if (regionHit(g, cx - r, cz + d, region, out)) return true;
      if (regionHit(g, cx + r, cz + d, region, out)) return true;
    }
  }
  return false;
}

function regionHit(
  g: RegionGrid, cx: number, cz: number, region: number, out: Int32Array,
): boolean {
  if (!isInMap(cx, cz)) return false;
  if (g.label[cz * MAP_CELLS + cx] !== region) return false;
  out[0] = cx; out[1] = cz;
  return true;
}

/**
 * Connectivity of the RAW HEIGHTFIELD for one locomotor — what a unit could
 * traverse if no structure existed.
 *
 * Separate from `FlowFieldCache`'s per-MoveClass labelling on purpose. The
 * cache labels the cost grid, which carves out every building footprint, and
 * that is the right question for a live order. It is the WRONG question at
 * scenario build time: a courtyard temporarily sealed by its own base is not a
 * terrain trap, and a structure the player will sell is not a permanent wall.
 * The bug this guards against is a hole in the GROUND, so this reads the
 * ground.
 *
 * Built once and then immutable: construct it before the first structure lands
 * (`ITerrain.isPassable` reports occupied cells as closed) and it stays an
 * honest picture of the terrain for the whole build.
 */
export class TerrainRegions {
  private readonly grid = new RegionGrid();

  constructor(port: ITerrain, readonly locomotor: Locomotor) {
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      const row = cz * MAP_CELLS;
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        OPEN_MASK[row + cx] = port.isPassable(cx, cz, locomotor) ? 1 : 0;
      }
    }
    labelRegions(OPEN_MASK, this.grid);
    this.grid.version = 0;
  }

  /** Number of distinct passable components. */
  get regionCount(): number { return this.grid.count; }
  /** Cells in the largest component. */
  get mainRegionCells(): number { return this.grid.sizes[this.grid.main] ?? 0; }
  /** Passable cells in total. */
  get passableCells(): number { return this.grid.passable; }
  /** Fraction of passable ground the main component holds. 1 when empty. */
  get mainFraction(): number {
    return this.grid.passable > 0 ? this.mainRegionCells / this.grid.passable : 1;
  }

  /** Component id at a cell; 0 when impassable or off-map. */
  regionAt(cx: number, cz: number): number {
    if (!isInMap(cx, cz)) return 0;
    return this.grid.label[cz * MAP_CELLS + cx];
  }

  /** Cells in the component at a cell, 0 when impassable. */
  regionCellsAt(cx: number, cz: number): number {
    const r = this.regionAt(cx, cz);
    return r > 0 ? this.grid.sizes[r] : 0;
  }

  /** True when the cell is part of the main component — i.e. can be left. */
  isMain(cx: number, cz: number): boolean {
    return this.grid.main > 0 && this.regionAt(cx, cz) === this.grid.main;
  }

  /** Nearest main-component cell, written into `out` as [cx,cz]. */
  nearestMain(cx: number, cz: number, out: Int32Array, maxRadius: number): boolean {
    return nearestCellInRegion(this.grid, cx, cz, this.grid.main, maxRadius, out);
  }
}

/* ==========================================================================
 * 4c. CLEARANCE — A SLOT THE HULL DOES NOT FIT THROUGH IS NOT A CORRIDOR
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * The cost field carves out building footprints and nothing else. Two
 * structures placed one cell apart therefore leave a cell the planner reads as
 * a perfectly ordinary corridor. One cell is 4 m. The harvester — the unit the
 * bug was reported against — has a hull RADIUS of 3.87 m, so it is 7.74 m
 * across: it does not fit, it is sent in anyway, and it arrives at speed with a
 * separation force pushing off each wall. That is a trap, and no amount of
 * steering can be the answer to it, because the answer has to be "do not go in
 * there" and steering runs after that decision has been made.
 *
 * WHAT COUNTS AS NARROW
 * ---------------------
 * The FREE SPAN THROUGH THE CELL, measured independently along X and along Z as
 * the length of the maximal open run the cell belongs to. A cell is narrow when
 * the SMALLER of the two is under `NAV_MIN_CORRIDOR_CELLS[cls]`.
 *
 * That definition, and not a distance transform, is what separates the two
 * cases the brief is explicit about:
 *   - a one-cell alley:  runs are (long, 1) -> min 1 -> narrow.
 *   - a two-cell alley:  runs are (long, 2) -> min 2 -> legal.
 * A distance-to-nearest-obstacle field cannot tell those apart — both alleys
 * are one cell from a wall — which is why this measures span and not distance.
 * Open ground next to a wall stays legal for the same reason: its runs are the
 * whole room in both axes.
 *
 * IT CAN NEVER DISCONNECT THE MAP
 * -------------------------------
 * The obvious way to break a base is to close the only way out of it, so the
 * demotion is followed by a RESTORE pass with a proof rather than a threshold.
 * Demoted cells are labelled into their own 4-connected components. A component
 * that touches two or more DIFFERENT surviving regions is the only join between
 * them, so it is handed straight back. A component that touches one region or
 * none is a stub or a sealed pocket, and stays closed.
 *
 * Claim: any two routable cells connected in the physical grid stay connected.
 * Take a physical path between them and cut it into maximal runs of demoted
 * cells. Each such run lies inside one demoted component. The cells immediately
 * before and after the run are routable, so either they are in the same
 * surviving region — the path survives through that region — or they are in two
 * different ones, in which case the component touches both, is restored, and
 * the path survives through the component itself. There is no third case. QED.
 *
 * Cost: three linear passes and two flood fills over 16k cells, only when a
 * structure is placed or dies. That is the same trigger that already re-derives
 * every cost grid and re-expands every live field.
 * ========================================================================== */

/** Maximal open run through each cell along X and along Z, in cells. */
const RUN_X = new Int16Array(MAP_CELL_COUNT);
const RUN_Z = new Int16Array(MAP_CELL_COUNT);
/** 1 where the clearance rule wants the cell closed. */
const NARROW_MASK = new Uint8Array(MAP_CELL_COUNT);
/** The surviving-cell mask, i.e. physically open AND not narrow. */
const ROUTE_MASK = new Uint8Array(MAP_CELL_COUNT);
/** Components of the surviving cells, and of the demoted cells. */
const ROUTE_REGIONS = new RegionGrid();
const NARROW_REGIONS = new RegionGrid();
/** Per narrow component: the first surviving region it was seen touching. */
const TOUCHED = new Int32Array(MAP_CELL_COUNT + 1);
/** Per narrow component: 1 once it has been seen touching a second one. */
const BRIDGES = new Uint8Array(MAP_CELL_COUNT + 1);

/** Maximal open runs along both axes, from a blocked-cell predicate mask. */
function measureRuns(open: Uint8Array): void {
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    const row = cz * MAP_CELLS;
    let cx = 0;
    while (cx < MAP_CELLS) {
      if (open[row + cx] === 0) { RUN_X[row + cx] = 0; cx++; continue; }
      const start = cx;
      while (cx < MAP_CELLS && open[row + cx] !== 0) cx++;
      const len = cx - start;
      for (let k = start; k < cx; k++) RUN_X[row + k] = len;
    }
  }
  for (let cx = 0; cx < MAP_CELLS; cx++) {
    let cz = 0;
    while (cz < MAP_CELLS) {
      if (open[cz * MAP_CELLS + cx] === 0) { RUN_Z[cz * MAP_CELLS + cx] = 0; cz++; continue; }
      const start = cz;
      while (cz < MAP_CELLS && open[cz * MAP_CELLS + cx] !== 0) cz++;
      for (let k = start; k < cz; k++) RUN_Z[k * MAP_CELLS + cx] = cz - start;
    }
  }
}

/** The surviving region id at a cell, or 0 (off-map counts as 0). */
function routeLabelAt(cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return 0;
  return ROUTE_REGIONS.label[cz * MAP_CELLS + cx];
}

/**
 * Close every cell whose free span is under `minCells`, then hand back the runs
 * that turn out to be the only join between two surviving regions.
 *
 * `hard` is the physical grid and is never modified. `cost` is the routing grid
 * and is where the demotion lands. Returns [demoted, restored] through the
 * caller's `out` pair so the caller can publish both numbers — a clearance rule
 * that is quietly closing half the map has to be visible.
 */
function applyClearance(
  hard: Uint8Array, cost: Uint8Array, minCells: number, out: Int32Array,
): void {
  out[0] = 0; out[1] = 0;
  if (minCells < 2) return;

  for (let i = 0; i < MAP_CELL_COUNT; i++) ROUTE_MASK[i] = hard[i] < COST_BLOCKED ? 1 : 0;
  measureRuns(ROUTE_MASK);

  let demoted = 0;
  for (let i = 0; i < MAP_CELL_COUNT; i++) {
    if (ROUTE_MASK[i] === 0) { NARROW_MASK[i] = 0; continue; }
    const rx = RUN_X[i], rz = RUN_Z[i];
    const narrow = (rx < rz ? rx : rz) < minCells;
    NARROW_MASK[i] = narrow ? 1 : 0;
    if (narrow) { ROUTE_MASK[i] = 0; demoted++; }
  }
  if (demoted === 0) return;

  // Components of what survives, and of what was taken away.
  labelRegions(ROUTE_MASK, ROUTE_REGIONS);
  labelRegions(NARROW_MASK, NARROW_REGIONS);

  const ncount = NARROW_REGIONS.count;
  for (let k = 0; k <= ncount; k++) { TOUCHED[k] = 0; BRIDGES[k] = 0; }

  for (let cz = 0; cz < MAP_CELLS; cz++) {
    const row = cz * MAP_CELLS;
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      const i = row + cx;
      const comp = NARROW_REGIONS.label[i];
      if (comp === 0 || BRIDGES[comp] !== 0) continue;
      for (let d = 0; d < FIRST_DIAG; d++) {
        const rl = routeLabelAt(cx + NX[d], cz + NZ[d]);
        if (rl === 0) continue;
        if (TOUCHED[comp] === 0) TOUCHED[comp] = rl;
        else if (TOUCHED[comp] !== rl) { BRIDGES[comp] = 1; break; }
      }
    }
  }

  let restored = 0;
  for (let i = 0; i < MAP_CELL_COUNT; i++) {
    if (NARROW_MASK[i] === 0) continue;
    if (BRIDGES[NARROW_REGIONS.label[i]] !== 0) { restored++; continue; }
    cost[i] = COST_BLOCKED;
  }
  out[0] = demoted - restored;
  out[1] = restored;
}

/** Scratch for `applyClearance`'s two return values. */
const CLEARANCE_OUT = new Int32Array(2);

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
  /** Orders whose goal was in a different region than the unit issuing them. */
  unreachable: number;
  /**
   * Cells the clearance rule is holding closed, summed over the cost grids that
   * are currently built. Zero on an empty map; it grows as bases do.
   */
  narrow: number;
  /**
   * Cells it had to hand back because closing them would have cut a region off.
   * A large number here means bases are being built with only slot-width exits,
   * which is worth knowing — it is the one shape the rule cannot help with.
   */
  narrowRestored: number;
}

/**
 * The `INav` implementation. One instance, published as `world.nav` by
 * `pathing.system.ts`.
 */
export class FlowFieldCache implements INav {
  private readonly fields: Field[] = [];
  private readonly expanders: Expander[] = [];
  private readonly grids: CostGrid[] = [];
  /** Connected-component labelling of each class's cost grid. */
  private readonly regions: RegionGrid[] = [];

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
    cellsThisTick: 0, rebuilds: 0, misses: 0, evictions: 0, unreachable: 0,
    narrow: 0, narrowRestored: 0,
  };

  constructor(port: ITerrain) {
    this.port = port;
    this.terrain = getTerrain();
    for (let i = 0; i < FLOWFIELD_CACHE_SIZE; i++) this.fields.push(new Field(i));
    for (let i = 0; i < NAV_FIELD_EXPANDERS; i++) this.expanders.push(new Expander());
    for (let i = 0; i < MOVE_CLASS_COUNT; i++) this.grids.push(new CostGrid());
    for (let i = 0; i < MOVE_CLASS_COUNT; i++) this.regions.push(new RegionGrid());
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

  /**
   * The PHYSICAL grid for a class — passability with the clearance rule left
   * out. Movement integrates against this, never against `costGridFor`. See
   * `CostGrid.hard` for why the two must not be the same array.
   */
  hardGridFor(cls: MoveClass): Uint8Array {
    this.syncOccupancy();
    const g = this.grids[cls];
    if (g.version !== this.costVersion) this.rebuildCost(cls, g);
    return g.hard;
  }

  /** Traversal cost of one cell, `COST_BLOCKED` when impassable. */
  costAt(cx: number, cz: number, cls: MoveClass): number {
    if (!isInMap(cx, cz)) return COST_BLOCKED;
    return this.costGridFor(cls)[cz * MAP_CELLS + cx];
  }

  /**
   * True when `cls` may be ROUTED through the cell. This is the planner's
   * question, and it is the one that refuses a slot the hull will not fit down.
   */
  isPassableClass(cx: number, cz: number, cls: MoveClass): boolean {
    if (cls === MoveClass.Air) return isInMap(cx, cz);
    if (!isInMap(cx, cz)) return false;
    return this.costGridFor(cls)[cz * MAP_CELLS + cx] < COST_BLOCKED;
  }

  /**
   * True when `cls` may PHYSICALLY occupy the cell. Strictly weaker than
   * `isPassableClass`: every routable cell is standable, and a cell the
   * clearance rule closed is standable but not routable.
   *
   * Movement and the steering avoidance probe ask this one. A unit already
   * inside a slot has to be able to drive out of it, and the wall-slide
   * constraint has to keep letting it — enforcing the planning rule there would
   * freeze exactly the unit the planning rule exists to protect.
   */
  isStandable(cx: number, cz: number, cls: MoveClass): boolean {
    if (cls === MoveClass.Air) return isInMap(cx, cz);
    if (!isInMap(cx, cz)) return false;
    return this.hardGridFor(cls)[cz * MAP_CELLS + cx] < COST_BLOCKED;
  }

  /** Cells the clearance rule is currently holding closed for a class. */
  narrowCells(cls: MoveClass): number {
    this.costGridFor(cls);
    return this.grids[cls].narrow;
  }

  /** Cells it handed back because they were the only way through. */
  restoredCells(cls: MoveClass): number {
    this.costGridFor(cls);
    return this.grids[cls].restored;
  }

  /* -- connectivity ------------------------------------------------------ */

  /**
   * Connected-component labelling of a class's cost grid, rebuilt whenever the
   * cost grid is. One flood fill over 16k cells, and only when a structure
   * appears or dies — the same trigger that already forces a full cost rebuild
   * and re-expands every live field, so this is noise next to the work it is
   * riding along with.
   */
  private regionGridFor(cls: MoveClass): RegionGrid {
    const cost = this.costGridFor(cls);
    const g = this.regions[cls];
    if (g.version === this.costVersion) return g;
    for (let i = 0; i < MAP_CELL_COUNT; i++) OPEN_MASK[i] = cost[i] < COST_BLOCKED ? 1 : 0;
    labelRegions(OPEN_MASK, g);
    g.version = this.costVersion;
    return g;
  }

  /**
   * The id of the connected region a cell belongs to for `cls`, or 0 when the
   * cell is impassable or off-map. Ids are arbitrary but stable for as long as
   * the cost grid is; compare them, never store them.
   */
  regionOf(cx: number, cz: number, cls: MoveClass): number {
    if (!isInMap(cx, cz)) return 0;
    return this.regionGridFor(cls).label[cz * MAP_CELLS + cx];
  }

  /** The largest region for `cls` — the map proper. 0 when nothing is open. */
  mainRegion(cls: MoveClass): number {
    return this.regionGridFor(cls).main;
  }

  /** Cell count of a region id, 0 when unknown. */
  regionSize(region: number, cls: MoveClass): number {
    const g = this.regionGridFor(cls);
    return region > 0 && region < g.sizes.length ? g.sizes[region] : 0;
  }

  /**
   * True when a unit of `cls` standing at (ax,az) could, given time, reach
   * (bx,bz). This is an exact answer, not an estimate: it is the whole reason
   * the labelling exists.
   */
  isReachable(ax: number, az: number, bx: number, bz: number, cls: MoveClass): boolean {
    if (cls === MoveClass.Air) return isInMap(ax, az) && isInMap(bx, bz);
    const g = this.regionGridFor(cls);
    if (!isInMap(ax, az) || !isInMap(bx, bz)) return false;
    const a = g.label[az * MAP_CELLS + ax];
    return a !== 0 && a === g.label[bz * MAP_CELLS + bx];
  }

  /** Nearest cell belonging to `region`, written into `out` as [cx,cz]. */
  nearestInRegion(
    cx: number, cz: number, region: number, cls: MoveClass, out: Int32Array,
    maxRadius: number = NAV_REGION_SEARCH_CELLS,
  ): boolean {
    return nearestCellInRegion(this.regionGridFor(cls), cx, cz, region, maxRadius, out);
  }

  /**
   * Map health for one class: how many separate pieces the navigable world is
   * in and how much of it the main piece holds. The boot diagnostic prints
   * this, and it is the number that would have caught the reported bug before
   * a player did.
   */
  connectivity(cls: MoveClass): {
    regions: number; passable: number; mainCells: number; mainFraction: number;
  } {
    const g = this.regionGridFor(cls);
    const mainCells = g.main > 0 ? g.sizes[g.main] : 0;
    return {
      regions: g.count,
      passable: g.passable,
      mainCells,
      mainFraction: g.passable > 0 ? mainCells / g.passable : 1,
    };
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

    g.narrow = 0;
    g.restored = 0;

    if (cls === MoveClass.Air) {
      // Aircraft ignore the grid. A uniform grid keeps every other code path
      // (nearestReachable, isDirectPathClear, costAt) branch-free for them.
      cost.fill(COST_UNIT);
      g.hard.fill(COST_UNIT);
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

        if (!ok) { cost[i] = COST_BLOCKED; g.hard[i] = COST_BLOCKED; continue; }

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
        g.hard[i] = c;
      }
    }

    // --- clearance ----------------------------------------------------------
    // A slot narrower than the widest hull is not a corridor, however open the
    // footprint carve-out makes it look. See §4c — including why this cannot
    // seal a base in. It runs BEFORE the wall-hug dilation so a cell next to a
    // freshly closed slot gets its penalty ring like any other wall.
    applyClearance(g.hard, cost, NAV_MIN_CORRIDOR_CELLS[cls], CLEARANCE_OUT);
    g.narrow = CLEARANCE_OUT[0];
    g.restored = CLEARANCE_OUT[1];

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
   * `fromCx`/`fromCz` are the CELL THE UNIT IS STANDING IN, and passing them
   * is what turns "drive at the goal and hope" into an answerable question. If
   * the goal is in a different connected region than the unit, no amount of
   * expansion will ever reach it: the integration field stops at the region
   * boundary, `sample` falls back to the raw bearing, and the unit grinds into
   * the cliff between the two — which is precisely the bug this exists to
   * stop. When that happens the goal is pulled back to the nearest cell the
   * unit CAN reach, which is what a player means by a move order anyway; if
   * even that fails the request is refused with -1 so the caller can end the
   * order cleanly instead of steering into a wall. Omit them (-1) and the
   * check is skipped, which is right for a speculative or map-wide request.
   *
   * Returns a field handle, or -1 when the goal is unreachable or the cache is
   * fully pinned (in which case the caller should fall back to direct seek —
   * see Steering.ts).
   */
  requestFieldClass(
    goalCx: number, goalCz: number, cls: MoveClass, fromCx = -1, fromCz = -1,
  ): number {
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

    // --- reachability ------------------------------------------------------
    if (cls !== MoveClass.Air && isInMap(fromCx, fromCz)) {
      const g = this.regionGridFor(cls);
      const from = g.label[fromCz * MAP_CELLS + fromCx];
      const goal = g.label[gz * MAP_CELLS + gx];
      if (from !== 0 && goal !== 0 && from !== goal) {
        this.stats.unreachable++;
        // Nearest cell to the ORIGINAL goal that shares the unit's region, so
        // several units in one pocket ordered to one point still collapse onto
        // one shared field rather than one field each.
        if (nearestCellInRegion(g, gx, gz, from, NAV_REGION_SEARCH_CELLS, SNAP_OUT)) {
          gx = SNAP_OUT[0]; gz = SNAP_OUT[1];
        } else {
          return -1;
        }
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

    // Only the grids that are ALREADY built. Asking `narrowCells` here instead
    // would force a rebuild of every class the match never uses, once a tick.
    let narrow = 0, restored = 0;
    for (let i = 0; i < this.grids.length; i++) {
      const g = this.grids[i];
      if (g.version !== this.costVersion) continue;
      narrow += g.narrow;
      restored += g.restored;
    }
    s.narrow = narrow;
    s.narrowRestored = restored;
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

/* ==========================================================================
 * DOES THIS MAP HAVE A SEA?
 *
 * ONE DEFINITION, ONE READER-FACING FUNCTION, because the alternative is two
 * and they drift. "Has water" is asked by at least two very different callers —
 * the AI, deciding whether a Naval Yard is worth 1000 credits, and the build
 * menu, deciding whether to show the row at all — and an answer that differs
 * between them is a map where the sidebar offers a dock the opponent knows
 * better than to buy, or worse, the reverse.
 *
 * IT IS THE LARGEST CONTIGUOUS BODY, NOT THE TOTAL. A total counts a hundred
 * disconnected puddles as an ocean; what a hull needs is one body big enough to
 * sail in. That is exactly what `regionGridFor(MoveClass.Naval)` already
 * labels, so this is two array reads on a labelling the cost grid maintains
 * anyway — not a new scan, and not a second definition of navigability.
 *
 * MEASURED, and the gap is why the threshold needs no fine judgement:
 *
 *     contested-strait  3622 cells      airbase-flats      0
 *     coral-shore       3952 cells      industrial-grid    0
 *                                       temperate-valley   9
 *                                       frozen-sector     14
 *
 * Two and a half orders of magnitude. 400 sits far above every landlocked map's
 * noise basin and far below both real seas.
 * ========================================================================== */

/**
 * Cells in the largest contiguous body a ship can route through. 0 when there
 * is no nav, which is the honest answer for "no world yet" and keeps every
 * caller's naval branch closed until there is one.
 */
export function navigableSeaCells(): number {
  const nav = active;
  if (nav === null) return 0;
  const main = nav.mainRegion(MoveClass.Naval);
  return main > 0 ? nav.regionSize(main, MoveClass.Naval) : 0;
}

/**
 * True when this map has enough open water to be worth a navy.
 *
 * THE GATE FOR ALL NAVAL CONTENT. A Naval Yard on `airbase-flats` — 0 water
 * cells — is a building that can produce a Dreadnought which then sits on dry
 * land forever, and nothing in the game said no: the only gates naval content
 * carried were the `struct.naval` progression unlock and `prereqs:
 * ['navalYard']`, neither of which knows what the ground looks like.
 */
export function mapSupportsNaval(): boolean {
  return navigableSeaCells() >= NAVAL_MAP_MIN_CELLS;
}

let active: FlowFieldCache | null = null;

export function getNav(): FlowFieldCache | null {
  return active;
}

export function setActiveNav(next: FlowFieldCache | null): void {
  active = next;
}

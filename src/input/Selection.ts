/**
 * ============================================================================
 * RED ALERT — src/input/Selection.ts
 * ============================================================================
 * WHO IS SELECTED, AND WHO IS UNDER THE CURSOR.
 *
 * This is the module the player judges the game by in the first ten seconds.
 * Everything in it exists to make one of three sentences true:
 *
 *   1. "It selected the thing I was pointing at."
 *      -> `pickEntity` scores a WORLD containment test and a SCREEN proximity
 *         test together. Ground containment alone fails on a 9 m Tesla Coil,
 *         whose footprint sits four metres up-screen from the pixels you aimed
 *         at; screen proximity alone lets you grab a tank through a wall.
 *         Units always beat structures on a tie, because a tank parked on a
 *         Construction Yard's pad is what you meant.
 *
 *   2. "The box took exactly what it drew over."
 *      -> `selectInRect` projects each candidate's ORIGIN and tests it against
 *         the client-space rectangle, so what the marquee covers is what you
 *         get regardless of camera yaw. Own mobile units win the box outright:
 *         if the box contains any, structures are excluded, which is the
 *         classic C&C rule and the reason dragging over your base does not hand
 *         you six buildings you cannot order.
 *
 *   3. "It remembered." -> control groups 0-9, generation-checked on recall so
 *         a group whose tanks died does not resurrect whatever recycled their
 *         slots.
 *
 * OWNERSHIP
 * ---------
 * `world.selection` (a `SelectionState` from core/world.ts) IS the storage —
 * this class never keeps a second copy. That matters because the scenario
 * builder writes a selection directly at boot for the `selection` fixture, and
 * because the HUD reads `world.selection` without importing us. We additionally
 * own the `EntityFlag.Selected` and `EntityFlag.Hovered` bits, per the
 * write-ownership table in core/loop.ts (writer: "render, outside sim").
 *
 * ALLOCATION
 * ----------
 * Zero, after construction. Every query writes into a caller-supplied or
 * module-level typed array.
 * ============================================================================
 */

import {
  CELL, MAX_SELECTION, PICK_RADIUS, PICK_SCREEN_RADIUS_PX, PICK_WORLD_SLOP,
} from '../core/config';
import { EntityFlag, EntityKind, NONE } from '../core/types';
import type { EntityId, ISelection, PlayerId, SelectionState } from '../core/types';
import type { Channels } from '../core/events';
import type { World } from '../core/world';

/* ==========================================================================
 * 1. THE PROJECTOR PORT
 *
 * Selection needs to turn world metres into client pixels. It gets that as a
 * two-method interface rather than a CameraRig so this file has no render
 * dependency and can be unit-tested with a fake camera.
 * ========================================================================== */

export interface ScreenProjector {
  /**
   * World point -> client-space pixels, written into `out` as [x, y].
   * False when the point is behind the camera or otherwise not on screen.
   */
  project(x: number, y: number, z: number, out: Float32Array): boolean;
  /** Viewport rectangle in client pixels, into `out` as [left, top, w, h]. */
  viewport(out: Float32Array): void;
}

/* ==========================================================================
 * 2. FILTERS
 * ========================================================================== */

/** Nothing with any of these bits may ever enter a selection. */
export const SELECT_REJECT_MASK =
  EntityFlag.PendingDestroy | EntityFlag.NotSelectable | EntityFlag.Garrisoned | EntityFlag.Cloaked;

/** True for the kinds a player can give orders to or inspect. */
function isSelectableKind(kind: number): boolean {
  return kind === EntityKind.Infantry || kind === EntityKind.Vehicle || kind === EntityKind.Building;
}

/** True for a mobile unit (as opposed to a structure). */
function isMobileKind(kind: number): boolean {
  return kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
}

/* -- module scratch -------------------------------------------------------- */

const SCREEN = new Float32Array(2);
const VIEW = new Float32Array(4);
/** Candidate slot indices from a spatial query. Sized to MAX_QUERY_RESULTS. */
const CANDIDATES = new Int32Array(256);
/** Staging list for a box/type/army select, before the cap is applied. */
const STAGING = new Int32Array(MAX_SELECTION * 4);

/* ==========================================================================
 * 3. PICKING
 * ========================================================================== */

/**
 * The entity under a screen point, or NONE.
 *
 * `groundX/groundZ` is the ground-plane hit for that same screen point — the
 * caller already computed it for the order cursor, so we do not pay for the
 * unprojection twice.
 *
 * Scoring, in strict priority order:
 *   1. world containment beats screen proximity  (you are literally on it)
 *   2. mobile units beat structures              (the C&C rule)
 *   3. smaller screen distance                   (the one you aimed at)
 */
export function pickEntity(
  world: World,
  projector: ScreenProjector,
  screenX: number,
  screenY: number,
  groundX: number,
  groundZ: number,
): EntityId {
  const s = world.store;
  // 10 m of slack around the ground hit: enough to reach the origin of a 3x3
  // structure whose roof is what the cursor is actually over.
  const n = world.spatial.queryCircle(groundX, groundZ, PICK_RADIUS + 10, CANDIDATES, CANDIDATES.length);

  let best = -1;
  let bestContained = false;
  let bestMobile = false;
  let bestDist = Infinity;
  const maxPx2 = PICK_SCREEN_RADIUS_PX * PICK_SCREEN_RADIUS_PX;

  for (let c = 0; c < n; c++) {
    const i = CANDIDATES[c];
    const flags = s.flags[i];
    if ((flags & EntityFlag.Alive) === 0) continue;
    if ((flags & SELECT_REJECT_MASK) !== 0) continue;
    if (!isSelectableKind(s.kind[i])) continue;

    // --- world containment ---------------------------------------------
    let contained = false;
    const dx = groundX - s.posX[i];
    const dz = groundZ - s.posZ[i];
    if (s.footprintW[i] > 0) {
      const halfW = s.footprintW[i] * CELL * 0.5 + PICK_WORLD_SLOP;
      const halfH = s.footprintH[i] * CELL * 0.5 + PICK_WORLD_SLOP;
      contained = Math.abs(dx) <= halfW && Math.abs(dz) <= halfH;
    } else {
      const r = s.radius[i] + PICK_WORLD_SLOP;
      contained = dx * dx + dz * dz <= r * r;
    }

    // --- screen proximity ------------------------------------------------
    // Aim at the middle of the mass, not its feet: a tank's pixels are a metre
    // up from its origin and a structure's are a good deal more.
    const lift = s.footprintW[i] > 0
      ? Math.max(s.footprintW[i], s.footprintH[i]) * CELL * 0.35
      : s.radius[i] * 0.9;
    let px2 = Infinity;
    if (projector.project(s.posX[i], s.posY[i] + lift, s.posZ[i], SCREEN)) {
      const sx = SCREEN[0] - screenX;
      const sy = SCREEN[1] - screenY;
      px2 = sx * sx + sy * sy;
    }
    if (!contained && px2 > maxPx2) continue;

    const mobile = isMobileKind(s.kind[i]);

    // Strict lexicographic ranking. Written out rather than as a packed score
    // so the priority order is readable and cannot silently reorder.
    if (best >= 0) {
      if (bestContained !== contained) { if (bestContained) continue; }
      else if (bestMobile !== mobile) { if (bestMobile) continue; }
      else if (px2 >= bestDist) continue;
    }
    best = i;
    bestContained = contained;
    bestMobile = mobile;
    bestDist = px2;
  }

  return best < 0 ? NONE : s.handleOf(best);
}

/* ==========================================================================
 * 4. THE SELECTION
 * ========================================================================== */

/** How a new pick combines with what is already selected. */
export const enum SelectMode {
  /** Replace everything. Plain left click. */
  Replace = 0,
  /** Union. Shift + click. */
  Add = 1,
  /** In -> out, out -> in. Ctrl + click. */
  Toggle = 2,
}

export class Selection implements ISelection {
  /** Live storage. Always `world.selection` — never a copy. */
  readonly state: SelectionState;

  /** The entity currently under the cursor, or NONE. */
  private hoveredId: EntityId = NONE;

  /**
   * Handles that currently carry `EntityFlag.Selected`. Kept so a change can
   * clear exactly the bits it set instead of sweeping 4096 slots.
   */
  private readonly flagged = new Int32Array(MAX_SELECTION);
  private flaggedCount = 0;

  /** Bumped on every committed change. The overlay rebuilds when it moves. */
  version = 0;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    this.state = world.selection;
    // The scenario builder may have written a selection before we existed.
    this.commit(false);
  }

  /* -- queries ------------------------------------------------------------ */

  get count(): number {
    return this.state.count;
  }

  isSelected(id: EntityId): boolean {
    const raw = id as number;
    const ids = this.state.ids;
    for (let i = 0; i < this.state.count; i++) if (ids[i] === raw) return true;
    return false;
  }

  /** The entity the portrait shows. NONE when the selection is empty. */
  primary(): EntityId {
    return this.state.count > 0 ? (this.state.ids[0] as EntityId) : NONE;
  }

  get hovered(): EntityId {
    return this.hoveredId;
  }

  /** True when at least one selected entity belongs to the local player. */
  hasOwnUnits(): boolean {
    const s = this.world.store;
    const local = this.world.localPlayer as number;
    for (let i = 0; i < this.state.count; i++) {
      const idx = s.index(this.state.ids[i] as EntityId);
      if (idx >= 0 && s.owner[idx] === local && isMobileKind(s.kind[idx])) return true;
    }
    return false;
  }

  /** True when everything selected is a structure. Cached on the state too. */
  get isBuildingSelection(): boolean {
    return this.state.isBuilding;
  }

  /** Centroid of the selection on the ground plane, into `out` as [x, z]. */
  centroid(out: Float32Array): boolean {
    const s = this.world.store;
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < this.state.count; i++) {
      const idx = s.index(this.state.ids[i] as EntityId);
      if (idx < 0) continue;
      sx += s.posX[idx];
      sz += s.posZ[idx];
      n++;
    }
    if (n === 0) return false;
    out[0] = sx / n;
    out[1] = sz / n;
    return true;
  }

  /* -- mutation ----------------------------------------------------------- */

  clear(): void {
    if (this.state.count === 0) return;
    this.state.count = 0;
    this.commit(true);
  }

  /** Replace / add / toggle a single entity. Returns true if anything changed. */
  select(id: EntityId, mode: SelectMode): boolean {
    if (id === NONE) {
      if (mode === SelectMode.Replace) { this.clear(); return true; }
      return false;
    }
    if (!this.acceptable(id)) return false;

    const ids = this.state.ids;
    const raw = id as number;

    if (mode === SelectMode.Replace) {
      if (this.state.count === 1 && ids[0] === raw) return false;
      ids[0] = raw;
      this.state.count = 1;
      this.commit(true);
      return true;
    }

    let at = -1;
    for (let i = 0; i < this.state.count; i++) if (ids[i] === raw) { at = i; break; }

    if (at >= 0) {
      if (mode === SelectMode.Add) return false;
      // Toggle out: swap-remove keeps the list dense and O(1).
      ids[at] = ids[this.state.count - 1];
      this.state.count--;
      this.commit(true);
      return true;
    }

    if (this.state.count >= MAX_SELECTION) return false;
    ids[this.state.count++] = raw;
    this.commit(true);
    return true;
  }

  /**
   * Replace (or extend) the selection with everything inside a client-space
   * rectangle. Own mobile units take the box outright; only when there are none
   * does a structure or an enemy unit come back, and then only ONE of them —
   * a box that hands you four enemy tanks you cannot order is noise.
   */
  selectInRect(
    minX: number, minY: number, maxX: number, maxY: number,
    projector: ScreenProjector,
    additive: boolean,
  ): boolean {
    const s = this.world.store;
    const local = this.world.localPlayer as number;

    let ownCount = 0;
    let fallback = -1;
    let fallbackMobile = false;
    let fallbackScore = Infinity;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      const flags = s.flags[i];
      if ((flags & SELECT_REJECT_MASK) !== 0) continue;
      const kind = s.kind[i];
      if (!isSelectableKind(kind)) continue;

      const lift = s.footprintW[i] > 0
        ? Math.max(s.footprintW[i], s.footprintH[i]) * CELL * 0.3
        : s.radius[i] * 0.8;
      if (!projector.project(s.posX[i], s.posY[i] + lift, s.posZ[i], SCREEN)) continue;
      const px = SCREEN[0];
      const py = SCREEN[1];
      if (px < minX || px > maxX || py < minY || py > maxY) continue;

      if (s.owner[i] === local && isMobileKind(kind)) {
        if (ownCount < STAGING.length) STAGING[ownCount++] = i;
        continue;
      }
      // Not ours: remember the most central one, units before structures, in
      // case the box turns out to contain nothing of ours at all.
      const mobile = isMobileKind(kind);
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (fallback < 0 || (mobile && !fallbackMobile) || (mobile === fallbackMobile && d < fallbackScore)) {
        fallback = i;
        fallbackMobile = mobile;
        fallbackScore = d;
      }
    }

    if (ownCount > 0) return this.setFromIndices(STAGING, ownCount, additive);
    if (!additive && fallback >= 0) return this.select(s.handleOf(fallback), SelectMode.Replace);
    if (!additive) { this.clear(); return true; }
    return false;
  }

  /**
   * Double-click behaviour: every entity of the same def, owner and kind that
   * is currently ON SCREEN. Falling back to the whole map here would be a trap
   * — you would silently pull in the tank guarding your second refinery.
   */
  selectSameTypeOnScreen(id: EntityId, projector: ScreenProjector, additive: boolean): boolean {
    const s = this.world.store;
    const seed = s.index(id);
    if (seed < 0) return false;
    if (!isMobileKind(s.kind[seed])) return this.select(id, SelectMode.Replace);

    projector.viewport(VIEW);
    const left = VIEW[0];
    const top = VIEW[1];
    const right = left + VIEW[2];
    const bottom = top + VIEW[3];

    const owner = s.owner[seed];
    const def = s.defId[seed];
    const kind = s.kind[seed];
    let n = 0;

    for (let a = 0; a < s.aliveCount && n < STAGING.length; a++) {
      const i = s.alive[a];
      if (s.owner[i] !== owner || s.defId[i] !== def || s.kind[i] !== kind) continue;
      if ((s.flags[i] & SELECT_REJECT_MASK) !== 0) continue;
      if (!projector.project(s.posX[i], s.posY[i] + s.radius[i] * 0.8, s.posZ[i], SCREEN)) continue;
      if (SCREEN[0] < left || SCREEN[0] > right || SCREEN[1] < top || SCREEN[1] > bottom) continue;
      STAGING[n++] = i;
    }
    if (n === 0) return this.select(id, SelectMode.Replace);
    return this.setFromIndices(STAGING, n, additive);
  }

  /** Every mobile unit the local player owns, anywhere on the map. */
  selectAllArmy(): boolean {
    const s = this.world.store;
    const local = this.world.localPlayer as number;
    let n = 0;
    for (let a = 0; a < s.aliveCount && n < STAGING.length; a++) {
      const i = s.alive[a];
      if (s.owner[i] !== local) continue;
      if (!isMobileKind(s.kind[i])) continue;
      if ((s.flags[i] & SELECT_REJECT_MASK) !== 0) continue;
      STAGING[n++] = i;
    }
    return this.setFromIndices(STAGING, n, false);
  }

  /* -- control groups ------------------------------------------------------ */

  /** Ctrl+N: the group becomes exactly the current selection. */
  setGroup(n: number): boolean {
    const g = this.state.groups[n];
    if (g === undefined) return false;
    const c = Math.min(this.state.count, g.length);
    for (let i = 0; i < c; i++) g[i] = this.state.ids[i];
    this.state.groupCounts[n] = c;
    return true;
  }

  /** Shift+Ctrl+N: append the current selection to the group. */
  addToGroup(n: number): boolean {
    const g = this.state.groups[n];
    if (g === undefined) return false;
    let c = this.state.groupCounts[n];
    for (let i = 0; i < this.state.count && c < g.length; i++) {
      const raw = this.state.ids[i];
      let dup = false;
      for (let j = 0; j < c; j++) if (g[j] === raw) { dup = true; break; }
      if (!dup) g[c++] = raw;
    }
    this.state.groupCounts[n] = c;
    return true;
  }

  /** N: select the group. Dead members are dropped, not resurrected. */
  recallGroup(n: number, additive: boolean): boolean {
    const g = this.state.groups[n];
    if (g === undefined) return false;
    const s = this.world.store;
    let live = 0;
    let staged = 0;
    for (let i = 0; i < this.state.groupCounts[n]; i++) {
      const h = g[i] as EntityId;
      const idx = s.index(h);
      if (idx < 0 || (s.flags[idx] & SELECT_REJECT_MASK) !== 0) continue;
      // Compact the group in place so a group of ghosts shrinks over time.
      g[live++] = g[i];
      if (staged < STAGING.length) STAGING[staged++] = idx;
    }
    this.state.groupCounts[n] = live;
    if (staged === 0) return false;
    return this.setFromIndices(STAGING, staged, additive);
  }

  /** Centroid of a control group, into `out` as [x, z]. */
  groupCentroid(n: number, out: Float32Array): boolean {
    const g = this.state.groups[n];
    if (g === undefined) return false;
    const s = this.world.store;
    let c = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < this.state.groupCounts[n]; i++) {
      const idx = s.index(g[i] as EntityId);
      if (idx < 0) continue;
      sx += s.posX[idx];
      sz += s.posZ[idx];
      c++;
    }
    if (c === 0) return false;
    out[0] = sx / c;
    out[1] = sz / c;
    return true;
  }

  /* -- hover --------------------------------------------------------------- */

  /** Move the `Hovered` flag. Returns true when the hovered entity changed. */
  setHovered(id: EntityId): boolean {
    if (id === this.hoveredId) return false;
    const s = this.world.store;
    const prev = s.index(this.hoveredId);
    if (prev >= 0) s.flags[prev] &= ~EntityFlag.Hovered;
    const next = s.index(id);
    if (next >= 0) s.flags[next] |= EntityFlag.Hovered;
    this.hoveredId = next >= 0 ? id : NONE;
    return true;
  }

  /* -- maintenance --------------------------------------------------------- */

  /**
   * Drop dead handles. Cheap (<= MAX_SELECTION) and called every frame, which
   * is what keeps the HUD portrait from showing a unit that exploded two
   * seconds ago.
   */
  pruneDead(): boolean {
    const s = this.world.store;
    const ids = this.state.ids;
    let w = 0;
    for (let i = 0; i < this.state.count; i++) {
      const idx = s.index(ids[i] as EntityId);
      if (idx < 0 || (s.flags[idx] & EntityFlag.PendingDestroy) !== 0) continue;
      ids[w++] = ids[i];
    }
    if (w === this.state.count) {
      if (this.hoveredId !== NONE && s.index(this.hoveredId) < 0) this.hoveredId = NONE;
      return false;
    }
    this.state.count = w;
    this.commit(true);
    return true;
  }

  /** Copy slot indices into the selection, honouring the cap and the mode. */
  private setFromIndices(src: Int32Array, n: number, additive: boolean): boolean {
    const s = this.world.store;
    const ids = this.state.ids;
    if (!additive) this.state.count = 0;

    for (let i = 0; i < n && this.state.count < MAX_SELECTION; i++) {
      const raw = s.handleOf(src[i]) as number;
      let dup = false;
      for (let j = 0; j < this.state.count; j++) if (ids[j] === raw) { dup = true; break; }
      if (!dup) ids[this.state.count++] = raw;
    }
    this.commit(true);
    return true;
  }

  /** True if the handle may be selected at all. */
  private acceptable(id: EntityId): boolean {
    const s = this.world.store;
    const i = s.index(id);
    if (i < 0) return false;
    if ((s.flags[i] & SELECT_REJECT_MASK) !== 0) return false;
    return isSelectableKind(s.kind[i]);
  }

  /**
   * Recompute the cached fields, move the `Selected` bits, bump the version and
   * announce. Every mutation funnels through here — that is what guarantees the
   * flags, the caches and the event can never disagree.
   */
  private commit(emit: boolean): void {
    const s = this.world.store;
    const st = this.state;

    // 1. clear the bits we set last time
    for (let i = 0; i < this.flaggedCount; i++) {
      const idx = s.index(this.flagged[i] as EntityId);
      if (idx >= 0) s.flags[idx] &= ~EntityFlag.Selected;
    }

    // 2. set them on the new set, and recompute the caches in the same pass
    let allBuildings = st.count > 0;
    let def = -2;
    this.flaggedCount = 0;
    for (let i = 0; i < st.count; i++) {
      const idx = s.index(st.ids[i] as EntityId);
      if (idx < 0) continue;
      s.flags[idx] |= EntityFlag.Selected;
      this.flagged[this.flaggedCount++] = st.ids[i];
      if (s.kind[idx] !== EntityKind.Building) allBuildings = false;
      const d = s.defId[idx];
      if (def === -2) def = d;
      else if (def !== d) def = -1;
    }

    st.isBuilding = allBuildings;
    st.homogeneousDef = def === -2 ? -1 : def;
    this.version++;

    if (!emit) return;
    const p = this.channels.events.payload('selection:changed');
    p.count = st.count;
    p.primary = st.count > 0 ? (st.ids[0] as EntityId) : NONE;
    p.isBuilding = st.isBuilding;
    this.channels.events.emitPooled('selection:changed');
  }

  /** Release every flag we own. Called on teardown. */
  dispose(): void {
    const s = this.world.store;
    for (let i = 0; i < this.flaggedCount; i++) {
      const idx = s.index(this.flagged[i] as EntityId);
      if (idx >= 0) s.flags[idx] &= ~EntityFlag.Selected;
    }
    this.flaggedCount = 0;
    const h = s.index(this.hoveredId);
    if (h >= 0) s.flags[h] &= ~EntityFlag.Hovered;
    this.hoveredId = NONE;
  }
}

/* ==========================================================================
 * 5. RELATION HELPER
 *
 * Lives here rather than in Commands.ts because both picking and the order
 * resolver need it and neither should own it.
 * ========================================================================== */

/** True when `viewer` considers the entity at slot `i` an enemy. */
export function isEnemyOf(world: World, viewer: PlayerId, i: number): boolean {
  const owner = world.store.owner[i] as PlayerId;
  if ((owner as number) === (viewer as number)) return false;
  return !world.areAllied(viewer, owner);
}

/** True when `viewer` owns or is allied with the entity at slot `i`. */
export function isFriendlyOf(world: World, viewer: PlayerId, i: number): boolean {
  return world.areAllied(viewer, world.store.owner[i] as PlayerId);
}

/**
 * ============================================================================
 * VOLTMARCH — src/sim/Placement.ts
 * ============================================================================
 * "WHERE DO YOU WANT IT?" — the structure placement flow.
 *
 * Two halves that must never disagree:
 *
 *   1. `evaluatePlacement` — the RULE. Pure, allocation-free, and called from
 *      exactly two places: the ghost every frame (so the player sees the
 *      answer) and `ProductionService.applyPlace` inside the sim (so the
 *      answer is enforced). One implementation, two callers. A separate
 *      "looks fine" check in the renderer and "actually fine" check in the sim
 *      is how you ship a game where the green outline refuses to build.
 *
 *   2. `PlacementController` — the FEEL. A translucent hologram of the
 *      structure snapped to the build grid, a per-cell green/red validity
 *      carpet under it, and a commit that lands with a thunk.
 *
 * WHY THE GHOST IS A HOLOGRAM AND NOT THE REAL MESH
 * -------------------------------------------------
 * The RenderBridge owns every real model and hands them out per ENTITY; there
 * is no "draw me this model at this transform, unowned" path, and inventing one
 * would mean a second instancing system. A chamfer-free translucent volume plus
 * a bright edge wire is also closer to what RA3 actually draws: the reference
 * frames (refs/ra3steam_07.jpg) show structures sitting inside a painted
 * foundation rectangle, and the rectangle is doing most of the reading, not the
 * building silhouette.
 *
 * THE CONCRETE PAD
 * ----------------
 * On commit, Production stamps the terrain splat with concrete under the
 * footprint. That is where the pads in every RA3 base come from, it costs zero
 * draw calls, and it means the ghost's rectangle is a promise the world keeps.
 *
 * RELOCATION IS THIS FLOW WITH A DIFFERENT SUBJECT
 * ------------------------------------------------
 * `src/sim/Relocate.ts` lets a player pick up a structure that is already
 * standing and put it somewhere else for a fee. That is not a second placement
 * system: it is `beginRelocate(id)` instead of `begin(defId)`, one exempt
 * rectangle in the rule (`PlacementExempt`) and one different commit target.
 * The hologram, the carpet, the snapping, the Escape key and the right-click
 * cancel are all the code you are already reading.
 *
 * CURSOR OWNERSHIP
 * ----------------
 * An input module does not exist yet, so this controller will drive itself off
 * the canvas pointer. The instant anything calls `setCursorWorld` it hands the
 * cursor over permanently and detaches its own listeners — one owner, no
 * fighting, no flag to remember to set.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  BUILD_RADIUS, CELL, MAP_CELLS, PLACEMENT, RENDER_ORDER,
} from '../core/config';
import { EntityFlag, EntityKind, NONE } from '../core/types';
import type { EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';
import { footprintOriginCell, hexToInt, isInMap } from '../core/math';
import type { CameraRig } from '../render/camera';
// Pure data, no imports of its own, and already read by `src/ui/Sidebar.ts` for
// exactly this reason: the key the engine listens for and the key the help
// screen promises must be ONE array. This module already reaches into
// `src/render/camera` for the ghost's ray, so the edge is not a new one.
import { PLACEMENT_ROTATE_HOTKEYS } from '../input/ActionCatalogue';

import type { BuildEntry, ProductionService } from './Production';

/* ==========================================================================
 * 0. FACING — WHICH WAY IS THE FRONT?
 *
 * A facing is a QUARTER TURN COUNT, 0..3, clockwise about +Y. It is not a free
 * angle, and that is a decision rather than a shortcut:
 *
 *   - The occupancy grid cannot express a rotated rectangle.
 *     `terrain.markOccupied(cx, cz, w, h)` takes a cell-aligned rectangle, and
 *     so does `clearOccupied`, `evaluatePlacement`'s per-cell walk, the pad
 *     stamp and the validity carpet. A structure at 37 degrees would need every
 *     one of those to rasterise an oriented box, and the nav grid, the picker
 *     (`Selection.ts` tests an axis-aligned half-extent) and the save file all
 *     read the same rectangle back. Free rotation is a different feature in
 *     five subsystems, not a bigger number here.
 *   - 90 degrees is also the RTS convention, and it is the only rotation that
 *     changes anything a player can act on: which edge units come out of.
 *
 * AT 90 AND 270 THE FOOTPRINT SWAPS. A 3x2 War Factory occupies 2x3 cells. The
 * rule, the ghost, the occupancy stamp, the concrete pad and `store.footprintW/H`
 * must all agree about that, or the green outline is a lie. `facedFootprintW/H`
 * below is the ONE place the swap is decided; nothing open-codes `facing & 1`.
 *
 * `store.footprintW/H` always holds the WORLD-SPACE rectangle (already swapped).
 * Every consumer in the codebase — the picker, the nav clamp, the minimap, the
 * garrison test, the save file — reads it as an axis-aligned world AABB, and
 * storing local extents next to a yaw would silently break all of them.
 * ========================================================================== */

/** Radians per facing step. */
const QUARTER_TURN = Math.PI * 0.5;

/** How many distinct facings there are. */
export const FACING_COUNT = 4;

/** Wrap any integer into 0..3. Negative deltas are the point. */
export function normaliseFacing(facing: number): number {
  return ((Math.round(facing) % FACING_COUNT) + FACING_COUNT) % FACING_COUNT;
}

/** The yaw, in radians, a facing puts a structure at. */
export function facingYaw(facing: number): number {
  return normaliseFacing(facing) * QUARTER_TURN;
}

/**
 * The facing a stored yaw represents.
 *
 * Rounds, so a structure spawned by a scenario at some hand-authored angle
 * still answers with the nearest quarter turn rather than with garbage. The
 * footprint that was stamped for it is cell-aligned either way.
 */
export function yawToFacing(yaw: number): number {
  return normaliseFacing(Math.round(yaw / QUARTER_TURN));
}

/** True when this facing turns a `w x h` footprint into `h x w`. */
export function facingSwapsFootprint(facing: number): boolean {
  return (normaliseFacing(facing) & 1) === 1;
}

/** World-space footprint width of a `w x h` structure at `facing`. */
export function facedFootprintW(w: number, h: number, facing: number): number {
  return facingSwapsFootprint(facing) ? h : w;
}

/** World-space footprint depth of a `w x h` structure at `facing`. */
export function facedFootprintH(w: number, h: number, facing: number): number {
  return facingSwapsFootprint(facing) ? w : h;
}

/* ==========================================================================
 * 1. THE RULE
 * ========================================================================== */

/** Why a footprint was refused. Ordered by how much the player cares. */
export const enum PlacementFault {
  None = 0,
  OffMap = 1,
  /** Too steep, or water. */
  Terrain = 2,
  /** Another structure already owns the cell. */
  Occupied = 3,
  /** Somebody is standing there. */
  Blocked = 4,
  /** Nowhere near your base. */
  OutOfRange = 5,
}

const FAULT_TEXT: readonly string[] = [
  '',
  'Off the map',
  'Ground is not flat enough',
  'Something is already there',
  'Clear your units off the site',
  'Too far from your base',
];

export interface PlacementReport {
  ok: boolean;
  fault: PlacementFault;
  reason: string;
  cx: number;
  cz: number;
  /** WORLD-SPACE footprint. Already swapped for a 90/270 facing. */
  w: number;
  h: number;
  /** Quarter turns the answer was computed for. */
  facing: number;
  /** Row-major legality, `w * h` entries valid. 1 = this cell is fine. */
  readonly cells: Uint8Array;
  /** Cells that failed. */
  blocked: number;
  inRadius: boolean;
}

/**
 * A rectangle of cells the rule treats as open ground.
 *
 * WHAT THIS IS FOR, AND WHY IT IS NOT A HACK
 * ------------------------------------------
 * A relocation (`src/sim/Relocate.ts`) asks "may this structure stand HERE?"
 * while the structure is still standing THERE, and the two footprints usually
 * overlap — nudging a War Factory two cells left is the commonest relocation
 * there is. Every overlapping cell is occupied by the very structure that is
 * about to vacate it, so without an exemption the rule refuses every short move
 * and permits only long ones, which is exactly backwards.
 *
 * The exemption skips BOTH the occupancy test and the terrain test, and both
 * are correct for the same reason: a finished structure is standing on those
 * cells right now. Its own ground cannot be too steep, too wet or too crowded
 * for it — it is already there. Cells outside the rectangle get the full test,
 * unchanged.
 *
 * `isInMap` is still enforced inside the rectangle. A cell off the map is not
 * ground the exempt structure occupies; it is a coordinate that does not exist.
 */
export interface PlacementExempt {
  cx: number;
  cz: number;
  w: number;
  h: number;
}

const MAX_CELLS = PLACEMENT.maxFootprintCells * PLACEMENT.maxFootprintCells;

export function makePlacementReport(): PlacementReport {
  return {
    ok: false, fault: PlacementFault.None, reason: '',
    cx: 0, cz: 0, w: 0, h: 0, facing: 0,
    cells: new Uint8Array(MAX_CELLS),
    blocked: 0, inRadius: false,
  };
}

/** The shared report the sim-side commit uses. Never retained. */
export const placementReport: PlacementReport = makePlacementReport();

/**
 * Can `player` found `entry` with its minimum-corner cell at (cx, cz), turned
 * `facing` quarter turns?
 *
 * Fills `out` and returns it. Allocation-free: one spatial rect query and a
 * walk over the player's structures, both into caller-owned buffers.
 *
 * `facing` defaults to 0, so every caller written before rotation existed —
 * including the AI's, which never turns anything — keeps its old answer.
 */
export function evaluatePlacement(
  world: World,
  player: PlayerId,
  entry: BuildEntry,
  cx: number,
  cz: number,
  out: PlacementReport,
  exempt: PlacementExempt | null = null,
  facing = 0,
): PlacementReport {
  // THE SWAP. Everything below this line — the cell walk, the blocker
  // rasterisation, the build-radius centre, the carpet the ghost draws from
  // `out.w/h` — is in world space, so it has to happen exactly here and exactly
  // once. See §0.
  const fw = facedFootprintW(entry.footprintW, entry.footprintH, facing);
  const fh = facedFootprintH(entry.footprintW, entry.footprintH, facing);
  const w = Math.max(1, Math.min(PLACEMENT.maxFootprintCells, fw));
  const h = Math.max(1, Math.min(PLACEMENT.maxFootprintCells, fh));
  out.cx = cx;
  out.cz = cz;
  out.w = w;
  out.h = h;
  out.facing = normaliseFacing(facing);
  out.blocked = 0;
  out.fault = PlacementFault.None;
  out.cells.fill(1, 0, w * h);

  const terrain = world.terrain;

  /* -- terrain and existing structures ---------------------------------- */
  const ex0 = exempt === null ? 0 : exempt.cx;
  const ez0 = exempt === null ? 0 : exempt.cz;
  const ex1 = exempt === null ? -1 : exempt.cx + exempt.w;
  const ez1 = exempt === null ? -1 : exempt.cz + exempt.h;

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const gx = cx + x;
      const gz = cz + z;
      let fault = PlacementFault.None;
      // Ground the exempt structure is standing on right now: on the map by
      // definition, and neither too steep nor too crowded for a building that
      // is already founded there. See `PlacementExempt`.
      const isExempt = gx >= ex0 && gx < ex1 && gz >= ez0 && gz < ez1;
      if (!isInMap(gx, gz)) fault = PlacementFault.OffMap;
      else if (isExempt) fault = PlacementFault.None;
      else if (terrain.isOccupied(gx, gz)) fault = PlacementFault.Occupied;
      else if (!terrain.isBuildable(gx, gz)) fault = PlacementFault.Terrain;
      if (fault === PlacementFault.None) continue;
      out.cells[z * w + x] = 0;
      out.blocked++;
      if (fault > out.fault) out.fault = fault;
    }
  }

  /* -- anything standing on the site ------------------------------------- */
  // One rect query padded by the largest plausible entity radius, then each
  // blocker is rasterised into the cells its circle actually touches.
  const minX = cx * CELL;
  const minZ = cz * CELL;
  const maxX = (cx + w) * CELL;
  const maxZ = (cz + h) * CELL;
  const pad = 6;
  const store = world.store;
  const buf = world.queryScratch;
  const found = world.spatial.queryRect(minX - pad, minZ - pad, maxX + pad, maxZ + pad, buf);

  for (let k = 0; k < found; k++) {
    const i = buf[k];
    const flags = store.flags[i];
    if ((flags & EntityFlag.Alive) === 0) continue;
    if ((flags & EntityFlag.PendingDestroy) !== 0) continue;
    const kind = store.kind[i];
    // Wrecks and crates get crushed by the foundation; a building already
    // showed up as an occupied cell.
    if (kind === EntityKind.Wreck || kind === EntityKind.Crate) continue;
    if (kind === EntityKind.Prop && (flags & EntityFlag.BlocksNav) === 0) continue;
    if (kind === EntityKind.Building) continue;

    const r = store.radius[i];
    const px = store.posX[i];
    const pz = store.posZ[i];
    const x0 = Math.max(0, Math.floor((px - r) / CELL) - cx);
    const x1 = Math.min(w - 1, Math.floor((px + r) / CELL) - cx);
    const z0 = Math.max(0, Math.floor((pz - r) / CELL) - cz);
    const z1 = Math.min(h - 1, Math.floor((pz + r) / CELL) - cz);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const ci = z * w + x;
        if (out.cells[ci] === 0) continue;
        out.cells[ci] = 0;
        out.blocked++;
        if (PlacementFault.Blocked > out.fault) out.fault = PlacementFault.Blocked;
      }
    }
  }

  /* -- build radius ------------------------------------------------------- */
  out.inRadius = withinBuildRadius(world, player, (minX + maxX) * 0.5, (minZ + maxZ) * 0.5);
  if (!out.inRadius && out.fault === PlacementFault.None) out.fault = PlacementFault.OutOfRange;

  out.ok = out.blocked === 0 && out.inRadius;
  out.reason = out.ok ? '' : FAULT_TEXT[out.fault];
  return out;
}

/**
 * Is (x, z) inside any of the player's completed structures' build radii?
 *
 * A Construction Yard projects the big BUILD_RADIUS; every other finished
 * structure projects the much smaller PLACEMENT.adjacencyRadius. That pair is
 * what makes a base creep outward one structure at a time — the classic C&C
 * feel — instead of letting a single yard paper the whole map.
 */
export function withinBuildRadius(world: World, player: PlayerId, x: number, z: number): boolean {
  const store = world.store;
  const list = store.byKind[EntityKind.Building];
  const count = store.byKindCount[EntityKind.Building];
  const owner = player as number;

  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (store.owner[i] !== owner) continue;
    const flags = store.flags[i];
    if ((flags & EntityFlag.Alive) === 0) continue;
    if ((flags & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
    const radius = ((flags & EntityFlag.IsBuilder) !== 0 ? BUILD_RADIUS : PLACEMENT.adjacencyRadius)
      + store.radius[i];
    const dx = store.posX[i] - x;
    const dz = store.posZ[i] - z;
    if (dx * dx + dz * dz <= radius * radius) return true;
  }
  return false;
}

/* ==========================================================================
 * 2. NOTIFICATIONS
 *
 * core/types.ts has `building:placed` but no placement:began / :rejected, and
 * GameEvents is frozen. These live here and Production re-exports them, so the
 * runtime import edge only ever points Production -> Placement.
 * ========================================================================== */

export const enum PlacementPhase {
  /** The player picked up a finished structure, or an existing one to relocate. */
  Began = 0,
  /** The ghost moved to a new origin cell. */
  Moved = 1,
  /** Planted. The structure entity exists at 0% build progress. */
  Committed = 2,
  /** Refused. `reason` says why; EVA has already said "cannot deploy here". */
  Rejected = 3,
  /** Put back in the queue, still ready. */
  Cancelled = 4,
}

export interface PlacementNotice {
  phase: PlacementPhase;
  player: PlayerId;
  /** Catalog index (BuildEntry.index). */
  defId: number;
  key: string;
  cx: number;
  cz: number;
  /** WORLD-SPACE footprint, already swapped for `facing`. */
  w: number;
  h: number;
  /** Quarter turns clockwise. 0 for everything that never rotates. */
  facing: number;
  ok: boolean;
  reason: string;
  /** Valid only for Committed. */
  id: EntityId;
}

export type PlacementListener = (notice: Readonly<PlacementNotice>) => void;

/* ==========================================================================
 * 2b. THE RELOCATION SEAM
 *
 * `src/sim/Relocate.ts` needs `evaluatePlacement` and the notice enum from this
 * file; this file needs somewhere to hand a committed relocation. Importing
 * each other would make the one runtime cycle in `src/sim`, and this module's
 * whole reason for existing is that the ghost and the sim agree — a cycle is
 * exactly the wrong shape for that.
 *
 * So the edge stays one-way (Relocate -> Placement) and the return path is a
 * registered callback, the same shape as `setProduction` / `setDeploy`.
 * `relocate.system.ts` installs it at init and clears it at dispose; with
 * nothing installed, `beginRelocate` simply refuses and the ghost is never
 * offered a subject it could not commit.
 * ========================================================================== */

export interface RelocateSeam {
  /**
   * Commit: charge, uproot and re-found. Returns false when it was refused.
   *
   * `facing` is the quarter turn the ghost is showing. OMITTED means "whatever
   * it is standing at now", which is what every caller that predates rotation
   * meant and what the tests still ask for.
   */
  commit(
    player: PlayerId, building: EntityId, cx: number, cz: number, facing?: number,
  ): boolean;
  /** Is this structure eligible at all? Fills nothing; a bare yes/no. */
  eligible(player: PlayerId, building: EntityId): boolean;
}

let relocateSeam: RelocateSeam | null = null;

/** Publish the relocation service. `relocate.system.ts` owns both calls. */
export function setRelocateSeam(next: RelocateSeam | null): void {
  relocateSeam = next;
}

/** The installed relocation service, or null. */
export function relocateSeamOf(): RelocateSeam | null {
  return relocateSeam;
}

/* ==========================================================================
 * 3. THE GHOST
 * ========================================================================== */

export interface PlacementDeps {
  world: World;
  scene: THREE.Scene;
  rig: CameraRig;
  canvas: HTMLCanvasElement;
  service: ProductionService;
}

/** Scratch, module-level so the frame path never allocates. */
const groundHit = new THREE.Vector3();
const cellMatrix = new THREE.Matrix4();
const cellPos = new THREE.Vector3();
const cellScale = new THREE.Vector3();
const cellQuat = new THREE.Quaternion();
const okColor = new THREE.Color();
const badColor = new THREE.Color();
const ghostTint = new THREE.Color();
/* The facing marker's own two colours. Fixed, NOT derived from the validity
   tint — that is the whole point of the rebuild. */
const bandColor = new THREE.Color();
const arrowColor = new THREE.Color();
const originCell = new Int32Array(2);

/**
 * The keys that turn the ghost. FIXED, and handled by this controller's own
 * window listener rather than by `src/input/input.system.ts`, for the same
 * reason Escape is: while a structure is on the cursor, placement owns those
 * keystrokes and there must be exactly one handler or a tap rotates twice.
 *
 * `,` and `.` are the only unclaimed pair left. Every letter on the board is
 * spoken for — A S G X D F Y Z H are orders and cam.home, Q E are camera yaw,
 * W A S D are the camera rig's fallback pan, and B T I V plus C R U O P N J K
 * L M are the build keyboard (`ActionCatalogue.BUILD_*_HOTKEYS`). Squatting on
 * one of those would have made a rotate also issue an order. Both rows are on
 * the help screen as `bld.rotateLeft` / `bld.rotateRight`.
 */
const ROTATE_LEFT_CODE = PLACEMENT_ROTATE_HOTKEYS[0];
const ROTATE_RIGHT_CODE = PLACEMENT_ROTATE_HOTKEYS[1];

/* --------------------------------------------------------------------------
 * THE FACING MARKER — MEASURED AS UNREADABLE, THEN REBUILT
 *
 * The player reported building rotation as one of the things they "still can't
 * see in the deployed build". It is implemented, it is deployed, and the keys
 * work — verified in Chromium: at facings 0..3 a 3x2 refinery's ghost, its
 * validity carpet, `evaluatePlacement`, `terrain.markOccupied`, the committed
 * entity's `store.yaw`/`footprintW`/`footprintH` and the finished mesh all
 * agree. Nothing about the mechanism is broken.
 *
 * What was broken is that you cannot SEE it. 35 of the 41 buildings are square,
 * so on most of them the footprint does not change and the only evidence was
 * this marker — which was drawn in the SAME COLOUR as the validity carpet it
 * sits on. A green triangle on a green carpet is a shade difference, and at
 * gameplay zoom it is not a shade difference you notice. Screenshotted at 78 m
 * on a 2x2 Power Plant, facing 0 and facing 2 were separable only by looking
 * for which half of the carpet was slightly lighter.
 *
 * So it is now TWO shapes, and neither takes its colour from the validity tint:
 *
 *   1. a DARK BAND across the front edge of the footprint. It reads at any
 *      zoom, from any camera yaw, and it is the part that still works when the
 *      arrow is nearly edge-on;
 *   2. a WHITE ARROWHEAD standing on that band, pointing out over the front
 *      edge — the direction units leave by (`BuildEntry.exitZ`).
 *
 * White-on-dark rather than accent-on-carpet because the marker has to survive
 * BOTH carpets: an accent that separates from the green is the one that
 * disappears into the red. The dark band is what buys the white its contrast,
 * so the pair is not decoration — remove either and the other stops reading.
 *
 * The constants are local rather than in `src/core/config.ts` because that file
 * is frozen for this pass. `PLACEMENT.facingLift` and `.facingOpacity` are
 * still honoured; these are the geometry `PLACEMENT.facingSize` did not cover.
 * -------------------------------------------------------------------------- */

/** Depth of the dark front band, as a fraction of the footprint's own depth. */
const FACING_BAND_DEPTH = 0.3;
/** Band width, as a fraction of the footprint's width. Inset so the panel's
 *  own edge line still reads as the edge. */
const FACING_BAND_WIDTH = 0.9;
/** Arrowhead half-width and length, as fractions of the SHORTER footprint axis,
 *  so a 3x2 and a 2x2 get an arrow of the same physical size. */
const FACING_ARROW_HALF = 0.3;
const FACING_ARROW_LEN = 0.52;
/** How far the arrow's tip overshoots the front edge, in cells. A marker that
 *  stops exactly at the edge reads as part of the footprint; one that pokes out
 *  reads as pointing. */
const FACING_ARROW_OVERSHOOT = 0.34;
/** Near-black, for the band. Not pure black: the grade has no pure black in it. */
const FACING_BAND_COLOR = '#05080E';
/** The arrowhead. Warm white — cool white reads as a specular highlight. */
const FACING_ARROW_COLOR = '#FFF6E2';

export class PlacementController {
  /** True while a structure is on the cursor. */
  active = false;
  /** The structure being placed, or null. */
  entry: BuildEntry | null = null;
  /** Origin (minimum-corner) cell the ghost is snapped to. */
  cx = 0;
  cz = 0;
  /**
   * Quarter turns clockwise the ghost is holding the structure at, 0..3.
   *
   * IT PERSISTS BETWEEN PLACEMENTS, deliberately. The gesture this exists for
   * is laying a line of walls or a row of defences all facing the same way, and
   * re-rotating for every one of them is the whole cost of the feature. It is
   * never invisible: the ghost draws a dark band and a white arrowhead on the
   * front edge whatever the footprint's shape, so a square structure carrying a
   * facing still says so.
   *
   * A relocation overrides it with the structure's CURRENT facing on pickup —
   * picking a building up must not silently spin it.
   */
  facing = 0;
  /** Latest validity answer. Read by the HUD for the cursor glyph. */
  readonly report: PlacementReport = makePlacementReport();

  /**
   * The live structure this ghost is CARRYING, or NONE for a fresh build.
   *
   * A relocation is the same gesture with a different subject, so it is the
   * same controller, the same hologram and the same validity carpet — one
   * `EntityId` is the entire difference. See `beginRelocate`.
   */
  relocating: EntityId = NONE;
  /** Origin cell the relocation subject currently stands on. */
  private srcCell: PlacementExempt = { cx: 0, cz: 0, w: 0, h: 0 };

  /**
   * When true, a structure that finishes building is picked up automatically.
   *
   * IT SHIPS OFF, at the player's explicit request: "don't auto select the
   * building for placement, just ping me when it's ready to place, I will click
   * and place." A ghost that appears on the cursor unasked hijacks the next
   * left-click — which is very often a selection, a marquee or an order — and
   * the structure is then planted wherever the player happened to be pointing.
   *
   * Nothing is lost by leaving it off: a finished structure sits at the head of
   * its queue indefinitely, keeps its cameo lit with READY, raises the tab
   * alert, plays `EvaLine.ConstructionComplete` and posts a HUD chip naming it.
   * The queue behind it is not stalled by us — that is `BuildQueue`'s rule, and
   * it is the same rule whether the ghost is up or not. `Hud.onSlotActivate`
   * calls `begin()` when the player clicks the cameo.
   *
   * Still a field, not a constant: `?shot=` fixtures and the tutorial can turn
   * it back on, and `checkStagedPlacement` does not go through it at all.
   */
  autoPickup = false;

  private readonly deps: PlacementDeps;
  private readonly group: THREE.Group;
  private readonly volume: THREE.Mesh;
  private readonly volumeMat: THREE.MeshBasicMaterial;
  private readonly edges: THREE.LineSegments;
  private readonly edgeMat: THREE.LineBasicMaterial;
  private readonly cells: THREE.InstancedMesh;
  private readonly cellMat: THREE.MeshBasicMaterial;
  private readonly boxGeo: THREE.BoxGeometry;
  private readonly edgeGeo: THREE.EdgesGeometry;
  /* THE FACING MARKER. See the block comment above `FACING_BAND_DEPTH`: on 35
   * of the 41 buildings the footprint does not change with a turn, so this pair
   * is the ONLY thing on screen that says which way the structure is holding.
   * `band` is the dark strip across the front edge; `arrow` is the white head
   * that points out over it. Both are authored in FOOTPRINT-LOCAL space and
   * rewritten in place every frame, so a footprint change costs no allocation
   * and the two can never disagree about where the front is. */
  private readonly band: THREE.Mesh;
  private readonly bandMat: THREE.MeshBasicMaterial;
  private readonly bandGeo: THREE.BufferGeometry;
  private readonly bandPos: Float32Array;
  private readonly arrow: THREE.Mesh;
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly arrowPos: Float32Array;

  /** Client-space pointer, when we own the cursor. */
  private pointerX = -1;
  private pointerY = -1;
  private ownsCursor = true;
  private listening = false;
  private listeningKeys = false;
  private cursorX = 0;
  private cursorZ = 0;
  private dirty = true;
  /** Set once the scenario's staged placement has been consumed. */
  private scenarioChecked = false;
  private scenarioChecks = 0;
  /**
   * A commit is queued but the sim has not run yet. Without this, autoPickup
   * sees the item still sitting ready for the two or three frames before
   * Phase.Production applies the intent, and puts the ghost straight back on
   * the cursor — a visible flicker on every single structure placed.
   */
  private commitInFlight = false;
  private readonly unsubscribe: () => void;

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.dirty = true;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.active) return;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.dirty = true;
    this.updateCursor();
    if (e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      this.commit();
    } else if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    }
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.active) e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === 'Escape') { this.cancel(); return; }
    // A modifier turns these into something else's chord; never eat those.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === ROTATE_LEFT_CODE) { this.rotate(-1); e.preventDefault(); }
    else if (e.code === ROTATE_RIGHT_CODE) { this.rotate(1); e.preventDefault(); }
  };

  constructor(deps: PlacementDeps) {
    this.deps = deps;

    okColor.setHex(hexToInt(PLACEMENT.validColor)).convertSRGBToLinear();
    badColor.setHex(hexToInt(PLACEMENT.invalidColor)).convertSRGBToLinear();
    ghostTint.setHex(hexToInt(PLACEMENT.ghostColor)).convertSRGBToLinear();
    bandColor.setHex(hexToInt(FACING_BAND_COLOR)).convertSRGBToLinear();
    arrowColor.setHex(hexToInt(FACING_ARROW_COLOR)).convertSRGBToLinear();

    this.group = new THREE.Group();
    this.group.name = 'placement-ghost';
    this.group.visible = false;
    this.group.matrixAutoUpdate = false;

    // Unit box, scaled per structure. One geometry for every footprint.
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.volumeMat = new THREE.MeshBasicMaterial({
      color: ghostTint,
      transparent: true,
      opacity: PLACEMENT.ghostOpacity,
      depthWrite: false,
      // Both faces: at a 39 degree camera the far wall of the volume is what
      // gives the hologram its depth, and back-face culling deletes it.
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.volume = new THREE.Mesh(this.boxGeo, this.volumeMat);
    this.volume.renderOrder = RENDER_ORDER.overlay;
    this.volume.castShadow = false;
    this.volume.receiveShadow = false;
    this.volume.frustumCulled = false;
    this.group.add(this.volume);

    this.edgeGeo = new THREE.EdgesGeometry(this.boxGeo);
    this.edgeMat = new THREE.LineBasicMaterial({
      color: ghostTint,
      transparent: true,
      opacity: PLACEMENT.ghostEdgeOpacity,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.edges = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.edges.renderOrder = RENDER_ORDER.overlay + 1;
    this.edges.frustumCulled = false;
    this.group.add(this.edges);

    // One instanced quad per footprint cell, tinted per instance.
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI * 0.5);
    this.cellMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: PLACEMENT.cellOpacity,
      depthWrite: false,
      toneMapped: false,
      // The carpet sits on the heightfield; without this it z-fights on flats.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.cells = new THREE.InstancedMesh(quad, this.cellMat, MAX_CELLS);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells.renderOrder = RENDER_ORDER.overlay;
    this.cells.frustumCulled = false;
    this.cells.castShadow = false;
    this.cells.receiveShadow = false;
    this.cells.count = 0;
    // Allocate the colour attribute up front so setColorAt never does.
    for (let i = 0; i < MAX_CELLS; i++) this.cells.setColorAt(i, okColor);
    this.group.add(this.cells);

    // THE FACING MARKER, part 1: the dark band across the front edge.
    //
    // Two triangles whose six positions are rewritten by `updateMeshes` in
    // footprint-local space (+Z is forward for every structure in the game —
    // `BuildEntry.exitZ` is measured off that edge). The mesh itself sits at the
    // footprint centre and carries the yaw, so nothing here has to know about
    // rotation and the band can never end up on a different edge than the arrow.
    this.bandPos = new Float32Array(6 * 3);
    this.bandGeo = new THREE.BufferGeometry();
    this.bandGeo.setAttribute('position', new THREE.BufferAttribute(this.bandPos, 3));
    this.bandMat = new THREE.MeshBasicMaterial({
      color: bandColor,
      transparent: true,
      // Deliberately short of opaque: the band is a mark ON the ground, and at
      // full alpha it reads as a hole cut in it.
      opacity: 0.74,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.band = new THREE.Mesh(this.bandGeo, this.bandMat);
    this.band.renderOrder = RENDER_ORDER.overlay + 1;
    this.band.frustumCulled = false;
    this.band.castShadow = false;
    this.band.receiveShadow = false;
    this.group.add(this.band);

    // Part 2: the white arrowhead. A chevron rather than a plain triangle —
    // the notched back edge is what makes it read as an arrow at a glance
    // instead of as a wedge of the footprint.
    this.arrowPos = new Float32Array(4 * 3);
    this.arrowGeo = new THREE.BufferGeometry();
    this.arrowGeo.setAttribute('position', new THREE.BufferAttribute(this.arrowPos, 3));
    this.arrowGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: arrowColor,
      transparent: true,
      opacity: PLACEMENT.facingOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    this.arrow = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    this.arrow.renderOrder = RENDER_ORDER.overlay + 2;
    this.arrow.frustumCulled = false;
    this.arrow.castShadow = false;
    this.arrow.receiveShadow = false;
    this.group.add(this.arrow);

    deps.scene.add(this.group);

    // The sim has the last word on a placement. Whichever way it rules, the
    // commit is no longer in flight; a rejection leaves the structure ready, so
    // autoPickup legitimately puts it straight back on the cursor.
    this.unsubscribe = deps.service.onPlacement((n) => {
      if (n.phase === PlacementPhase.Committed || n.phase === PlacementPhase.Rejected) {
        this.commitInFlight = false;
      }
    });
  }

  /* -- flow -------------------------------------------------------------- */

  /**
   * Pick up a finished structure. `defId` is a `BuildEntry.publicId`, which is
   * also what `Hud.onPlaceRequest` hands out. Returns false when that structure
   * is not something this catalog knows.
   */
  begin(defId: number): boolean {
    const service = this.deps.service;
    const player = this.deps.world.localPlayer;
    const entry = service.catalog.resolve(defId, true);
    if (entry === null) return false;

    this.relocating = NONE;
    this.srcCell.w = 0;
    this.entry = entry;
    this.active = true;
    this.dirty = true;
    this.attach();
    // Start the ghost wherever the cursor already is, so it never flashes at
    // the world origin for one frame.
    this.updateCursor();
    service.publishPlacement(
      PlacementPhase.Began, player, entry, this.cx, this.cz, this.report.ok, this.report.reason,
      this.facing,
    );
    return true;
  }

  /**
   * Turn the ghost by `delta` quarter turns. Negative is anticlockwise.
   *
   * Re-snaps and re-evaluates immediately rather than waiting for the next
   * frame, because at 90 and 270 the footprint SWAPS: a 3x2 becomes a 2x3, the
   * origin cell the cursor implies moves, and the validity carpet has to be a
   * different shape in the same frame the key was pressed. Everything downstream
   * reads `this.report`, which `evaluate` has just rewritten.
   *
   * Returns the new facing so a console poke can read it back.
   */
  rotate(delta: number): number {
    this.facing = normaliseFacing(this.facing + delta);
    if (!this.active || this.entry === null) return this.facing;
    this.dirty = true;
    this.updateCursor();
    this.evaluate();
    this.deps.service.publishPlacement(
      PlacementPhase.Moved, this.deps.world.localPlayer, this.entry,
      this.cx, this.cz, this.report.ok, this.report.reason, this.facing,
    );
    return this.facing;
  }

  /**
   * Pick up a structure that is ALREADY STANDING and carry it to a new site.
   *
   * Everything after this line is the ordinary placement flow: the same
   * hologram, the same per-cell carpet, the same commit click, the same
   * Escape/right-click cancel. The only differences are the subject (a live
   * entity rather than a finished queue item), the validity rule (the
   * structure's own cells are exempt — see `PlacementExempt`) and where the
   * commit goes.
   *
   * Refuses without side effects when there is no relocation service installed,
   * when the entity is not a structure this player may move, or when the
   * catalog has no opinion about what the structure is — the ghost must never
   * be holding something it cannot put down.
   */
  beginRelocate(building: EntityId): boolean {
    const seam = relocateSeamOf();
    if (seam === null) return false;

    const world = this.deps.world;
    const player = world.localPlayer;
    const store = world.store;
    const i = store.index(building);
    if (i < 0 || store.kind[i] !== EntityKind.Building) return false;
    if (!seam.eligible(player, building)) return false;

    const entry = this.deps.service.entryOf(building);
    if (entry === null || entry.footprintW <= 0 || entry.footprintH <= 0) return false;

    // Where it stands now. Those cells are legal ground for it by construction.
    footprintOriginCell(
      store.posX[i], store.posZ[i], store.footprintW[i], store.footprintH[i], originCell,
    );
    this.srcCell.cx = originCell[0];
    this.srcCell.cz = originCell[1];
    this.srcCell.w = store.footprintW[i];
    this.srcCell.h = store.footprintH[i];

    this.relocating = building;
    this.entry = entry;
    this.active = true;
    this.dirty = true;
    // Adopt the structure's own facing. A sticky facing left over from the last
    // thing the player BUILT must not silently spin a building they only meant
    // to slide two cells left.
    this.facing = yawToFacing(store.yaw[i]);
    this.attach();
    this.updateCursor();
    this.deps.service.publishPlacement(
      PlacementPhase.Began, player, entry, this.cx, this.cz, this.report.ok, this.report.reason,
      this.facing,
    );
    return true;
  }

  /**
   * Put it down again.
   *
   * For a fresh build that means back in the queue, still ready. For a
   * relocation it means NOTHING HAPPENED: the structure never left the world,
   * no credits were taken, and the only state that existed was this ghost. That
   * is the whole reason the subject stays standing until the commit lands —
   * a cancel that had to undo a half-finished move is a cancel that can
   * duplicate or destroy a building.
   */
  cancel(): void {
    if (!this.active) return;
    const entry = this.entry;
    this.active = false;
    this.entry = null;
    this.relocating = NONE;
    this.srcCell.w = 0;
    this.group.visible = false;
    this.detach();
    if (entry !== null) {
      this.deps.service.publishPlacement(
        PlacementPhase.Cancelled, this.deps.world.localPlayer, entry, this.cx, this.cz, false, '',
        this.facing,
      );
    }
  }

  /**
   * Try to plant it. The sim re-checks and has the final say, so a rejection
   * here is only the fast local answer — the EVA line comes from the sim.
   */
  commit(): boolean {
    if (!this.active || this.entry === null) return false;
    const entry = this.entry;
    const player = this.deps.world.localPlayer;
    const moving = this.relocating;

    this.evaluate();
    const facing = this.facing;
    if (!this.report.ok) {
      this.deps.service.publishPlacement(
        PlacementPhase.Rejected, player, entry, this.cx, this.cz, false, this.report.reason,
        facing,
      );
      // Still route it through the sim so EVA and the HUD hear one story. A
      // relocation stays on the cursor after a refusal rather than being
      // dropped: the player asked to move a building that is still standing,
      // and taking the ghost away would mean re-selecting it to try again.
      if (moving === NONE) {
        this.deps.service.placeBuilding(player, entry.publicId, this.cx, this.cz, facing);
      } else {
        relocateSeamOf()?.commit(player, moving, this.cx, this.cz, facing);
      }
      return false;
    }

    if (moving !== NONE) {
      // The sim re-checks and charges. If it refuses on something only it can
      // see — the price went up, the garrison filled — the ghost stays up.
      if (relocateSeamOf()?.commit(player, moving, this.cx, this.cz, facing) !== true) return false;
    } else {
      this.commitInFlight = true;
      this.deps.service.placeBuilding(player, entry.publicId, this.cx, this.cz, facing);
    }
    this.active = false;
    this.entry = null;
    this.relocating = NONE;
    this.srcCell.w = 0;
    this.group.visible = false;
    this.detach();
    return true;
  }

  /**
   * Drive the ghost from an external cursor (an input module). The first call
   * takes ownership of the cursor permanently.
   */
  setCursorWorld(x: number, z: number): void {
    if (this.ownsCursor) {
      this.ownsCursor = false;
      this.detachPointer();
    }
    this.cursorX = x;
    this.cursorZ = z;
    this.dirty = true;
  }

  /* -- frame -------------------------------------------------------------- */

  frame(): void {
    if (!this.scenarioChecked) this.checkStagedPlacement();
    // A relocation subject that is shelled while its ghost is up takes the
    // ghost with it. Holding a hologram of a building that no longer exists
    // would let the player "commit" a move of nothing.
    if (this.relocating !== NONE) {
      const store = this.deps.world.store;
      const i = store.index(this.relocating);
      if (i < 0 || (store.flags[i] & EntityFlag.Alive) === 0
        || (store.flags[i] & EntityFlag.PendingDestroy) !== 0) {
        this.cancel();
      }
    }
    if (!this.active) {
      if (this.autoPickup) this.checkAutoPickup();
      if (!this.active) {
        if (this.group.visible) this.group.visible = false;
        return;
      }
    }
    this.updateCursor();
    this.updateMeshes();
  }

  /**
   * A structure that finished while nothing was holding it goes on the cursor.
   * Without this the whole build loop is invisible until a HUD exists.
   */
  private checkAutoPickup(): void {
    const service = this.deps.service;
    if (this.commitInFlight) return;
    const entry = service.pendingStructure(this.deps.world.localPlayer);
    if (entry === null) return;
    this.begin(entry.publicId);
  }

  /**
   * `?shot=placement` stages a ready structure and publishes the cell it wants
   * the ghost on. Honour it exactly once, so the screenshot is the composition
   * the scenario author framed.
   */
  private checkStagedPlacement(): void {
    // Retried for a couple of seconds rather than once. The scenario system
    // inits at Phase.Cleanup and pre-advances the sim, so on a slow boot the
    // first frame can genuinely beat the world it is meant to photograph, and
    // a one-shot check would silently give up on the whole shot.
    if (++this.scenarioChecks >= 120) this.scenarioChecked = true;
    const staged = this.deps.service.stagedPlacement();
    if (staged === null) return;
    this.scenarioChecked = true;
    // The fixture is a composition, not a session: photograph it at facing 0
    // whatever the player (or an earlier shot) last left on the ghost.
    this.facing = 0;
    if (!this.begin(staged.entry.publicId)) return;
    this.cx = staged.cx;
    this.cz = staged.cz;
    // The staged cell is authored, not pointed at: freeze the cursor there.
    this.ownsCursor = false;
    this.detachPointer();
    this.cursorX = (this.cx + staged.entry.footprintW * 0.5) * CELL;
    this.cursorZ = (this.cz + staged.entry.footprintH * 0.5) * CELL;
    this.dirty = true;
    this.evaluate();
  }

  /** Re-snap the origin cell from whatever the cursor currently is. */
  private updateCursor(): void {
    const entry = this.entry;
    if (entry === null) return;
    if (this.ownsCursor && this.pointerX >= 0) {
      if (this.deps.rig.screenToGround(this.pointerX, this.pointerY, groundHit)) {
        this.cursorX = groundHit.x;
        this.cursorZ = groundHit.z;
      }
    }
    // WORLD-SPACE extents. Snapping a turned 3x2 against its unturned 3 would
    // put the ghost half a cell off the grid it is about to be tested on.
    const fw = facedFootprintW(entry.footprintW, entry.footprintH, this.facing);
    const fh = facedFootprintH(entry.footprintW, entry.footprintH, this.facing);
    footprintOriginCell(this.cursorX, this.cursorZ, fw, fh, originCell);
    const ncx = Math.max(0, Math.min(MAP_CELLS - fw, originCell[0]));
    const ncz = Math.max(0, Math.min(MAP_CELLS - fh, originCell[1]));
    if (ncx !== this.cx || ncz !== this.cz || this.dirty) {
      const moved = ncx !== this.cx || ncz !== this.cz;
      this.cx = ncx;
      this.cz = ncz;
      this.dirty = false;
      this.evaluate();
      if (moved) {
        this.deps.service.publishPlacement(
          PlacementPhase.Moved, this.deps.world.localPlayer, entry,
          this.cx, this.cz, this.report.ok, this.report.reason, this.facing,
        );
      }
    }
  }

  /**
   * Ask the one rule.
   *
   * A relocation adds two masks, and both of them say the same true thing —
   * this structure is leaving:
   *
   *   1. its own footprint is exempt ground (`PlacementExempt`), so a two-cell
   *      nudge is not refused for colliding with itself;
   *   2. it is flagged `PendingDestroy` for the duration of the call, which is
   *      the one flag `withinBuildRadius` already skips. Without that, every
   *      structure would project a build radius around ITSELF and could walk
   *      across the map one hop at a time, which quietly deletes the base-creep
   *      rule that `withinBuildRadius` exists to enforce. The new site must be
   *      covered by the rest of the base.
   *
   * The flag is restored in a `finally` and nothing runs in between.
   */
  private evaluate(): void {
    const entry = this.entry;
    if (entry === null) return;
    const world = this.deps.world;
    const player = world.localPlayer;
    const report = this.report;

    if (this.relocating === NONE) {
      evaluatePlacement(world, player, entry, this.cx, this.cz, report, null, this.facing);
      return;
    }

    const store = world.store;
    const i = store.index(this.relocating);
    if (i < 0) {
      evaluatePlacement(world, player, entry, this.cx, this.cz, report, this.srcCell, this.facing);
      return;
    }
    const saved = store.flags[i];
    store.flags[i] = saved | EntityFlag.PendingDestroy;
    try {
      evaluatePlacement(world, player, entry, this.cx, this.cz, report, this.srcCell, this.facing);
    } finally {
      store.flags[i] = saved;
    }
  }

  /** Push the current footprint into the three meshes. Zero allocation. */
  private updateMeshes(): void {
    const entry = this.entry;
    if (entry === null) return;
    // Validity can change under a stationary ghost (a tank drives onto the
    // site), so it is re-derived every frame, not only on a move.
    this.evaluate();

    const world = this.deps.world;
    const w = this.report.w;
    const h = this.report.h;
    const cx = this.cx;
    const cz = this.cz;

    /* -- validity carpet -------------------------------------------------- */
    const n = Math.min(MAX_CELLS, w * h);
    cellQuat.identity();
    const size = CELL - PLACEMENT.cellInset * 2;
    cellScale.set(size, 1, size);
    for (let i = 0; i < n; i++) {
      const lx = i % w;
      const lz = (i / w) | 0;
      const wx = (cx + lx + 0.5) * CELL;
      const wz = (cz + lz + 0.5) * CELL;
      cellPos.set(wx, world.terrain.heightAt(wx, wz) + PLACEMENT.cellLift, wz);
      cellMatrix.compose(cellPos, cellQuat, cellScale);
      this.cells.setMatrixAt(i, cellMatrix);
      this.cells.setColorAt(i, this.report.cells[i] !== 0 ? okColor : badColor);
    }
    this.cells.count = n;
    this.cells.instanceMatrix.needsUpdate = true;
    if (this.cells.instanceColor !== null) this.cells.instanceColor.needsUpdate = true;

    /* -- hologram --------------------------------------------------------- */
    // Sample the footprint corners so the volume sits ON the ground it will be
    // founded on, not on the height under its centre.
    const bx = (cx + w * 0.5) * CELL;
    const bz = (cz + h * 0.5) * CELL;
    let base = world.terrain.heightAt(bx, bz);
    base = Math.max(base, world.terrain.heightAt(cx * CELL, cz * CELL));
    base = Math.max(base, world.terrain.heightAt((cx + w) * CELL, (cz + h) * CELL));

    // `w`/`h` are already the world-space extents, so the box needs no rotation
    // of its own — a box turned 90 degrees IS the swapped box. The facing
    // marker below is what carries the rotation.
    const height = Math.max(1, entry.height);
    this.volume.scale.set(w * CELL, height, h * CELL);
    this.volume.position.set(bx, base + height * 0.5, bz);
    this.volume.updateMatrix();
    this.volume.matrixWorldNeedsUpdate = true;
    this.edges.scale.copy(this.volume.scale);
    this.edges.position.copy(this.volume.position);
    this.edges.updateMatrix();
    this.edges.matrixWorldNeedsUpdate = true;

    /* -- the facing marker -------------------------------------------------
     * Local +Z is forward (`BuildEntry.exitZ` is measured off that edge), so
     * both shapes are authored in the structure's UNSWAPPED local extents and
     * the mesh's own yaw does the turning. Using `w`/`h` here instead would
     * cancel the rotation out on a 3x2 and put the arrow on the wrong edge —
     * which is exactly the double-rotation bug to avoid.
     * --------------------------------------------------------------------- */
    const yaw = facingYaw(this.facing);
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const localW = Math.max(1, entry.footprintW) * CELL;
    const localH = Math.max(1, entry.footprintH) * CELL;
    const halfW = localW * 0.5;
    const halfH = localH * 0.5;

    // Sit the marker on the higher of the centre and the front edge, so on a
    // slope it floats over the ground rather than sinking into it.
    const fx = bx + dirX * halfH;
    const fz = bz + dirZ * halfH;
    const markY = Math.max(world.terrain.heightAt(bx, bz), world.terrain.heightAt(fx, fz))
      + PLACEMENT.facingLift;

    // The band: a strip across the front `FACING_BAND_DEPTH` of the footprint.
    const bandZ0 = halfH - localH * FACING_BAND_DEPTH;
    const bandZ1 = halfH * 0.97;
    const bandX = halfW * FACING_BAND_WIDTH;
    const bp = this.bandPos;
    bp[0] = -bandX; bp[1] = 0; bp[2] = bandZ0;
    bp[3] = bandX; bp[4] = 0; bp[5] = bandZ0;
    bp[6] = bandX; bp[7] = 0; bp[8] = bandZ1;
    bp[9] = -bandX; bp[10] = 0; bp[11] = bandZ0;
    bp[12] = bandX; bp[13] = 0; bp[14] = bandZ1;
    bp[15] = -bandX; bp[16] = 0; bp[17] = bandZ1;
    this.bandGeo.attributes.position.needsUpdate = true;

    // The arrowhead, sized off the SHORTER axis so a 3x2 and a 2x2 get the same
    // physical arrow rather than one that stretches with the footprint.
    const short = Math.min(localW, localH);
    const aHalf = short * FACING_ARROW_HALF;
    const aLen = short * FACING_ARROW_LEN;
    const tipZ = halfH + FACING_ARROW_OVERSHOOT * CELL;
    const backZ = tipZ - aLen;
    const notchZ = backZ + aLen * 0.38;
    const ap = this.arrowPos;
    ap[0] = 0; ap[1] = 0; ap[2] = tipZ;             // tip
    ap[3] = -aHalf; ap[4] = 0; ap[5] = backZ;       // left barb
    ap[6] = 0; ap[7] = 0; ap[8] = notchZ;           // notch
    ap[9] = aHalf; ap[10] = 0; ap[11] = backZ;      // right barb
    this.arrowGeo.attributes.position.needsUpdate = true;

    this.band.position.set(bx, markY, bz);
    this.band.rotation.set(0, yaw, 0);
    this.band.updateMatrix();
    this.band.matrixWorldNeedsUpdate = true;
    // A hair above the band, so the white never z-fights the near-black.
    this.arrow.position.set(bx, markY + 0.02, bz);
    this.arrow.rotation.set(0, yaw, 0);
    this.arrow.updateMatrix();
    this.arrow.matrixWorldNeedsUpdate = true;

    // The hologram takes the validity tint; the marker does NOT. It has to stay
    // legible over both the green carpet and the red one, and a colour that
    // separates from one is the colour that vanishes into the other.
    const tint = this.report.ok ? okColor : badColor;
    this.volumeMat.color.copy(tint);
    this.edgeMat.color.copy(tint);

    this.group.visible = true;
  }

  /* -- pointer ------------------------------------------------------------ */

  /**
   * The KEYBOARD and the POINTER are attached separately, and that separation
   * is load-bearing.
   *
   * The pointer is conditional: `setCursorWorld` hands the cursor to an input
   * module permanently and these listeners come off. The keyboard is not —
   * Escape cancels the ghost and `,` / `.` turn it whoever is driving the
   * cursor, including a `?shot=` fixture that froze it on an authored cell.
   * When they were one flag, handing the cursor over silently took the rotate
   * and cancel keys with it.
   */
  private attach(): void {
    this.attachKeys();
    if (!this.ownsCursor || this.listening) return;
    const canvas = this.deps.canvas;
    if (canvas === null || typeof canvas.addEventListener !== 'function') return;
    // Capture phase: while a structure is on the cursor, the click belongs to
    // placement and must not also start a selection box.
    canvas.addEventListener('pointermove', this.onPointerMove, true);
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('contextmenu', this.onContextMenu, true);
    this.listening = true;
  }

  private attachKeys(): void {
    if (this.listeningKeys || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown);
    this.listeningKeys = true;
  }

  private detach(): void {
    this.detachPointer();
    this.detachKeys();
  }

  private detachKeys(): void {
    if (!this.listeningKeys) return;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.listeningKeys = false;
  }

  private detachPointer(): void {
    if (!this.listening) return;
    const canvas = this.deps.canvas;
    if (canvas !== null && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('pointermove', this.onPointerMove, true);
      canvas.removeEventListener('pointerdown', this.onPointerDown, true);
      canvas.removeEventListener('contextmenu', this.onContextMenu, true);
    }
    this.listening = false;
  }

  dispose(): void {
    this.unsubscribe();
    this.detach();
    this.group.removeFromParent();
    this.boxGeo.dispose();
    this.edgeGeo.dispose();
    this.bandGeo.dispose();
    this.arrowGeo.dispose();
    this.cells.geometry.dispose();
    this.volumeMat.dispose();
    this.edgeMat.dispose();
    this.cellMat.dispose();
    this.bandMat.dispose();
    this.arrowMat.dispose();
    this.cells.dispose();
    this.entry = null;
    this.active = false;
    this.relocating = NONE;
    this.srcCell.w = 0;
  }
}

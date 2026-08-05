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

import type { BuildEntry, ProductionService } from './Production';

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
  w: number;
  h: number;
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
    cx: 0, cz: 0, w: 0, h: 0,
    cells: new Uint8Array(MAX_CELLS),
    blocked: 0, inRadius: false,
  };
}

/** The shared report the sim-side commit uses. Never retained. */
export const placementReport: PlacementReport = makePlacementReport();

/**
 * Can `player` found `entry` with its minimum-corner cell at (cx, cz)?
 *
 * Fills `out` and returns it. Allocation-free: one spatial rect query and a
 * walk over the player's structures, both into caller-owned buffers.
 */
export function evaluatePlacement(
  world: World,
  player: PlayerId,
  entry: BuildEntry,
  cx: number,
  cz: number,
  out: PlacementReport,
  exempt: PlacementExempt | null = null,
): PlacementReport {
  const w = Math.max(1, Math.min(PLACEMENT.maxFootprintCells, entry.footprintW));
  const h = Math.max(1, Math.min(PLACEMENT.maxFootprintCells, entry.footprintH));
  out.cx = cx;
  out.cz = cz;
  out.w = w;
  out.h = h;
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
  w: number;
  h: number;
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
  /** Commit: charge, uproot and re-found. Returns false when it was refused. */
  commit(player: PlayerId, building: EntityId, cx: number, cz: number): boolean;
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
const originCell = new Int32Array(2);

export class PlacementController {
  /** True while a structure is on the cursor. */
  active = false;
  /** The structure being placed, or null. */
  entry: BuildEntry | null = null;
  /** Origin (minimum-corner) cell the ghost is snapped to. */
  cx = 0;
  cz = 0;
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
   * The HUD turns this off and drives `begin()` from the cameo click instead.
   */
  autoPickup = true;

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

  /** Client-space pointer, when we own the cursor. */
  private pointerX = -1;
  private pointerY = -1;
  private ownsCursor = true;
  private listening = false;
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
    if (this.active && e.key === 'Escape') this.cancel();
  };

  constructor(deps: PlacementDeps) {
    this.deps = deps;

    okColor.setHex(hexToInt(PLACEMENT.validColor)).convertSRGBToLinear();
    badColor.setHex(hexToInt(PLACEMENT.invalidColor)).convertSRGBToLinear();
    ghostTint.setHex(hexToInt(PLACEMENT.ghostColor)).convertSRGBToLinear();

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
    );
    return true;
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
    this.attach();
    this.updateCursor();
    this.deps.service.publishPlacement(
      PlacementPhase.Began, player, entry, this.cx, this.cz, this.report.ok, this.report.reason,
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
    if (!this.report.ok) {
      this.deps.service.publishPlacement(
        PlacementPhase.Rejected, player, entry, this.cx, this.cz, false, this.report.reason,
      );
      // Still route it through the sim so EVA and the HUD hear one story. A
      // relocation stays on the cursor after a refusal rather than being
      // dropped: the player asked to move a building that is still standing,
      // and taking the ghost away would mean re-selecting it to try again.
      if (moving === NONE) {
        this.deps.service.placeBuilding(player, entry.publicId, this.cx, this.cz);
      } else {
        relocateSeamOf()?.commit(player, moving, this.cx, this.cz);
      }
      return false;
    }

    if (moving !== NONE) {
      // The sim re-checks and charges. If it refuses on something only it can
      // see — the price went up, the garrison filled — the ghost stays up.
      if (relocateSeamOf()?.commit(player, moving, this.cx, this.cz) !== true) return false;
    } else {
      this.commitInFlight = true;
      this.deps.service.placeBuilding(player, entry.publicId, this.cx, this.cz);
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
    if (this.entry === null) return;
    if (this.ownsCursor && this.pointerX >= 0) {
      if (this.deps.rig.screenToGround(this.pointerX, this.pointerY, groundHit)) {
        this.cursorX = groundHit.x;
        this.cursorZ = groundHit.z;
      }
    }
    footprintOriginCell(
      this.cursorX, this.cursorZ, this.entry.footprintW, this.entry.footprintH, originCell,
    );
    const ncx = Math.max(0, Math.min(MAP_CELLS - this.entry.footprintW, originCell[0]));
    const ncz = Math.max(0, Math.min(MAP_CELLS - this.entry.footprintH, originCell[1]));
    if (ncx !== this.cx || ncz !== this.cz || this.dirty) {
      const moved = ncx !== this.cx || ncz !== this.cz;
      this.cx = ncx;
      this.cz = ncz;
      this.dirty = false;
      this.evaluate();
      if (moved) {
        this.deps.service.publishPlacement(
          PlacementPhase.Moved, this.deps.world.localPlayer, this.entry,
          this.cx, this.cz, this.report.ok, this.report.reason,
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
      evaluatePlacement(world, player, entry, this.cx, this.cz, report);
      return;
    }

    const store = world.store;
    const i = store.index(this.relocating);
    if (i < 0) {
      evaluatePlacement(world, player, entry, this.cx, this.cz, report, this.srcCell);
      return;
    }
    const saved = store.flags[i];
    store.flags[i] = saved | EntityFlag.PendingDestroy;
    try {
      evaluatePlacement(world, player, entry, this.cx, this.cz, report, this.srcCell);
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

    const height = Math.max(1, entry.height);
    this.volume.scale.set(w * CELL, height, h * CELL);
    this.volume.position.set(bx, base + height * 0.5, bz);
    this.volume.updateMatrix();
    this.volume.matrixWorldNeedsUpdate = true;
    this.edges.scale.copy(this.volume.scale);
    this.edges.position.copy(this.volume.position);
    this.edges.updateMatrix();
    this.edges.matrixWorldNeedsUpdate = true;

    const tint = this.report.ok ? okColor : badColor;
    this.volumeMat.color.copy(tint);
    this.edgeMat.color.copy(tint);

    this.group.visible = true;
  }

  /* -- pointer ------------------------------------------------------------ */

  private attach(): void {
    if (!this.ownsCursor || this.listening) return;
    const canvas = this.deps.canvas;
    if (canvas === null || typeof canvas.addEventListener !== 'function') return;
    // Capture phase: while a structure is on the cursor, the click belongs to
    // placement and must not also start a selection box.
    canvas.addEventListener('pointermove', this.onPointerMove, true);
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('contextmenu', this.onContextMenu, true);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
    this.listening = true;
  }

  private detach(): void {
    this.detachPointer();
  }

  private detachPointer(): void {
    if (!this.listening) return;
    const canvas = this.deps.canvas;
    if (canvas !== null && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('pointermove', this.onPointerMove, true);
      canvas.removeEventListener('pointerdown', this.onPointerDown, true);
      canvas.removeEventListener('contextmenu', this.onContextMenu, true);
    }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.listening = false;
  }

  dispose(): void {
    this.unsubscribe();
    this.detachPointer();
    this.group.removeFromParent();
    this.boxGeo.dispose();
    this.edgeGeo.dispose();
    this.cells.geometry.dispose();
    this.volumeMat.dispose();
    this.edgeMat.dispose();
    this.cellMat.dispose();
    this.cells.dispose();
    this.entry = null;
    this.active = false;
    this.relocating = NONE;
    this.srcCell.w = 0;
  }
}

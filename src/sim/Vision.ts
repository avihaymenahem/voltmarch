/**
 * ============================================================================
 * RED ALERT — src/sim/Vision.ts
 * ============================================================================
 * PER-PLAYER VISION OVER THE CELL GRID. The `IVision` port's real implementation.
 *
 * THREE STATES, ONE BYTE, TWO BITS
 * --------------------------------
 *   0b00  unexplored  — never seen. Black. Terrain is not even remembered.
 *   0b10  explored    — seen once. Terrain and STATIC objects are remembered,
 *                       everything that can move is hidden.
 *   0b11  visible     — lit right now by something that provides vision.
 *
 * `visible` always implies `explored`, so a caller can test one bit and never
 * has to reason about a third combination. That layout is also exactly what
 * `IVision.gridFor()` promises the shroud shader and the minimap.
 *
 * WHY A TIMER GRID AND NOT A REFCOUNT
 * -----------------------------------
 * The obvious implementation refcounts each cell as units enter and leave it.
 * It is wrong here for two reasons: a unit that dies mid-stride leaks its
 * reference forever, and `VISION_REGROW_DELAY` (config §16) wants a cell to stay
 * lit for two seconds after the last unit walks away — which a refcount cannot
 * express at all. So instead each cell holds a small countdown in VISION TICKS.
 * Stamping writes the countdown; the tick ages it; a cell is visible while it is
 * non-zero. Nothing can leak, because nothing holds a reference.
 *
 * COST
 * ----
 * Stamping runs every `VISION_TICK_INTERVAL` ticks (10 Hz), never per tick. One
 * pass is: age 16384 bytes per player, stamp ~40 cells per sighted entity, then
 * compose 16384 bytes per player. At two players and 250 entities that is about
 * 75k byte writes at 10 Hz — under 0.1 ms, and it allocates nothing.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never touches THREE, never reads the camera, and never looks at
 * `world.localPlayer` except through `applyRenderMask()`, which is called from
 * the RENDER frame and undone again in the same frame (see the header of
 * vision.system.ts). The deterministic simulation therefore never observes a
 * viewer-dependent bit.
 * ============================================================================
 */

import {
  CELL, MAP_CELLS, MAP_CELL_COUNT, MAP_SIZE, MAX_ENTITIES, MAX_PLAYERS,
  SIM_DT, VISION_TICK_INTERVAL, VISION_REGROW_DELAY,
  FOG_DEFAULT_SIGHT, FOG_MIN_SIGHT, FOG_SIGHT_SCALE, FOG_STRUCTURE_SIGHT_BONUS,
  FOG_RADAR_DETECT_MUL, FOG_CLOAK_REVEAL_SECONDS, FOG_MAX_DETECTORS,
} from '../core/config';
import { EntityFlag, EntityKind } from '../core/types';
import type { EntityId, PlayerId, IVision } from '../core/types';
import type { World } from '../core/world';
import { PerEntityF32, PerEntityU32 } from '../core/world';
import { clampCell, isInMap, worldToCell } from '../core/math';

/* ==========================================================================
 * 1. GRID VOCABULARY
 * ========================================================================== */

/** Bit 0 of a grid byte: the cell is lit RIGHT NOW. */
export const VIS_VISIBLE = 1;
/** Bit 1 of a grid byte: the cell has been seen at least once. */
export const VIS_EXPLORED = 2;
/** Both bits. The value a fully-revealed grid is filled with. */
export const VIS_FULL = VIS_VISIBLE | VIS_EXPLORED;

/** Cloak reason bits, stored per entity. Any non-zero value conceals. */
export const CLOAK_ABILITY = 1;
export const CLOAK_SUBMERGED = 2;

/**
 * Vision ticks a stamped cell stays lit after the last stamp. Derived from
 * `VISION_REGROW_DELAY` so the config number means seconds, not ticks.
 */
export const VISION_REGROW_TICKS = Math.max(
  1,
  Math.min(255, Math.round(VISION_REGROW_DELAY / (VISION_TICK_INTERVAL * SIM_DT))),
);

/** Live counters for the F3 overlay and the boot log. */
export interface VisionStats {
  /** Cells currently lit for the local player. */
  visible: number;
  /** Cells ever seen by the local player. */
  explored: number;
  /** Entities that contributed a vision stamp on the last pass. */
  sources: number;
  /** Active cloak detectors on the last pass. */
  detectors: number;
  /** Entities hidden from the local viewer by the last `applyRenderMask`. */
  masked: number;
}

/* ==========================================================================
 * 2. THE VISION GRID
 * ========================================================================== */

export class Vision implements IVision {
  /** Per-player 2-bit grid, MAP_CELLS x MAP_CELLS, row-major (cz * MAP_CELLS + cx). */
  private readonly grids: Uint8Array[] = [];
  /** Per-player countdown in vision ticks. Non-zero == visible. */
  private readonly timers: Uint8Array[] = [];
  /** Bumped whenever a player's grid actually changed. Cheap change detection. */
  readonly version = new Int32Array(MAX_PLAYERS);

  /** Per-player cell counts, maintained by the compose pass. */
  private readonly visibleCells = new Int32Array(MAX_PLAYERS);
  private readonly exploredCells = new Int32Array(MAX_PLAYERS);

  /**
   * Master switch. When false every query answers "visible and explored" and
   * the grids are held fully lit, so the screenshot harness photographs art
   * rather than a black rectangle. See `FOG_REVEAL_IN_SHOT_MODE`.
   */
  private on: boolean;

  /* -- cloak / detection --------------------------------------------------- */

  /** CLOAK_* bits per entity. Generation-stamped: a recycled slot reads 0. */
  private readonly cloakBits: PerEntityU32;
  /** Sim time until which a cloaked entity is exposed (it fired, or was hit). */
  private readonly revealUntil: PerEntityF32;
  /** Explicit detector radius in metres, 0 = not a detector. */
  private readonly detectRadius: PerEntityF32;

  /** Dense detector list, rebuilt every vision pass. Never allocated. */
  private readonly detX = new Float32Array(FOG_MAX_DETECTORS);
  private readonly detZ = new Float32Array(FOG_MAX_DETECTORS);
  private readonly detR2 = new Float32Array(FOG_MAX_DETECTORS);
  /** allyMask of the detector's owner, so allies share detection. */
  private readonly detAlly = new Int32Array(FOG_MAX_DETECTORS);
  private detCount = 0;

  /** Bit i set = player i has a live, powered radar structure. */
  private radarMask = 0;

  /* -- render mask bookkeeping --------------------------------------------- */

  /**
   * Slots whose `EntityFlag.Cloaked` bit the render pass flipped, and what it
   * was before. `clearRenderMask()` restores exactly these and nothing else, so
   * a genuine cloak set by `simTick` survives the round trip untouched.
   */
  private readonly maskedIdx = new Int32Array(MAX_ENTITIES);
  private readonly maskedWas = new Uint8Array(MAX_ENTITIES);
  private maskedCount = 0;

  /* -- diagnostics ---------------------------------------------------------- */

  private sourceCount = 0;
  /** Reused stats object — reading stats must not allocate. */
  private readonly statsOut: VisionStats = {
    visible: 0, explored: 0, sources: 0, detectors: 0, masked: 0,
  };

  constructor(private readonly world: World, enabled = true) {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      this.grids.push(new Uint8Array(MAP_CELL_COUNT));
      this.timers.push(new Uint8Array(MAP_CELL_COUNT));
    }
    this.cloakBits = new PerEntityU32(world.store, 0);
    this.revealUntil = new PerEntityF32(world.store, -1e9);
    this.detectRadius = new PerEntityF32(world.store, 0);
    this.on = enabled;
    if (!enabled) this.revealAll();
  }

  /* ------------------------------------------------------------------------
   * 2.1 IVision — the port every other module reaches vision through
   * ---------------------------------------------------------------------- */

  isVisibleAt(player: PlayerId, cx: number, cz: number): boolean {
    if (!this.on) return true;
    if (!isInMap(cx, cz)) return false;
    return (this.grids[player as number][cz * MAP_CELLS + cx] & VIS_VISIBLE) !== 0;
  }

  isExplored(player: PlayerId, cx: number, cz: number): boolean {
    if (!this.on) return true;
    if (!isInMap(cx, cz)) return false;
    return (this.grids[player as number][cz * MAP_CELLS + cx] & VIS_EXPLORED) !== 0;
  }

  /**
   * The one call targeting uses. An entity is visible to a player when it is
   * allied (you always see your own army), OR it stands on a lit cell and is
   * not concealed by a cloak this player cannot detect.
   *
   * Deliberately NOT true for a remembered structure: a Construction Yard you
   * scouted an hour ago must not be auto-targetable through the shroud. Use
   * `isRemembered` for the render-side "draw the silhouette" question.
   */
  canSee(player: PlayerId, target: EntityId): boolean {
    const s = this.world.store;
    const i = s.index(target);
    if (i < 0) return false;
    if (!this.on) return true;
    if (this.world.areAllied(player, s.owner[i] as PlayerId)) return true;
    if (this.isConcealed(i, player)) return false;
    const cx = worldToCell(s.posX[i]);
    const cz = worldToCell(s.posZ[i]);
    if (!isInMap(cx, cz)) return false;
    return (this.grids[player as number][cz * MAP_CELLS + cx] & VIS_VISIBLE) !== 0;
  }

  hasRadar(player: PlayerId): boolean {
    if ((this.radarMask & (1 << (player as number))) !== 0) return true;
    // Economy owns `PlayerState.hasRadar`; honour it when it is being written.
    return this.world.players[player as number]?.hasRadar === true;
  }

  /** Raw 2-bit grid for the shroud shader and the minimap. Do not mutate. */
  gridFor(player: PlayerId): Uint8Array {
    return this.grids[player as number] ?? this.grids[0];
  }

  /* ------------------------------------------------------------------------
   * 2.2 Extra queries the port does not carry
   * ---------------------------------------------------------------------- */

  /** True while fog is actually being simulated. */
  get enabled(): boolean { return this.on; }

  /**
   * Turn fog on or off wholesale. Turning it OFF fills every grid, which is
   * what the `?shot=` harness and a scenario's `revealMap` want; turning it
   * back ON keeps the explored bits (you do not un-scout a map).
   */
  setEnabled(v: boolean): void {
    if (this.on === v) return;
    this.on = v;
    if (!v) {
      this.revealAll();
    } else {
      // Drop the "visible" bits immediately; the next stamp re-lights whatever
      // is genuinely in sight. Explored memory is kept on purpose.
      for (let p = 0; p < MAX_PLAYERS; p++) {
        const g = this.grids[p];
        const t = this.timers[p];
        for (let i = 0; i < MAP_CELL_COUNT; i++) g[i] &= VIS_EXPLORED;
        t.fill(0);
        this.version[p]++;
      }
    }
  }

  /**
   * True when a player should still be shown a STATIC entity (structure, prop,
   * wreck) it has scouted but cannot currently see — the "remembered
   * silhouette". False for anything that can move: a tank you saw two minutes
   * ago is not there any more, and drawing it would be a lie the player acts on.
   */
  isRemembered(player: PlayerId, target: EntityId): boolean {
    if (!this.on) return true;
    const s = this.world.store;
    const i = s.index(target);
    if (i < 0) return false;
    if (!isStaticKind(s.kind[i])) return false;
    const cx = worldToCell(s.posX[i]);
    const cz = worldToCell(s.posZ[i]);
    if (!isInMap(cx, cz)) return false;
    return (this.grids[player as number][cz * MAP_CELLS + cx] & VIS_EXPLORED) !== 0;
  }

  /** Cells lit / ever seen, for the F3 overlay. Fills a reused object. */
  stats(player: PlayerId): VisionStats {
    const o = this.statsOut;
    o.visible = this.visibleCells[player as number];
    o.explored = this.exploredCells[player as number];
    o.sources = this.sourceCount;
    o.detectors = this.detCount;
    o.masked = this.maskedCount;
    return o;
  }

  /* ------------------------------------------------------------------------
   * 2.3 Cloak, submersion and detectors
   * ---------------------------------------------------------------------- */

  /**
   * Set or clear a cloak. `reason` is CLOAK_ABILITY or CLOAK_SUBMERGED so a
   * submarine that surfaces to fire and a Mirage tank that decloaks to fire do
   * not clobber each other's bit.
   */
  setCloaked(id: EntityId, on: boolean, reason = CLOAK_ABILITY): void {
    const prev = this.cloakBits.get(id);
    const next = on ? (prev | reason) : (prev & ~reason);
    this.cloakBits.set(id, next);
  }

  /** True if any cloak reason is active AND the entity is not currently exposed. */
  isCloaked(id: EntityId): boolean {
    if (this.cloakBits.get(id) === 0) return false;
    return this.revealUntil.get(id) <= this.world.time;
  }

  /**
   * Expose a cloaked entity for `seconds` — what firing, or taking a hit, does
   * to a cloaked unit. Defaults to `FOG_CLOAK_REVEAL_SECONDS`.
   */
  revealFor(id: EntityId, seconds = FOG_CLOAK_REVEAL_SECONDS): void {
    this.revealUntil.set(id, this.world.time + seconds);
  }

  /** Make an entity a cloak detector out to `metres`. 0 clears it. */
  setDetector(id: EntityId, metres: number): void {
    this.detectRadius.set(id, metres > 0 ? metres : 0);
  }

  /** True if `player` (or an ally) has a detector covering a world position. */
  isDetectedAt(player: PlayerId, x: number, z: number): boolean {
    const bit = 1 << (player as number);
    for (let k = 0; k < this.detCount; k++) {
      if ((this.detAlly[k] & bit) === 0) continue;
      const dx = this.detX[k] - x;
      const dz = this.detZ[k] - z;
      if (dx * dx + dz * dz <= this.detR2[k]) return true;
    }
    return false;
  }

  /** Slot-index fast path: cloaked, not exposed, and not inside a detector. */
  private isConcealed(i: number, viewer: PlayerId): boolean {
    if (this.cloakBits.getAt(i) === 0) return false;
    const s = this.world.store;
    if (this.revealUntil.getAt(i) > this.world.time) return false;
    return !this.isDetectedAt(viewer, s.posX[i], s.posZ[i]);
  }

  /**
   * Publish the viewer-independent part of concealment into
   * `EntityFlag.Cloaked`, so a combat scan that only tests
   * `TARGETABLE_REJECT_MASK` still refuses to shoot at a submerged submarine.
   * Per-viewer DETECTION is deliberately not folded in here — that is what
   * `canSee` is for.
   *
   * Only entities that have ever been handed to `setCloaked` are touched, so
   * this can never clear a flag some other module owns.
   */
  tickCloak(): void {
    const s = this.world.store;
    const n = s.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      const bits = this.cloakBits.getAt(i);
      if (bits === 0) {
        // `has` distinguishes "never registered" from "registered, now clear".
        if ((s.flags[i] & EntityFlag.Cloaked) !== 0 && this.cloakBits.has(s.handleOf(i))) {
          s.flags[i] &= ~EntityFlag.Cloaked;
        }
        continue;
      }
      if (this.revealUntil.getAt(i) > this.world.time) s.flags[i] &= ~EntityFlag.Cloaked;
      else s.flags[i] |= EntityFlag.Cloaked;
    }
  }

  /* ------------------------------------------------------------------------
   * 2.4 The stamp pass — called every VISION_TICK_INTERVAL ticks
   * ---------------------------------------------------------------------- */

  /**
   * Age every timer, re-stamp from every sighted entity, then recompose the
   * 2-bit grids. Allocation-free and deterministic: it reads only sim state.
   *
   * Returns a bitmask of players whose grid changed, so the caller can emit
   * `vision:changed` for exactly those and no others.
   */
  update(): number {
    if (!this.on) return 0;

    const world = this.world;
    const s = world.store;
    const np = world.players.length;
    if (np === 0) return 0;

    /* -- 1. age ---------------------------------------------------------- */
    for (let p = 0; p < np; p++) {
      const t = this.timers[p];
      for (let i = 0; i < MAP_CELL_COUNT; i++) {
        const v = t[i];
        if (v !== 0) t[i] = v - 1;
      }
    }

    /* -- 2. stamp + collect detectors ------------------------------------ */
    this.detCount = 0;
    this.radarMask = 0;
    this.sourceCount = 0;

    const n = s.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      const f = s.flags[i];
      // A garrisoned passenger sees through its transport, not through walls,
      // and a corpse mid-cleanup must not light the cell it died on.
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;

      const owner = s.owner[i];
      const ally = world.players[owner]?.allyMask ?? (1 << owner);

      const r = this.sightOf(i, f);
      if (r > 0) {
        this.sourceCount++;
        this.stampCircle(ally, s.posX[i], s.posZ[i], r, np);
      }

      /* detectors: an explicit radius, or a powered radar structure. */
      let dr = this.detectRadius.getAt(i);
      if ((f & EntityFlag.IsRadar) !== 0 && (f & EntityFlag.Powered) !== 0) {
        this.radarMask |= 1 << owner;
        const implied = r * FOG_RADAR_DETECT_MUL;
        if (implied > dr) dr = implied;
      }
      if (dr > 0 && this.detCount < FOG_MAX_DETECTORS) {
        const k = this.detCount++;
        this.detX[k] = s.posX[i];
        this.detZ[k] = s.posZ[i];
        this.detR2[k] = dr * dr;
        this.detAlly[k] = ally;
      }
    }

    /* -- 3. compose ------------------------------------------------------- */
    let changedMask = 0;
    for (let p = 0; p < np; p++) {
      const g = this.grids[p];
      const t = this.timers[p];
      let changed = false;
      let vis = 0;
      let exp = 0;
      for (let i = 0; i < MAP_CELL_COUNT; i++) {
        const prev = g[i];
        const lit = t[i] !== 0;
        const next = lit ? VIS_FULL : (prev & VIS_EXPLORED);
        if (next !== prev) { g[i] = next; changed = true; }
        if (lit) vis++;
        if (next !== 0) exp++;
      }
      this.visibleCells[p] = vis;
      this.exploredCells[p] = exp;
      if (changed) { this.version[p]++; changedMask |= 1 << p; }
    }
    return changedMask;
  }

  /**
   * Sight radius in metres for a slot, or 0 if it contributes nothing.
   *
   * `store.sight` is authoritative when a def table (or a scenario) has filled
   * it in. When it has not — the boot state of this repo — a per-kind default
   * keeps fog meaningful instead of blacking out the whole map.
   */
  private sightOf(i: number, flags: number): number {
    const s = this.world.store;
    const kind = s.kind[i];

    // Wrecks, props and crates only see if something explicitly said so.
    if (kind === EntityKind.Wreck || kind === EntityKind.Prop || kind === EntityKind.Crate) {
      if ((flags & EntityFlag.ProvidesVision) === 0) return 0;
    }

    let base = s.sight[i];
    if (base <= 0) base = FOG_DEFAULT_SIGHT[kind] ?? 0;
    if (base <= 0) return 0;
    if (base < FOG_MIN_SIGHT) base = FOG_MIN_SIGHT;

    let r = base * FOG_SIGHT_SCALE;
    if (kind === EntityKind.Building) r += FOG_STRUCTURE_SIGHT_BONUS;
    return r;
  }

  /**
   * Light every cell whose CENTRE lies inside a world-space circle, for every
   * player in `allyMask`. Cell centres rather than cell rectangles: a rectangle
   * test makes a 9 m sight radius cover a visibly square 5x5 block, and the
   * circle is what the shader's smooth ramp expects to find.
   */
  private stampCircle(allyMask: number, x: number, z: number, r: number, np: number): void {
    const cx0 = clampCell(worldToCell(x - r));
    const cx1 = clampCell(worldToCell(x + r));
    const cz0 = clampCell(worldToCell(z - r));
    const cz1 = clampCell(worldToCell(z + r));
    const r2 = r * r;

    for (let cz = cz0; cz <= cz1; cz++) {
      const wz = (cz + 0.5) * CELL - z;
      const dz2 = wz * wz;
      const row = cz * MAP_CELLS;
      for (let cx = cx0; cx <= cx1; cx++) {
        const wx = (cx + 0.5) * CELL - x;
        if (wx * wx + dz2 > r2) continue;
        const idx = row + cx;
        for (let p = 0; p < np; p++) {
          if ((allyMask & (1 << p)) !== 0) this.timers[p][idx] = VISION_REGROW_TICKS;
        }
      }
    }
  }

  /* ------------------------------------------------------------------------
   * 2.5 Manual reveals
   * ---------------------------------------------------------------------- */

  /** Light and explore every cell for every player. Used by `revealMap`. */
  revealAll(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      this.grids[p].fill(VIS_FULL);
      this.timers[p].fill(VISION_REGROW_TICKS);
      this.visibleCells[p] = MAP_CELL_COUNT;
      this.exploredCells[p] = MAP_CELL_COUNT;
      this.version[p]++;
    }
  }

  /**
   * Permanently mark a circle explored for one player without giving live
   * vision. This is the "you start knowing where your own base is" reveal, and
   * the hook a map-reveal crate would use.
   */
  exploreCircle(player: PlayerId, x: number, z: number, r: number): void {
    const g = this.grids[player as number];
    if (g === undefined) return;
    const cx0 = clampCell(worldToCell(x - r));
    const cx1 = clampCell(worldToCell(x + r));
    const cz0 = clampCell(worldToCell(z - r));
    const cz1 = clampCell(worldToCell(z + r));
    const r2 = r * r;
    for (let cz = cz0; cz <= cz1; cz++) {
      const wz = (cz + 0.5) * CELL - z;
      const dz2 = wz * wz;
      const row = cz * MAP_CELLS;
      for (let cx = cx0; cx <= cx1; cx++) {
        const wx = (cx + 0.5) * CELL - x;
        if (wx * wx + dz2 > r2) continue;
        g[row + cx] |= VIS_EXPLORED;
      }
    }
    this.version[player as number]++;
  }

  /* ------------------------------------------------------------------------
   * 2.6 The render mask
   *
   * `RenderBridge` hides anything carrying `EntityFlag.Cloaked`. That flag is
   * the only lever this module has over what the instancer draws, so the render
   * frame borrows it for one phase and gives it back — see the ownership note
   * in vision.system.ts. The pair MUST be called together, and always in the
   * same frame.
   * ---------------------------------------------------------------------- */

  /**
   * Force `EntityFlag.Cloaked` to mean "hidden from `viewer`" for the duration
   * of this render frame. Records the previous value of every bit it touches.
   *
   * Two rules, and they are the whole fog-of-war read:
   *   - Anything that can MOVE is drawn only while its cell is lit.
   *   - Anything STATIC (structure, prop, wreck) is drawn while its cell is
   *     merely explored — the remembered silhouette.
   * A friendly cloaked unit is force-UNhidden, so your own submarines are
   * visible to you even though the sim has them flagged.
   */
  applyRenderMask(viewer: PlayerId): number {
    this.clearRenderMask();
    if (!this.on) return 0;

    const world = this.world;
    const s = world.store;
    const grid = this.grids[viewer as number];
    if (grid === undefined) return 0;

    const n = s.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      const f = s.flags[i];
      const was = (f & EntityFlag.Cloaked) !== 0;

      let hidden: boolean;
      if (world.areAllied(viewer, s.owner[i] as PlayerId)) {
        hidden = false;
      } else if (this.isConcealed(i, viewer)) {
        hidden = true;
      } else {
        const cx = worldToCell(s.posX[i]);
        const cz = worldToCell(s.posZ[i]);
        if (!isInMap(cx, cz)) {
          hidden = true;
        } else {
          const cell = grid[cz * MAP_CELLS + cx];
          hidden = isStaticKind(s.kind[i])
            ? (cell & VIS_EXPLORED) === 0
            : (cell & VIS_VISIBLE) === 0;
        }
      }

      if (hidden === was) continue;
      const k = this.maskedCount++;
      this.maskedIdx[k] = i;
      this.maskedWas[k] = was ? 1 : 0;
      if (hidden) s.flags[i] |= EntityFlag.Cloaked;
      else s.flags[i] &= ~EntityFlag.Cloaked;
    }
    return this.maskedCount;
  }

  /**
   * Put every bit `applyRenderMask` flipped back exactly as it was, so the next
   * simulation step sees pristine, viewer-independent flags. Idempotent.
   */
  clearRenderMask(): void {
    const s = this.world.store;
    for (let k = 0; k < this.maskedCount; k++) {
      const i = this.maskedIdx[k];
      if (this.maskedWas[k] === 1) s.flags[i] |= EntityFlag.Cloaked;
      else s.flags[i] &= ~EntityFlag.Cloaked;
    }
    this.maskedCount = 0;
  }

  /* ------------------------------------------------------------------------ */

  /** Between matches. Grids are cleared; ports are not re-registered here. */
  reset(): void {
    this.clearRenderMask();
    for (let p = 0; p < MAX_PLAYERS; p++) {
      this.grids[p].fill(0);
      this.timers[p].fill(0);
      this.visibleCells[p] = 0;
      this.exploredCells[p] = 0;
      this.version[p]++;
    }
    this.detCount = 0;
    this.radarMask = 0;
    if (!this.on) this.revealAll();
  }

  dispose(): void {
    this.clearRenderMask();
  }
}

/* ==========================================================================
 * 3. HELPERS
 * ========================================================================== */

/**
 * True for the kinds whose position is a property of the MAP rather than of a
 * player's intentions. Only these are remembered through the shroud.
 */
function isStaticKind(kind: number): boolean {
  return kind === EntityKind.Building || kind === EntityKind.Prop || kind === EntityKind.Wreck;
}

/** Metres of map edge, re-exported so the shroud mesh and the minimap agree. */
export const VISION_MAP_METRES = MAP_SIZE;

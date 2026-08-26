/**
 * ============================================================================
 * VOLTMARCH — src/sim/Vision.ts
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
 * ONE VISIBILITY QUESTION WITH THREE ANSWERS — READ THIS BEFORE ADDING A FOURTH
 * -----------------------------------------------------------------------------
 * `visibilityOf(player, id)` (§2.6) is the ONLY place in this codebase that
 * decides how much of an entity a player is entitled to. It returns a
 * `VisionLevel`, and every consumer is a threshold on it:
 *
 *   consumer                        threshold                what it means
 *   ------------------------------  -----------------------  -----------------
 *   Targeting / Combat / AI         === Live                 may ACT on it
 *   RenderBridge (via the mask)     >= Remembered            may DRAW it
 *   input/Selection.canInteractWith >= Remembered            may CLICK it
 *   ui/Minimap blips                >= Remembered            may BLIP it
 *   ui/Overlay health bars          === Live                 may READ its hp
 *
 * This used to be two hand-written predicates — one for "may the sim act",
 * one for "may the screen draw" — that agreed only by parallel construction,
 * with a comment in each pointing at the other. They drifted, and the drift is
 * the reported bug: the renderer drew a scouted Construction Yard from memory,
 * `canSee` answered false for that same yard, and input asked NEITHER, so the
 * player could right-click a shrouded tank that was never on screen at all.
 * A remembered structure is still deliberately DRAWN while `canSee` is false —
 * that part was always right — but the reconciliation is now a value on a
 * ladder instead of a rule each caller re-derives.
 *
 * If you need a new visibility rule, add a rung to `VisionLevel` and teach
 * `levelAt`. Do not write a second predicate.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never touches THREE and never reads the camera. It reads
 * `world.localPlayer` only through `computeRenderMask()`, which is called from
 * the RENDER frame and writes nothing but this module's own array — no
 * simulation column, no entity flag. The deterministic simulation therefore
 * cannot observe a viewer-dependent bit even in principle.
 * ============================================================================
 */

import {
  CELL, MAP_CELLS, MAP_CELL_COUNT, MAP_SIZE, MAX_ENTITIES, MAX_PLAYERS,
  SIM_DT, VISION_TICK_INTERVAL, VISION_REGROW_DELAY,
  FOG_DEFAULT_SIGHT, FOG_MIN_SIGHT, FOG_SIGHT_SCALE, FOG_STRUCTURE_SIGHT_BONUS,
  FOG_RADAR_DETECT_MUL, FOG_CLOAK_REVEAL_SECONDS, FOG_MAX_DETECTORS,
} from '../core/config';
import { EntityFlag, EntityKind, Faction, UpgradeLever, VisionLevel } from '../core/types';
import type { EntityId, PlayerId, IVision } from '../core/types';
import { upgradeMul } from './Upgrades';
import { devAsserts } from '../core/loop';
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
  /** Entities hidden from the local viewer by the last `computeRenderMask`. */
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
  /**
   * Per-player Orbital Scan deadline, centre and radius. See `sweepArea`. Float64
   * for the deadline because it is compared against `world.time`, which is
   * `tick * SIM_DT` and drifts off a float32 well inside one match.
   */
  private readonly sweepUntil = new Float64Array(MAX_PLAYERS);
  private readonly sweepX = new Float64Array(MAX_PLAYERS);
  private readonly sweepZ = new Float64Array(MAX_PLAYERS);
  private readonly sweepRadius = new Float64Array(MAX_PLAYERS);
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

  /* -- render visibility mask ---------------------------------------------- */

  /**
   * Slot -> the pass id at which `computeRenderMask` decided the local view
   * must NOT draw this entity. A slot is hidden iff its entry equals the
   * CURRENT pass, so an entry written for an earlier pass — or for the entity
   * that used to live in a recycled slot — is dead data the next compare
   * discards. See §2.6.
   */
  private readonly hiddenAtPass = new Int32Array(MAX_ENTITIES);
  /**
   * Bumped once per `computeRenderMask`. Starts at 1 so a freshly-zeroed
   * `hiddenAtPass` reads as "draw everything" before the first pass ever runs.
   */
  private renderPass = 1;
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
   * How much of `target` is `player` entitled to. THE predicate — see the file
   * header. Every other visibility question here is a threshold on this.
   */
  visibilityOf(player: PlayerId, target: EntityId): VisionLevel {
    const i = this.world.store.index(target);
    if (i < 0) return VisionLevel.Hidden;
    return this.levelAt(i, player);
  }

  /**
   * The one call targeting, combat and the AI make. An entity is visible to a
   * player when it is allied (you always see your own army), OR it stands on a
   * lit cell and is not concealed by a cloak this player cannot detect.
   *
   * Deliberately NOT true for a remembered structure: a Construction Yard you
   * scouted an hour ago must not be auto-targetable through the shroud. That
   * one is `VisionLevel.Remembered`, and input — which may click it, because it
   * is drawn — asks `visibilityOf` rather than this.
   */
  canSee(player: PlayerId, target: EntityId): boolean {
    return this.visibilityOf(player, target) === VisionLevel.Live;
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
   * True when a player is being shown a STATIC entity (structure, prop, wreck)
   * it has scouted but cannot currently see — the "remembered silhouette", and
   * ONLY that case. False for anything that can move (a tank you saw two
   * minutes ago is not there any more, and drawing it would be a lie the player
   * acts on), and false for something you can see live, which is not a memory.
   */
  isRemembered(player: PlayerId, target: EntityId): boolean {
    return this.visibilityOf(player, target) === VisionLevel.Remembered;
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
        if ((s.flags[i] & EntityFlag.Cloaked) !== 0) {
          if (this.cloakBits.has(s.handleOf(i))) s.flags[i] &= ~EntityFlag.Cloaked;
          else if (devAsserts.enabled) reportStrayCloak(i, s.kind[i], s.owner[i]);
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

    /* -- 2b. Orbital Scan sweeps ----------------------------------------- */
    //
    // Runs AFTER the ordinary stamp and BEFORE the compose, so a swept cell is
    // indistinguishable from one a scout is standing in — same `timers` write,
    // same decay when the window shuts. See `sweepArea` for why this is a
    // per-tick re-stamp rather than a one-shot grid write.
    //
    // The scan reveals the circle the player actually clicked. It does not
    // follow hostile assets or silently redirect itself to an enemy base.
    for (let p = 0; p < np; p++) {
      if (this.sweepUntil[p] <= world.time) continue;
      const seer = world.players[p];
      if (seer === undefined) continue;
      const ally = seer.allyMask ?? (1 << p);
      this.stampCircle(ally, this.sweepX[p], this.sweepZ[p], this.sweepRadius[p], np);
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

    // THE PURCHASED SIGHT MULTIPLIER, read at the instant the circle is sized.
    //
    // Applied to the SCALED radius and before the structure bonus, so an
    // upgrade widens what the unit itself contributes and does not quietly
    // scale a flat constant that has nothing to do with it. `FOG_MIN_SIGHT` is
    // still enforced above on the base, so this can only ever widen.
    let r = base * FOG_SIGHT_SCALE
      * upgradeMul(this.world.players[s.owner[i]], UpgradeLever.Sight, kind as EntityKind);
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

  /**
   * ORBITAL SCAN — light every hostile asset for `seconds`, and keep lighting
   * them as they move.
   *
   * This replaced a one-shot `exploreCircle`, and the reason is worth keeping.
   * `exploreCircle` sets VIS_EXPLORED, which is PERMANENT TERRAIN MEMORY and
   * says nothing about units — so the second cast over the same ground was
   * literally a no-op, and no cast ever showed an enemy. Reported as "orbital
   * scan feels useless after 1 scan", which was not a feeling: it was the
   * mechanic.
   *
   * What this does instead is arm a DEADLINE. `update` re-stamps a circle on
   * every hostile unit and structure on every vision tick until the deadline
   * passes, so the light tracks a moving convoy rather than photographing a
   * patch of dirt. Nothing is written to the grid directly: the stamps go
   * through the same `timers` path unit sight uses, so when the window closes
   * the cells decay through `VISION_REGROW_TICKS` exactly like any other lost
   * vision, and the enemy fades rather than vanishing on a frame boundary.
   *
   * DELIBERATELY NOT A MAP REVEAL. Lighting every cell would set VIS_EXPLORED
   * map-wide on the first cast and hand the terrain half of the power straight
   * back to the one-shot problem above. Empty ground stays dark; scouting keeps
   * its job, and the power is worth calling every time because their army is in
   * a different place every time.
   *
   * Deterministic: the deadline is `world.time`, which is `tick * SIM_DT`, and
   * the power is issued through the command bus so both clients arm it on the
   * same tick. Not persisted across a save — a five-second effect that survived
   * a reload would be stranger than one that did not.
   */
  sweepArea(player: PlayerId, x: number, z: number, seconds: number, radius: number): void {
    const p = player as number;
    if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return;
    if (!(seconds > 0) || !(radius > 0)) return;
    this.sweepUntil[p] = this.world.time + seconds;
    this.sweepX[p] = x;
    this.sweepZ[p] = z;
    this.sweepRadius[p] = radius;
  }

  /** True while `player` has an Orbital Scan sweep still running. */
  isSweeping(player: PlayerId): boolean {
    const p = player as number;
    if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return false;
    return this.sweepUntil[p] > this.world.time;
  }

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
   * 2.6 The render visibility mask — RENDER-OWNED, NOT A SIMULATION FLAG
   *
   * "What may the local player's screen draw" is a viewer-dependent question,
   * and the simulation must never be able to observe the answer. So the answer
   * lives here, in `hiddenAtPass`, and NOTHING in this section writes
   * `store.flags`. `EntityFlag.Cloaked` means real cloaking and only that.
   *
   * WHY THIS CANNOT LATCH, WHICH IS THE ENTIRE POINT
   * -----------------------------------------------
   * The mask this replaced borrowed `EntityFlag.Cloaked`: set it at
   * `RenderPhase.FowUpload`, put it back at `RenderPhase.Present`. Four modules
   * read that bit — the bridge (do not draw), `Targeting` (do not acquire),
   * `Combat` (do not fire) and `Selection` (cannot be clicked) — so ONE missed
   * restore did not merely hide something for a frame. `clearRenderMask`
   * restored by SLOT INDEX with no generation check, so once a restore was
   * skipped, the next frame's restore wrote the dead unit's bit onto whatever
   * had since been allocated into that slot — and `tickCloak` refuses to clear
   * a `Cloaked` bit on an entity that was never handed to `setCloaked`, so it
   * stayed set for the rest of the match. A fresh tank, permanently invisible,
   * unclickable and immune to fire. See tests/vision.spec.ts.
   *
   * There is no restore here, so there is no restore to miss. A hidden entry is
   * only hidden while it carries the CURRENT pass id; every other value in the
   * array — an older pass, or the previous tenant of a recycled slot — reads as
   * "draw it". The failure mode of a mask that stops being recomputed is
   * therefore "the shroud stops hiding things", which is visible in one frame,
   * rather than "a unit silently stops existing", which is visible in forty
   * minutes.
   * ---------------------------------------------------------------------- */

  /**
   * THE PREDICATE. How much of the entity in slot `i` is `viewer` entitled to.
   * Slot-index form because both hot callers already hold an index; the handle
   * form is `visibilityOf`.
   *
   * The rules, in the order they are applied and for the reasons given:
   *
   *   1. YOUR OWN ARMY IS ALWAYS LIVE, cloaked submarines included. Checked
   *      first so nothing below can take your own units off your screen.
   *   2. A CLOAK YOU CANNOT DETECT HIDES EVERYTHING, whether or not fog is
   *      running. A cloak is not a shroud: `?fog=off` exists so the screenshot
   *      harness photographs art instead of a black rectangle, and defeating
   *      stealth is not part of that bargain. This sits ABOVE the fog switch
   *      deliberately — with it below, `canSee` would answer true for a
   *      submarine the renderer refuses to draw, which is the exact
   *      drawn-vs-actionable split this whole change exists to remove.
   *   3. FOG OFF: everything else is live.
   *   4. OFF THE MAP is hidden. A NaN or an out-of-bounds position must fail
   *      closed, not index a typed array out of range.
   *   5. A LIT CELL is live.
   *   6. A STATIC KIND ON AN EXPLORED CELL is remembered — the silhouette.
   *   7. Everything else is hidden.
   */
  private levelAt(i: number, viewer: PlayerId): VisionLevel {
    const s = this.world.store;
    if (this.world.areAllied(viewer, s.owner[i] as PlayerId)) return VisionLevel.Live;
    if (this.isConcealed(i, viewer)) return VisionLevel.Hidden;
    if (!this.on) return VisionLevel.Live;

    // A viewer index past the end of `players` has no grid. It gets the cloak
    // rules and nothing else, rather than a black screen.
    const grid = this.grids[viewer as number];
    if (grid === undefined) return VisionLevel.Live;

    const cx = worldToCell(s.posX[i]);
    const cz = worldToCell(s.posZ[i]);
    if (!isInMap(cx, cz)) return VisionLevel.Hidden;

    const cell = grid[cz * MAP_CELLS + cx];
    if ((cell & VIS_VISIBLE) !== 0) return VisionLevel.Live;
    if (isStaticKind(s.kind[i]) && (cell & VIS_EXPLORED) !== 0) return VisionLevel.Remembered;
    return VisionLevel.Hidden;
  }

  /**
   * Decide, for every alive entity, whether the local view may draw it. Reads
   * simulation state and writes only this module's own array.
   *
   * One rule: an entity is drawn while `levelAt` is at least `Remembered`.
   * That is the SAME call `canSee` and `Selection.canInteractWith` are built
   * on, at a different threshold, which is what makes "drawn" and "clickable"
   * agree by construction rather than by two comments promising they will.
   *
   * Returns the number of entities hidden.
   */
  computeRenderMask(viewer: PlayerId): number {
    // `hiddenAtPass` is an Int32Array, so the pass id has to stay inside int32
    // or a stored value would truncate and stop matching. Wrapping costs one
    // compare per frame and one 16 kB clear roughly every 250 days at 100 fps.
    if (this.renderPass >= 0x7fff_fffe) {
      this.hiddenAtPass.fill(0);
      this.renderPass = 0;
    }
    const pass = ++this.renderPass;
    this.maskedCount = 0;

    const s = this.world.store;
    const n = s.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = s.alive[a];
      if (this.levelAt(i, viewer) !== VisionLevel.Hidden) continue;
      this.hiddenAtPass[i] = pass;
      this.maskedCount++;
    }
    return this.maskedCount;
  }

  /**
   * True when the local view must not draw the entity in store slot `index`.
   * This is the hot query `RenderBridge` makes once per entity per frame, and
   * it is a single typed-array load and compare.
   *
   * A slot nobody has masked since boot reads 0, and `renderPass` starts at 1,
   * so "never masked" is correctly "draw it".
   */
  isRenderHiddenAt(index: number): boolean {
    return this.hiddenAtPass[index] === this.renderPass;
  }

  /** Handle form of `isRenderHiddenAt`, for passes that hold ids. */
  isRenderHidden(id: EntityId): boolean {
    const i = this.world.store.index(id);
    return i >= 0 && this.hiddenAtPass[i] === this.renderPass;
  }

  /**
   * Invalidate the whole mask. Every entity reads as drawable until the next
   * `computeRenderMask`. Called when the module that computes it goes away, so
   * a dead fog module can never leave anything hidden.
   */
  invalidateRenderMask(): void {
    this.renderPass++;
    this.maskedCount = 0;
  }

  /* ------------------------------------------------------------------------ */

  /** Between matches. Grids are cleared; ports are not re-registered here. */
  reset(): void {
    this.invalidateRenderMask();
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
    this.invalidateRenderMask();
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

/**
 * THE LATCH ALARM.
 *
 * `EntityFlag.Cloaked` is read by four modules — the render bridge, `Targeting`,
 * `Combat` and `Selection` — and an entity carrying it is invisible,
 * un-acquirable, un-shootable and un-clickable all at once. Exactly one thing
 * in this codebase is allowed to set it: `tickCloak`, from a `setCloaked`
 * reason recorded in `cloakBits`. A bit with no such reason behind it is
 * therefore corruption by definition, and it is silent corruption: the player
 * finds out because something walked into their base and could not be fought.
 *
 * The render mask used to be that corruption's source (§2.6). It is not any
 * more, so this fires only if some future module starts writing the flag
 * directly — and it fires on the tick it happens, in dev builds, naming the
 * slot, instead of forty minutes into somebody's match.
 *
 * Reported once per slot so a stuck bit cannot spam 30 lines a second.
 */
const strayCloakReported = new Set<number>();
function reportStrayCloak(index: number, kind: number, owner: number): void {
  if (strayCloakReported.has(index)) return;
  strayCloakReported.add(index);
  console.error(
    `[vision] slot ${index} (kind=${kind} owner=${owner}) carries EntityFlag.Cloaked ` +
    'with no cloak reason recorded. It is invisible, untargetable, unshootable and ' +
    'unclickable, and nothing will clear it. Something is writing the flag directly — ' +
    'render visibility belongs in Vision.computeRenderMask, not in store.flags.',
  );
}

/** Metres of map edge, re-exported so the shroud mesh and the minimap agree. */
export const VISION_MAP_METRES = MAP_SIZE;

/**
 * ============================================================================
 * RED ALERT — src/ui/Minimap.ts
 * ============================================================================
 * THE RADAR (VISUAL_DNA §2.5).
 *
 * Non-negotiable #10: the radar keeps its LETTERBOXED map and its 1 px
 * UNFILLED viewport rect. The black field is 142 x 110 design px and the map
 * bitmap is fitted to HEIGHT, so a square 128 x 128 world lands as a 110 x 110
 * square with ~16 px of pure black on each side. That letterbox is part of the
 * sidebar's silhouette — centring or stretching the map to fill the field is
 * one of the fastest ways to make the whole HUD read wrong.
 *
 * WHAT IS DRAWN, IN ORDER
 *   1. terrain, one pixel per world cell, heavily downsampled     (baked)
 *   2. ore                                                        (baked)
 *   3. shroud: pure #000000 over unexplored, 55% over explored-not-visible
 *   4. blips: 2 x 2 crosses, own / enemy / neutral                (per redraw)
 *   5. attack ping rings, 400 ms, faction coloured                (per redraw)
 *   6. the viewport rect: 1 px, unfilled, faction colour          (per redraw)
 *
 * COST MODEL
 * ----------
 * The terrain layer is baked into a 128 x 128 offscreen canvas and only
 * re-baked when the terrain, the ore or the biome changes (and at most every
 * `REBAKE_SECONDS` while ore is being mined). The live layer redraws at
 * MINIMAP_HZ — never per frame. At 20 Hz with 200 entities this is ~4000
 * canvas ops/second, which does not show up in a profile.
 *
 * The viewport rect is derived by unprojecting the four playfield corners onto
 * the ground plane every redraw and then EASED toward that target, because the
 * camera's own smoothing plus a 20 Hz sample makes the raw rect visibly
 * stutter — §2.5 explicitly asks for "smoothly interpolated, no per-frame
 * jitter".
 * ============================================================================
 */

import * as THREE from 'three';

import {
  HUD_MINIMAP_ORE,
  HUD_MINIMAP_SHROUD,
  HUD_MINIMAP_SURFACE,
  HUD_MINIMAP_WATER,
  HUD_RADAR,
  MAP_CELLS,
  MAP_SIZE,
  MINIMAP_HZ,
} from '../core/config';
import { EntityFlag, EntityKind, Faction, type PlayerId } from '../core/types';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import { hexToRgb, skinFor } from './Chrome';

/** Seconds between forced terrain re-bakes while ore is live. */
const REBAKE_SECONDS = 2.0;
/** Exponential ease constant for the viewport rect, per second. */
const RECT_EASE = 14;

/**
 * Per-cell terrain sampler. Injected so the HUD does not hard-depend on the
 * terrain module: without it the radar paints a flat field and everything else
 * (blips, viewport, ping, input) still works.
 */
export interface TerrainSampler {
  /** SurfaceId 0..5 for a cell. */
  surface(cx: number, cz: number): number;
  /** True if the cell is water. */
  water(cx: number, cz: number): boolean;
  /** 0..1 relative height, used for a subtle relief shade. */
  height01(cx: number, cz: number): number;
}

export interface MinimapOptions {
  world: World;
  cameraRig: CameraRig;
  faction: Faction;
  /** Playfield rect in client px — the world view, NOT the window. */
  playfield: () => { x: number; y: number; w: number; h: number };
}

interface Ping {
  x: number;
  z: number;
  age: number;
  hostile: boolean;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly cameraRig: CameraRig;
  private readonly playfield: MinimapOptions['playfield'];

  /** 128 x 128 terrain bake — one pixel per world cell. */
  private readonly bake: HTMLCanvasElement;
  private readonly bakeCtx: CanvasRenderingContext2D;
  private readonly bakeImage: ImageData;

  private terrain: TerrainSampler | null = null;
  private faction: Faction;

  private bakeDirty = true;
  private lastBake = -1e9;
  private lastDraw = -1e9;

  /** Device-pixel size of the black field. */
  private fieldW = 1;
  private fieldH = 1;
  /** Letterboxed map rect inside the field, device px. */
  private mapX = 0;
  private mapY = 0;
  private mapW = 1;
  private mapH = 1;

  /** Eased viewport rect in world metres. */
  private vpMinX = 0;
  private vpMinZ = 0;
  private vpMaxX = MAP_SIZE;
  private vpMaxZ = MAP_SIZE;
  private vpInit = false;

  private readonly pings: Ping[] = [];

  /** Set while the user drags on the radar. */
  private dragging = false;
  private dragPointer = -1;
  private onJump: ((x: number, z: number) => void) | null = null;
  private readonly listeners: Array<[string, EventListener]> = [];

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: MinimapOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('[hud] 2D context unavailable for the radar');
    this.ctx = ctx;

    this.world = opts.world;
    this.cameraRig = opts.cameraRig;
    this.playfield = opts.playfield;
    this.faction = opts.faction;

    this.bake = document.createElement('canvas');
    this.bake.width = MAP_CELLS;
    this.bake.height = MAP_CELLS;
    const bctx = this.bake.getContext('2d', { alpha: false });
    if (!bctx) throw new Error('[hud] 2D context unavailable for the radar bake');
    this.bakeCtx = bctx;
    this.bakeImage = bctx.createImageData(MAP_CELLS, MAP_CELLS);

    this.attachInput();
  }

  /* ------------------------------------------------------------------ */
  /* configuration                                                       */
  /* ------------------------------------------------------------------ */

  setFaction(f: Faction): void {
    this.faction = f;
  }

  setTerrain(sampler: TerrainSampler | null): void {
    this.terrain = sampler;
    this.bakeDirty = true;
  }

  /** Call after a footprint stamp, a biome change or an ore field edit. */
  invalidateTerrain(): void {
    this.bakeDirty = true;
  }

  /** Fired by the HUD on `combat:underAttack`. */
  ping(x: number, z: number, hostile: boolean): void {
    if (this.pings.length >= HUD_RADAR.pingPool) this.pings.shift();
    this.pings.push({ x, z, age: 0, hostile });
  }

  onJumpRequest(fn: (x: number, z: number) => void): void {
    this.onJump = fn;
  }

  /**
   * Resize the backing store to device pixels and recompute the letterbox.
   * Called on every uiScale / DPR change; cheap enough to call on resize.
   */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.fieldW = w;
    this.fieldH = h;

    // FIT TO HEIGHT and letterbox horizontally. The world is square, so this
    // is what produces the reference's 88-of-142 map band.
    const side = Math.min(h, w);
    this.mapW = side;
    this.mapH = side;
    this.mapX = Math.round((w - side) * 0.5);
    this.mapY = Math.round((h - side) * 0.5);
    this.lastDraw = -1e9;
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  frame(time: number, dt: number): void {
    if (this.disposed) return;

    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].age += dt;
      if (this.pings[i].age > HUD_RADAR.pingSeconds) this.pings.splice(i, 1);
    }

    this.easeViewport(dt);

    // Redraw at MINIMAP_HZ, not every frame. A live ping forces the rate up so
    // the 400 ms ring animates smoothly instead of in three steps.
    const period = this.pings.length > 0 ? 1 / 60 : 1 / MINIMAP_HZ;
    if (time - this.lastDraw < period) return;
    this.lastDraw = time;

    if (this.bakeDirty || time - this.lastBake > REBAKE_SECONDS) {
      this.bakeTerrain();
      this.bakeDirty = false;
      this.lastBake = time;
    }

    this.draw();
  }

  /* ------------------------------------------------------------------ */
  /* terrain bake                                                        */
  /* ------------------------------------------------------------------ */

  private bakeTerrain(): void {
    const data = this.bakeImage.data;
    const t = this.terrain;
    const ore = this.world.ore;

    // Pre-resolve the palette once per bake; parseInt per cell would be 16k
    // string parses at 0.5 Hz for nothing.
    const surf: Array<[number, number, number]> = [];
    for (const hex of HUD_MINIMAP_SURFACE) surf.push(hexToRgb(hex));
    const water = hexToRgb(HUD_MINIMAP_WATER);
    const oreRgb = hexToRgb(HUD_MINIMAP_ORE);

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = (cz * MAP_CELLS + cx) * 4;

        let r: number;
        let g: number;
        let b: number;

        if (t === null) {
          [r, g, b] = surf[0];
        } else if (t.water(cx, cz)) {
          [r, g, b] = water;
        } else {
          const id = t.surface(cx, cz);
          [r, g, b] = surf[id >= 0 && id < surf.length ? id : 0];
          // A gentle relief shade so cliffs and ramps read at 1 px per cell.
          // Deliberately shallow: the radar is a map, not a render.
          const shade = 0.82 + 0.30 * t.height01(cx, cz);
          r *= shade;
          g *= shade;
          b *= shade;
        }

        const oreAmount = ore.oreAt(cx, cz);
        if (oreAmount > 0) {
          const k = Math.min(1, oreAmount / 400) * 0.85;
          r += (oreRgb[0] - r) * k;
          g += (oreRgb[1] - g) * k;
          b += (oreRgb[2] - b) * k;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    this.bakeCtx.putImageData(this.bakeImage, 0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* live draw                                                           */
  /* ------------------------------------------------------------------ */

  private draw(): void {
    const ctx = this.ctx;
    const skin = skinFor(this.faction);

    // The letterbox is pure black — law 4, and the silhouette depends on it.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.fieldW, this.fieldH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bake, 0, 0, MAP_CELLS, MAP_CELLS, this.mapX, this.mapY, this.mapW, this.mapH);

    this.drawShroud();
    this.drawBlips(skin.blipOwn, skin.blipEnemy, skin.blipNeutral);
    this.drawPings(skin.blipOwn, skin.blipEnemy);
    this.drawViewport(skin.radarFrame);
  }

  /** Pure black over unexplored; a heavy multiply over explored-not-visible. */
  private drawShroud(): void {
    const grid = this.world.vision.gridFor(this.world.localPlayer);
    if (grid.length !== MAP_CELLS * MAP_CELLS) return;

    const ctx = this.ctx;
    const px = this.mapW / MAP_CELLS;

    // Two passes so each fillStyle is set once instead of 16k times.
    ctx.fillStyle = HUD_MINIMAP_SHROUD;
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      let run = -1;
      for (let cx = 0; cx <= MAP_CELLS; cx++) {
        const dark = cx < MAP_CELLS && (grid[cz * MAP_CELLS + cx] & 0b01) === 0;
        if (dark && run < 0) run = cx;
        else if (!dark && run >= 0) {
          ctx.fillRect(this.mapX + run * px, this.mapY + cz * px, (cx - run) * px + 1, px + 1);
          run = -1;
        }
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      let run = -1;
      for (let cx = 0; cx <= MAP_CELLS; cx++) {
        const v = cx < MAP_CELLS ? grid[cz * MAP_CELLS + cx] : 0;
        const dim = cx < MAP_CELLS && (v & 0b01) !== 0 && (v & 0b10) === 0;
        if (dim && run < 0) run = cx;
        else if (!dim && run >= 0) {
          ctx.fillRect(this.mapX + run * px, this.mapY + cz * px, (cx - run) * px + 1, px + 1);
          run = -1;
        }
      }
    }
  }

  /**
   * 2 x 2 crosses in owner colour. Structures get a slightly fatter mark
   * because a 1-cell blip for a 3x3 Construction Yard is unreadable, but the
   * mark stays a cross — filled squares turn a base into one solid blob.
   */
  private drawBlips(own: string, enemy: string, neutral: string): void {
    const ctx = this.ctx;
    const store = this.world.store;
    const local = this.world.localPlayer;
    const scale = this.mapW / MAP_SIZE;
    const unit = Math.max(2, Math.round(this.mapW / MAP_CELLS) + 1);

    const hasRadar = this.world.vision.hasRadar(local);
    const grid = this.world.vision.gridFor(local);
    const useGrid = grid.length === MAP_CELLS * MAP_CELLS;

    let currentStyle = '';
    for (let i = 0; i < store.aliveCount; i++) {
      const e = store.alive[i];
      const kind = store.kind[e];
      if (kind === EntityKind.Prop || kind === EntityKind.Crate || kind === EntityKind.Wreck) continue;
      const flags = store.flags[e];
      if ((flags & (EntityFlag.PendingDestroy | EntityFlag.Cloaked | EntityFlag.Garrisoned)) !== 0) continue;

      const ownerId = store.owner[e] as PlayerId;
      const mine = ownerId === local || this.world.areAllied(local, ownerId);

      if (!mine) {
        // Enemy blips are gated on radar AND on the shroud, exactly like the
        // original: a radar dome is what turns the map from your base into the
        // battlefield.
        if (!hasRadar) continue;
        if (useGrid) {
          const cx = (store.posX[e] / (MAP_SIZE / MAP_CELLS)) | 0;
          const cz = (store.posZ[e] / (MAP_SIZE / MAP_CELLS)) | 0;
          if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) continue;
          if ((grid[cz * MAP_CELLS + cx] & 0b10) === 0) continue;
        }
      }

      const style = mine
        ? own
        : store.faction[e] === Faction.Neutral
          ? neutral
          : enemy;
      if (style !== currentStyle) {
        ctx.fillStyle = style;
        currentStyle = style;
      }

      const px = this.mapX + store.posX[e] * scale;
      const py = this.mapY + store.posZ[e] * scale;
      const s = kind === EntityKind.Building
        ? unit * Math.max(1, Math.min(3, store.footprintW[e]))
        : unit;
      const h = s * 0.5;
      // The cross: a horizontal and a vertical bar, never a filled square.
      ctx.fillRect(px - h, py - Math.max(0.5, h * 0.34), s, Math.max(1, s * 0.68));
      ctx.fillRect(px - Math.max(0.5, h * 0.34), py - h, Math.max(1, s * 0.68), s);
    }
  }

  /** 400 ms faction-coloured ring on attack alerts. */
  private drawPings(own: string, enemy: string): void {
    if (this.pings.length === 0) return;
    const ctx = this.ctx;
    const scale = this.mapW / MAP_SIZE;
    ctx.save();
    ctx.lineWidth = Math.max(1, this.mapW / 110);
    for (const p of this.pings) {
      const t = p.age / HUD_RADAR.pingSeconds;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.hostile ? enemy : own;
      ctx.beginPath();
      ctx.arc(this.mapX + p.x * scale, this.mapY + p.z * scale, (2 + t * 14) * (this.mapW / 110), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 1 px, unfilled, faction colour. No fill, no corner ticks, no shadow. */
  private drawViewport(color: string): void {
    if (!this.vpInit) return;
    const ctx = this.ctx;
    const scale = this.mapW / MAP_SIZE;
    const x0 = this.mapX + this.vpMinX * scale;
    const y0 = this.mapY + this.vpMinZ * scale;
    const w = (this.vpMaxX - this.vpMinX) * scale;
    const h = (this.vpMaxZ - this.vpMinZ) * scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    // Half-pixel offset so a 1 px stroke lands on one device pixel, not two.
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w), Math.round(h));
  }

  /* ------------------------------------------------------------------ */
  /* viewport tracking                                                   */
  /* ------------------------------------------------------------------ */

  /** Scratch for the corner unprojection. Never allocate in the frame loop. */
  private readonly corner = new THREE.Vector3();

  private easeViewport(dt: number): void {
    const pf = this.playfield();
    if (pf.w <= 0 || pf.h <= 0) return;

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let hits = 0;

    // The four playfield corners. Any corner above the horizon is dropped and
    // the remaining ones still bound the visible ground correctly.
    for (let i = 0; i < 4; i++) {
      const cx = pf.x + (i & 1 ? pf.w : 0);
      const cy = pf.y + (i & 2 ? pf.h : 0);
      if (!this.cameraRig.screenToGround(cx, cy, this.corner)) continue;
      hits++;
      if (this.corner.x < minX) minX = this.corner.x;
      if (this.corner.x > maxX) maxX = this.corner.x;
      if (this.corner.z < minZ) minZ = this.corner.z;
      if (this.corner.z > maxZ) maxZ = this.corner.z;
    }
    if (hits < 2) return;

    minX = Math.max(0, minX);
    minZ = Math.max(0, minZ);
    maxX = Math.min(MAP_SIZE, maxX);
    maxZ = Math.min(MAP_SIZE, maxZ);

    if (!this.vpInit) {
      this.vpMinX = minX; this.vpMinZ = minZ; this.vpMaxX = maxX; this.vpMaxZ = maxZ;
      this.vpInit = true;
      return;
    }
    const k = 1 - Math.exp(-RECT_EASE * dt);
    this.vpMinX += (minX - this.vpMinX) * k;
    this.vpMinZ += (minZ - this.vpMinZ) * k;
    this.vpMaxX += (maxX - this.vpMaxX) * k;
    this.vpMaxZ += (maxZ - this.vpMaxZ) * k;
  }

  /* ------------------------------------------------------------------ */
  /* input: click-to-jump, drag-to-pan                                   */
  /* ------------------------------------------------------------------ */

  private attachInput(): void {
    const down = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragging = true;
      this.dragPointer = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.jumpTo(e.clientX, e.clientY);
    };
    const move = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (!this.dragging || e.pointerId !== this.dragPointer) return;
      e.preventDefault();
      this.jumpTo(e.clientX, e.clientY);
    };
    const up = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.dragPointer) return;
      this.dragging = false;
      this.dragPointer = -1;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    // A context menu on the radar would eat the right-click the game wants.
    const ctxMenu = (ev: Event): void => ev.preventDefault();

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('contextmenu', ctxMenu);
    this.listeners.push(['pointerdown', down], ['pointermove', move], ['pointerup', up],
      ['pointercancel', up], ['contextmenu', ctxMenu]);
  }

  /** Client px -> world metres, clamped to the map, honouring the letterbox. */
  private jumpTo(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // The canvas backing store is device px; the letterbox was computed there.
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const px = (clientX - rect.left) * sx;
    const py = (clientY - rect.top) * sy;

    const u = (px - this.mapX) / this.mapW;
    const v = (py - this.mapY) / this.mapH;
    // Clicking the letterbox is not an error — clamp so a sloppy click at the
    // map's edge still pans there instead of doing nothing.
    const x = Math.min(MAP_SIZE, Math.max(0, u * MAP_SIZE));
    const z = Math.min(MAP_SIZE, Math.max(0, v * MAP_SIZE));

    if (this.onJump) this.onJump(x, z);
    else this.cameraRig.setFocus(x, z, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.pings.length = 0;
  }
}

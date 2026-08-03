/**
 * ============================================================================
 * RED ALERT — src/ui/Overlay.ts
 * ============================================================================
 * IN-WORLD UI (VISUAL_DNA §2.11).
 *
 * THE RULE THAT MATTERS: there are no selection circles, boxes or corner
 * brackets in Red Alert. **Selection is the health bar appearing.** Adding
 * C&C3/RA3-style brackets is an instant, obvious fail (non-negotiable #9), so
 * this file cannot draw one — the only ground affordance it knows how to make
 * is a 1 px faction ellipse at 35% opacity, which is flagged as OUR addition
 * (I15) and can be switched off.
 *
 * WHAT IT DRAWS, back to front
 *   1. selection ground ellipses (new, subtle, ≥1440p by default)
 *   2. target lines — 1 px dotted magenta, attacker -> target
 *   3. health bars: 34 x 4 design px, 1 px light top/bottom rules, a 2 px fill
 *      on a 1-on/1-off vertical hatch, damaged remainder UNLIT (never a second
 *      colour). Buildings get a bar proportional to their pad width.
 *   4. control-group badge — 12 x 14 plate hanging off the bar's LEFT end
 *   5. veterancy chevrons — 8 x 10, faction gold, at the bar's RIGHT end
 *      (NEW, flagged: D10 says this is not in the references)
 *   6. floating damage / credit numbers (pooled)
 *   7. the drag-select marquee
 *
 * WHO DRIVES IT
 * -------------
 * The overlay owns no input and no simulation state. The input module pushes
 * the marquee through `setMarquee`, the HUD pushes floaters through `floater`,
 * and everything else is read straight off the EntityStore each frame. That is
 * why this file can ship before the input module exists.
 *
 * ALLOCATION
 * ----------
 * Zero allocation per frame: the floater pool is fixed, the scratch vectors are
 * fields, and the only strings built are the floater labels, which are cached
 * on the pool entry at spawn time.
 * ============================================================================
 */

import * as THREE from 'three';

import { HUD_OVERLAY } from '../core/config';
import {
  EntityFlag,
  EntityKind,
  Faction,
  UnitState,
  type EntityId,
  type PlayerId,
} from '../core/types';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import { entityWorld } from '../render/RenderBridge';
import { rgba, skinFor } from './Chrome';

/** Health-bar colour ramp. The hatch structure is identical at every step. */
const BAR_GREEN_HI = '#5CB263';
const BAR_GREEN_LO = '#0A5A0C';
const BAR_AMBER_HI = '#D6C24A';
const BAR_AMBER_LO = '#5A4A08';
const BAR_RED_HI = '#D2483C';
const BAR_RED_LO = '#4A0A08';
/** Unlit remainder. Never a second lit colour. */
const BAR_UNLIT = '#141414';
const BAR_RULE = '#DEFBEF';
const TARGET_LINE = '#C060C0';
const CHEVRON_GOLD = '#F8C820';

interface Floater {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  text: string;
  color: string;
  /** Design px of horizontal drift, so two hits on one tank do not stack. */
  drift: number;
}

export interface OverlayOptions {
  world: World;
  cameraRig: CameraRig;
  faction: Faction;
  /** Playfield rect in client px — bars are culled against this, not the window. */
  playfield: () => { x: number; y: number; w: number; h: number };
}

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly cameraRig: CameraRig;
  private readonly playfield: OverlayOptions['playfield'];
  private faction: Faction;

  /** device px per design px. */
  private scale = 1;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;

  /** I15: our own addition, on by default at >= 1440p. */
  selectionEllipses = false;
  /** Health bars for everything the player owns, not just the selection. */
  showAllyBars = false;

  private readonly floaters: Floater[] = [];
  private marqueeActive = false;
  private marquee = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** Wall-clock seconds; drives the chevron shimmer and the floater fade. */
  private time = 0;

  /** entityWorld() output: [x,y,z,yaw,turretYaw,barrelPitch]. */
  private readonly xform = new Float32Array(6);
  private readonly v3 = new THREE.Vector3();
  private readonly v3b = new THREE.Vector3();
  private readonly v2 = new THREE.Vector2();
  private readonly v2b = new THREE.Vector2();

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: OverlayOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[hud] 2D context unavailable for the world overlay');
    this.ctx = ctx;
    this.world = opts.world;
    this.cameraRig = opts.cameraRig;
    this.playfield = opts.playfield;
    this.faction = opts.faction;

    for (let i = 0; i < HUD_OVERLAY.floaterPool; i++) {
      this.floaters.push({ active: false, x: 0, y: 0, z: 0, age: 0, text: '', color: '#fff', drift: 0 });
    }
  }

  setFaction(f: Faction): void {
    this.faction = f;
  }

  resize(cssW: number, cssH: number, dpr: number, uiScale: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.scale = uiScale * dpr;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    // I15 default: subtle, and only where there are pixels to spare for it.
    this.selectionEllipses = cssH >= 1400;
  }

  /* ------------------------------------------------------------------ */
  /* pushed state                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * The drag-select marquee, in client px. The input module owns the gesture;
   * the overlay only owns the pixels. Call `clearMarquee` on pointer-up.
   */
  setMarquee(x0: number, y0: number, x1: number, y1: number): void {
    this.marqueeActive = true;
    this.marquee.x0 = x0;
    this.marquee.y0 = y0;
    this.marquee.x1 = x1;
    this.marquee.y1 = y1;
  }

  clearMarquee(): void {
    this.marqueeActive = false;
  }

  /** Spawn a floating number at a world position. Silently drops when full. */
  floater(x: number, y: number, z: number, text: string, color: string): void {
    for (const f of this.floaters) {
      if (f.active) continue;
      f.active = true;
      f.x = x;
      f.y = y;
      f.z = z;
      f.age = 0;
      f.text = text;
      f.color = color;
      // Deterministic-looking spread without an RNG: hash the position.
      f.drift = (((x * 7.3 + z * 13.1) % 2) - 1) * 9;
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  frame(dt: number): void {
    if (this.disposed) return;
    this.time += dt;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const pf = this.playfield();
    // Bars belong to the WORLD VIEW; one hanging over the sidebar is the tell
    // that the overlay is drawn against the window instead of the playfield.
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();

    if (this.selectionEllipses) this.drawSelectionEllipses();
    this.drawTargetLines();
    this.drawBars();
    this.drawFloaters(dt);
    this.drawMarquee();

    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* pieces                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * I15 — a 1 px faction ground ellipse at 35% opacity. Never a filled disc,
   * never a bracket. Eight segments is enough at this size and keeps the cost
   * at ~8 projections per selected unit.
   */
  private drawSelectionEllipses(): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    const ctx = this.ctx;
    const store = this.world.store;
    const skin = skinFor(this.faction);

    ctx.strokeStyle = rgba(skin.blipOwn, HUD_OVERLAY.ellipseAlpha);
    ctx.lineWidth = 1;

    for (let i = 0; i < sel.count; i++) {
      const idx = store.index(sel.ids[i] as EntityId);
      if (idx < 0) continue;
      const r = Math.max(1.2, store.radius[idx] * 1.35);
      const cx = store.posX[idx];
      const cy = store.posY[idx];
      const cz = store.posZ[idx];

      ctx.beginPath();
      let started = false;
      for (let s = 0; s <= 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        this.v3.set(cx + Math.cos(a) * r, cy + 0.05, cz + Math.sin(a) * r);
        if (!this.cameraRig.worldToScreen(this.v3, this.v2)) { started = false; continue; }
        if (!started) { ctx.moveTo(this.v2.x, this.v2.y); started = true; }
        else ctx.lineTo(this.v2.x, this.v2.y);
      }
      ctx.stroke();
    }
  }

  /** 1 px dotted magenta, 3 px dash period, attacker -> target. */
  private drawTargetLines(): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    const store = this.world.store;
    const ctx = this.ctx;

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = TARGET_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();

    let any = false;
    for (let i = 0; i < sel.count; i++) {
      const idx = store.index(sel.ids[i] as EntityId);
      if (idx < 0) continue;
      if (store.state[idx] !== UnitState.Attacking) continue;
      const tIdx = store.index(store.targetId[idx] as EntityId);
      if (tIdx < 0) continue;

      this.v3.set(store.posX[idx], store.posY[idx] + 1.2, store.posZ[idx]);
      this.v3b.set(store.posX[tIdx], store.posY[tIdx] + 1.2, store.posZ[tIdx]);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) continue;
      if (!this.cameraRig.worldToScreen(this.v3b, this.v2b)) continue;
      ctx.moveTo(this.v2.x, this.v2.y);
      ctx.lineTo(this.v2b.x, this.v2b.y);
      any = true;
    }
    if (any) ctx.stroke();
    ctx.restore();
  }

  /**
   * The health bars. A bar appears when the entity is selected, hovered, or was
   * damaged in the last `damageBarSeconds` — that last case is what makes an
   * attack legible without permanently plastering the frame with bars.
   */
  private drawBars(): void {
    const store = this.world.store;
    const local = this.world.localPlayer;
    const now = this.world.time;

    this.rebuildGroupIndex();

    for (let i = 0; i < store.aliveCount; i++) {
      const e = store.alive[i];
      const kind = store.kind[e];
      if (kind === EntityKind.Prop || kind === EntityKind.Crate || kind === EntityKind.Wreck) continue;

      const flags = store.flags[e];
      if ((flags & (EntityFlag.PendingDestroy | EntityFlag.Cloaked | EntityFlag.Garrisoned)) !== 0) continue;

      const selected = (flags & EntityFlag.Selected) !== 0;
      const hovered = (flags & EntityFlag.Hovered) !== 0;
      const hurt = store.hp[e] < store.maxHp[e] && now - store.lastHitTime[e] < HUD_OVERLAY.damageBarSeconds;
      const owned = (store.owner[e] as PlayerId) === local;
      if (!selected && !hovered && !hurt && !(this.showAllyBars && owned)) continue;

      this.drawOneBar(e, selected);
    }
  }

  private drawOneBar(e: number, selected: boolean): void {
    const store = this.world.store;
    const ctx = this.ctx;

    // Prefer the render bridge's interpolated transform: a bar sampled from the
    // sim position lags the mesh by up to one tick and visibly swims.
    let wx: number;
    let wy: number;
    let wz: number;
    const handle = store.handleOf(e);
    if (entityWorld(handle, this.xform)) {
      wx = this.xform[0]; wy = this.xform[1]; wz = this.xform[2];
    } else {
      wx = store.posX[e]; wy = store.posY[e]; wz = store.posZ[e];
    }

    const top = wy + entityHeight(store.kind[e], store.footprintW[e], store.radius[e]);
    this.v3.set(wx, top, wz);
    if (!this.cameraRig.worldToScreen(this.v3, this.v2)) return;

    const u = this.scale / this.dpr; // design px -> CSS px
    const isBuilding = store.kind[e] === EntityKind.Building;
    const barW = Math.round(
      (isBuilding ? HUD_OVERLAY.barW * (0.9 + 0.45 * store.footprintW[e]) : HUD_OVERLAY.barW) * u,
    );
    const barH = Math.round(HUD_OVERLAY.barH * u);
    const x = Math.round(this.v2.x - barW * 0.5);
    const y = Math.round(this.v2.y - HUD_OVERLAY.barLift * u - barH);

    const frac = store.maxHp[e] > 0 ? Math.max(0, Math.min(1, store.hp[e] / store.maxHp[e])) : 0;

    // 1 px light rules top and bottom, a 2 px fill between them.
    ctx.fillStyle = BAR_RULE;
    ctx.fillRect(x, y, barW, 1);
    ctx.fillRect(x, y + barH - 1, barW, 1);

    const innerY = y + 1;
    const innerH = Math.max(1, barH - 2);
    ctx.fillStyle = BAR_UNLIT;
    ctx.fillRect(x, innerY, barW, innerH);

    const lit = Math.round(barW * frac);
    if (lit > 0) {
      const hi = frac > 0.66 ? BAR_GREEN_HI : frac > 0.33 ? BAR_AMBER_HI : BAR_RED_HI;
      const lo = frac > 0.66 ? BAR_GREEN_LO : frac > 0.33 ? BAR_AMBER_LO : BAR_RED_LO;
      // 1-on / 1-off vertical hatch on a 2 px period. The hatch is what makes a
      // 4 px bar read as a segmented gauge instead of a coloured line.
      const period = Math.max(2, Math.round(HUD_OVERLAY.hatchPeriod * u));
      const half = Math.max(1, period >> 1);
      ctx.fillStyle = lo;
      ctx.fillRect(x, innerY, lit, innerH);
      ctx.fillStyle = hi;
      for (let px = 0; px < lit; px += period) {
        ctx.fillRect(x + px, innerY, Math.min(half, lit - px), innerH);
      }
    }

    // Control-group badge, hanging off the LEFT end, immediately below the bar.
    const group = this.groupOf(store.handleOf(e));
    if (group >= 0) {
      const bw = Math.round(HUD_OVERLAY.badgeW * u);
      const bh = Math.round(HUD_OVERLAY.badgeH * u);
      const bx = x;
      const by = y + barH;
      ctx.fillStyle = '#2B0A08';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#CC716D';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = '#E8B0AE';
      ctx.font = `${Math.round(9 * u)}px ${OVERLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(group), bx + bw * 0.5, by + bh * 0.55);
    }

    // Veterancy chevrons at the RIGHT end. NEW — VISUAL_DNA D10 rules these are
    // not part of the classic layer, so they ship flagged as our addition.
    const flags = store.flags[e];
    const rank = (flags & EntityFlag.Veteran2) !== 0 ? 2 : (flags & EntityFlag.Veteran1) !== 0 ? 1 : 0;
    if (rank > 0) {
      const cw = HUD_OVERLAY.chevronW * u;
      const ch = HUD_OVERLAY.chevronH * u;
      ctx.strokeStyle = CHEVRON_GOLD;
      ctx.lineWidth = Math.max(1, u);
      for (let r = 0; r < rank; r++) {
        const cx = x + barW + cw * 0.35;
        const cy = y + barH * 0.5 + r * ch * 0.5 - (rank - 1) * ch * 0.25;
        ctx.beginPath();
        ctx.moveTo(cx, cy - ch * 0.22);
        ctx.lineTo(cx + cw * 0.5, cy);
        ctx.lineTo(cx, cy + ch * 0.22);
        ctx.stroke();
      }
    }

    void selected;
  }

  /**
   * handle -> Ctrl+N group, rebuilt once per frame.
   *
   * The obvious implementation — scan all ten groups for every bar — is
   * 10 x 100 comparisons per bar, i.e. ~50k per frame in a battle with fifty
   * damaged units on screen. One pass over the groups instead is ~100 map
   * writes total, whether one unit is drawn or two hundred.
   */
  private readonly groupOfHandle = new Map<number, number>();

  private rebuildGroupIndex(): void {
    this.groupOfHandle.clear();
    const sel = this.world.selection;
    for (let g = 0; g < sel.groups.length; g++) {
      const n = sel.groupCounts[g];
      if (n === 0) continue;
      const arr = sel.groups[g];
      for (let i = 0; i < n; i++) this.groupOfHandle.set(arr[i], g);
    }
  }

  /** Which Ctrl+N group a handle belongs to, or -1. */
  private groupOf(handle: EntityId): number {
    const g = this.groupOfHandle.get(handle as number);
    return g === undefined ? -1 : g;
  }

  private drawFloaters(dt: number): void {
    const ctx = this.ctx;
    const u = this.scale / this.dpr;
    let any = false;

    ctx.save();
    ctx.font = `${Math.round(11 * u)}px ${OVERLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(1, u * 0.8);
    ctx.strokeStyle = '#090000';

    for (const f of this.floaters) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= HUD_OVERLAY.floaterSeconds) { f.active = false; continue; }
      any = true;

      const t = f.age / HUD_OVERLAY.floaterSeconds;
      this.v3.set(f.x, f.y, f.z);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) continue;

      // Ease-out rise, linear fade over the last 40% of the life.
      const rise = HUD_OVERLAY.floaterRise * u * (1 - (1 - t) * (1 - t));
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const px = this.v2.x + f.drift * u;
      const py = this.v2.y - rise;
      // Hard outline, same treatment as the cameo name — never a soft shadow.
      ctx.strokeText(f.text, px, py);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, px, py);
    }

    ctx.restore();
    void any;
  }

  /** The drag-select marquee: 1 px faction rim over a 10% faction wash. */
  private drawMarquee(): void {
    if (!this.marqueeActive) return;
    const ctx = this.ctx;
    const skin = skinFor(this.faction);
    const x = Math.min(this.marquee.x0, this.marquee.x1);
    const y = Math.min(this.marquee.y0, this.marquee.y1);
    const w = Math.abs(this.marquee.x1 - this.marquee.x0);
    const h = Math.abs(this.marquee.y1 - this.marquee.y0);
    if (w < 1 || h < 1) return;

    ctx.fillStyle = rgba(skin.blipOwn, 0.10);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = skin.radarFrame;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.floaters) f.active = false;
  }
}

/** Matches the HUD's condensed stack; see the note in hud.css. */
const OVERLAY_FONT = "'Arial Narrow','Roboto Condensed','Liberation Sans Narrow',system-ui,sans-serif";

/**
 * Approximate silhouette height in metres, so a bar sits above the mesh rather
 * than through it. Exact per-model bounds live in the art modules and are not
 * worth a cross-module dependency for a 10 px offset.
 */
function entityHeight(kind: number, footprintW: number, radius: number): number {
  switch (kind) {
    case EntityKind.Infantry: return 2.4;
    case EntityKind.Vehicle: return Math.max(2.6, radius * 1.9);
    case EntityKind.Building: return Math.max(6, 3.6 + footprintW * 2.2);
    default: return Math.max(1.5, radius * 1.6);
  }
}

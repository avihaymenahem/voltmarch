/**
 * ============================================================================
 * src/ui/Overlay.ts — IN-WORLD UI
 * ============================================================================
 * The 2D layer drawn over the battlefield, back to front:
 *
 *   1. selection rings — FLAT ELLIPSES on the ground plane
 *   2. order markers — a pulsing double ring at the ordered point
 *   3. target lines — 1 px dashed, attacker -> target
 *   4. health bars — thin, appearing on damage, hover or selection
 *   5. veterancy chevrons and the control-group badge
 *   6. floating damage / credit numbers (pooled)
 *   7. the drag-select marquee
 *
 * WHY ELLIPSES, NOT CIRCLES
 * -------------------------
 * The camera sits at 39 degrees. A screen-space circle drawn at a unit's feet
 * reads as a sphere floating in front of it; the eye wants the ring to lie ON
 * the ground. So the ring is a world-space circle sampled at 20 points and
 * projected — which produces the correct ellipse for free, keeps working when
 * the camera pitches, and needs no trigonometry here at all.
 *
 * WHO DRIVES IT
 * -------------
 * The overlay owns no input and no simulation state. Input pushes the marquee
 * through `setMarquee`, the HUD pushes floaters and order markers, and
 * everything else is read straight off the EntityStore each frame. That is why
 * this file can run with or without any other module present.
 *
 * ALLOCATION
 * ----------
 * Zero per frame: the floater and marker pools are fixed, scratch vectors are
 * fields, and the only strings built are floater labels, which are cached on
 * the pool entry at spawn.
 * ============================================================================
 */

import * as THREE from 'three';

import { HUD_OVERLAY, ORDER_MARKER_POOL, ORDER_MARKER_SECONDS } from '../core/config';
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
import { SEMANTIC, accentFor, healthColor, rgba } from './Chrome';

/** Unlit remainder of a health bar. Never a second lit colour. */
const BAR_UNLIT = 'rgba(255,255,255,0.22)';
/** Dashed line from a firing unit to what it is shooting. */
const TARGET_LINE = 'rgba(255,77,61,0.55)';
/** Points sampled around a selection ring. 20 is smooth at every zoom. */
const RING_SEGMENTS = 20;

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

/** What an order marker means. Drives its colour, nothing else. */
export type OrderMarkerKind = 'move' | 'attack' | 'special';

interface Marker {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  kind: OrderMarkerKind;
}

export interface OverlayOptions {
  world: World;
  cameraRig: CameraRig;
  faction: Faction;
  /** Playfield rect in client px — bars are clipped to this, not the window. */
  playfield: () => { x: number; y: number; w: number; h: number };
}

export class Overlay {
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly cameraRig: CameraRig;
  private readonly playfield: OverlayOptions['playfield'];
  private accent: string;

  /** device px per design px, and the DPR the canvas is scaled by. */
  private scale = 1;
  private dpr = 1;

  /** Health bars for everything the player owns, not just the selection. */
  showAllyBars = false;
  /** Ground rings under the selection. On by default — this IS the affordance. */
  selectionRings = true;

  private readonly floaters: Floater[] = [];
  private readonly markers: Marker[] = [];
  private marqueeActive = false;
  private readonly marquee = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** Wall-clock seconds; drives the ring pulse and the marker animation. */
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
    if (ctx === null) throw new Error('[hud] 2D context unavailable for the world overlay');
    this.ctx = ctx;
    this.world = opts.world;
    this.cameraRig = opts.cameraRig;
    this.playfield = opts.playfield;
    this.accent = accentFor(opts.faction);

    for (let i = 0; i < HUD_OVERLAY.floaterPool; i++) {
      this.floaters.push({ active: false, x: 0, y: 0, z: 0, age: 0, text: '', color: '#fff', drift: 0 });
    }
    for (let i = 0; i < ORDER_MARKER_POOL; i++) {
      this.markers.push({ active: false, x: 0, y: 0, z: 0, age: 0, kind: 'move' });
    }
  }

  setFaction(f: Faction): void {
    this.accent = accentFor(f);
  }

  resize(cssW: number, cssH: number, dpr: number, uiScale: number): void {
    this.dpr = dpr;
    this.scale = uiScale * dpr;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /* ------------------------------------------------------------------ */
  /* pushed state                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * The drag-select marquee, in client px. Input owns the gesture; the overlay
   * only owns the pixels. Call `clearMarquee` on pointer-up.
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

  /**
   * A pulsing double ring at an ordered point.
   *
   * NOTE FOR INTEGRATORS: `src/input/input.system.ts` draws its own WORLD-SPACE
   * order rings (`FeedbackKind`, `ORDER_MARKER_*`). The HUD therefore leaves
   * this unsubscribed while that module is registered — see `Hud.orderMarkers`
   * — so the player never gets two rings for one click. Whichever layer
   * survives, the constants come from the same config block.
   */
  orderMarker(x: number, y: number, z: number, kind: OrderMarkerKind): void {
    let oldest: Marker | null = null;
    for (const m of this.markers) {
      if (!m.active) { oldest = m; break; }
      if (oldest === null || m.age > oldest.age) oldest = m;
    }
    if (oldest === null) return;
    oldest.active = true;
    oldest.x = x;
    oldest.y = y;
    oldest.z = z;
    oldest.age = 0;
    oldest.kind = kind;
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
    // Bars belong to the WORLD VIEW. One hanging over a dock is the tell that
    // the overlay is drawn against the window instead of the playfield.
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();

    if (this.selectionRings) this.drawSelectionRings();
    this.drawMarkers(dt);
    this.drawTargetLines();
    this.drawBars();
    this.drawFloaters(dt);
    this.drawMarquee();

    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* selection rings                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * A flat ground ellipse under everything selected, plus a dimmer one under
   * whatever the cursor is over. The ring breathes very slightly — 4% of its
   * radius at 0.8 Hz — which is what separates "selected" from "a decal".
   */
  private drawSelectionRings(): void {
    const store = this.world.store;
    const sel = this.world.selection;
    const ctx = this.ctx;
    const u = this.scale / this.dpr;

    const pulse = 1 + 0.04 * Math.sin(this.time * Math.PI * 1.6);

    if (sel.count > 0) {
      // The dark under-stroke FIRST. A cyan hairline on snow, on a white
      // Allied roof or inside a fireball is not a ring, it is a rumour; a
      // wider dark pass beneath it means the ring reads on every surface the
      // grade can produce, and costs one extra stroke per selected unit.
      ctx.lineWidth = Math.max(2, 3.2 * u);
      ctx.strokeStyle = 'rgba(3,6,10,0.62)';
      for (let i = 0; i < sel.count; i++) {
        const idx = store.index(sel.ids[i] as EntityId);
        if (idx < 0) continue;
        this.strokeGroundRing(idx, pulse);
      }
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.strokeStyle = rgba(this.accent, 0.95);
      for (let i = 0; i < sel.count; i++) {
        const idx = store.index(sel.ids[i] as EntityId);
        if (idx < 0) continue;
        this.strokeGroundRing(idx, pulse);
      }
      // A second, wider, very faint ring gives the affordance depth without a
      // glow filter — the canvas has no cheap blur and a shadowBlur here costs
      // more than every other overlay pass combined.
      ctx.lineWidth = Math.max(1, 4 * u);
      ctx.strokeStyle = rgba(this.accent, 0.16);
      for (let i = 0; i < sel.count; i++) {
        const idx = store.index(sel.ids[i] as EntityId);
        if (idx < 0) continue;
        this.strokeGroundRing(idx, pulse);
      }
    }

    // Hover: only when it is not already selected, or the two rings stack and
    // the selected ring appears to thicken for no reason.
    ctx.lineWidth = Math.max(2, 2.6 * u);
    ctx.strokeStyle = 'rgba(3,6,10,0.5)';
    for (let i = 0; i < store.aliveCount; i++) {
      const e = store.alive[i];
      const flags = store.flags[e];
      if ((flags & EntityFlag.Hovered) === 0) continue;
      if ((flags & EntityFlag.Selected) !== 0) continue;
      this.strokeGroundRing(e, 1);
    }
    ctx.lineWidth = Math.max(1, 1.2 * u);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < store.aliveCount; i++) {
      const e = store.alive[i];
      const flags = store.flags[e];
      if ((flags & EntityFlag.Hovered) === 0) continue;
      if ((flags & EntityFlag.Selected) !== 0) continue;
      this.strokeGroundRing(e, 1);
    }
  }

  /** One world-space circle, projected. `k` scales the radius (the pulse). */
  private strokeGroundRing(idx: number, k: number): void {
    const store = this.world.store;
    const ctx = this.ctx;
    const isBuilding = store.kind[idx] === EntityKind.Building;
    const r = (isBuilding
      ? Math.max(2.4, store.footprintW[idx] * 2.4)
      : Math.max(1.1, store.radius[idx] * 1.35)) * k;

    const cx = store.posX[idx];
    const cy = store.posY[idx] + 0.06;
    const cz = store.posZ[idx];

    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= RING_SEGMENTS; s++) {
      const a = (s / RING_SEGMENTS) * Math.PI * 2;
      this.v3.set(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) { started = false; continue; }
      if (!started) { ctx.moveTo(this.v2.x, this.v2.y); started = true; }
      else ctx.lineTo(this.v2.x, this.v2.y);
    }
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /* order markers                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * The double ring: an outer ring that punches out and fades, and an inner
   * ring that contracts into the point. Together they read as "the order landed
   * HERE" rather than "something is glowing over there".
   */
  private drawMarkers(dt: number): void {
    const ctx = this.ctx;
    const u = this.scale / this.dpr;
    let any = false;

    for (const m of this.markers) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= ORDER_MARKER_SECONDS) { m.active = false; continue; }
      any = true;

      const t = m.age / ORDER_MARKER_SECONDS;
      const colour = m.kind === 'attack'
        ? SEMANTIC.danger
        : m.kind === 'special' ? SEMANTIC.gold : this.accent;

      // Ease-out for the outer, ease-in for the inner.
      const outR = 1.1 + 1.5 * (1 - (1 - t) * (1 - t));
      const inR = 1.1 * (1 - t) + 0.25;

      ctx.lineWidth = Math.max(1, 1.6 * u);
      ctx.strokeStyle = rgba(colour, (1 - t) * 0.9);
      this.strokeWorldCircle(m.x, m.y, m.z, outR);
      ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.strokeStyle = rgba(colour, (1 - t) * 0.55);
      this.strokeWorldCircle(m.x, m.y, m.z, inR);
    }
    void any;
  }

  private strokeWorldCircle(cx: number, cy: number, cz: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= RING_SEGMENTS; s++) {
      const a = (s / RING_SEGMENTS) * Math.PI * 2;
      this.v3.set(cx + Math.cos(a) * r, cy + 0.08, cz + Math.sin(a) * r);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) { started = false; continue; }
      if (!started) { ctx.moveTo(this.v2.x, this.v2.y); started = true; }
      else ctx.lineTo(this.v2.x, this.v2.y);
    }
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /* target lines                                                        */
  /* ------------------------------------------------------------------ */

  private drawTargetLines(): void {
    const sel = this.world.selection;
    if (sel.count === 0) return;
    const store = this.world.store;
    const ctx = this.ctx;

    ctx.save();
    ctx.setLineDash([3, 4]);
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

  /* ------------------------------------------------------------------ */
  /* health bars                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * A bar appears when the entity is selected, hovered, or took damage in the
   * last `damageBarSeconds`. That last case is what makes an attack legible
   * without permanently plastering the frame with bars.
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
      const hurt = store.hp[e] < store.maxHp[e]
        && now - store.lastHitTime[e] < HUD_OVERLAY.damageBarSeconds;
      const owned = (store.owner[e] as PlayerId) === local;
      if (!selected && !hovered && !hurt && !(this.showAllyBars && owned)) continue;

      this.drawOneBar(e);
    }
  }

  private drawOneBar(e: number): void {
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
    // THIN. Three design px, no rules, no hatch — the modern bar is a hairline
    // gauge, and its colour is the only thing carrying the reading.
    const barH = Math.max(2, Math.round(3 * u));
    const x = Math.round(this.v2.x - barW * 0.5);
    const y = Math.round(this.v2.y - HUD_OVERLAY.barLift * u - barH);

    const frac = store.maxHp[e] > 0 ? Math.max(0, Math.min(1, store.hp[e] / store.maxHp[e])) : 0;

    // A 2 px opaque plate, not a 1 px translucent one. Over snow or a white
    // structure the old backing let the unlit remainder of the bar wash out
    // completely, so a full bar and an empty one looked the same — the exact
    // reading the bar exists to give.
    const pad = Math.max(2, Math.round(u));
    ctx.fillStyle = SEMANTIC.worldBacking;
    ctx.fillRect(x - pad, y - pad, barW + pad * 2, barH + pad * 2);
    ctx.fillStyle = BAR_UNLIT;
    ctx.fillRect(x, y, barW, barH);

    const lit = Math.round(barW * frac);
    if (lit > 0) {
      ctx.fillStyle = healthColor(frac);
      ctx.fillRect(x, y, lit, barH);
    }

    // Control-group badge, hanging off the LEFT end below the bar.
    const group = this.groupOf(handle);
    if (group >= 0) {
      const bw = Math.round(11 * u);
      const bh = Math.round(11 * u);
      const bx = x;
      const by = y + barH + Math.round(2 * u);
      ctx.fillStyle = 'rgba(4,7,11,0.82)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = rgba(this.accent, 0.75);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = SEMANTIC.text;
      ctx.font = `${Math.round(8 * u)}px ${OVERLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(group), bx + bw * 0.5, by + bh * 0.55);
    }

    // Veterancy chevrons at the RIGHT end, stacked upward.
    const flags = store.flags[e];
    const rank = (flags & EntityFlag.Veteran2) !== 0
      ? 2 : (flags & EntityFlag.Veteran1) !== 0 ? 1 : 0;
    if (rank > 0) {
      const cw = HUD_OVERLAY.chevronW * u;
      const ch = HUD_OVERLAY.chevronH * u * 0.45;
      ctx.fillStyle = SEMANTIC.gold;
      ctx.strokeStyle = 'rgba(3,6,10,0.85)';
      ctx.lineWidth = Math.max(1, u);
      ctx.lineJoin = 'round';
      for (let r = 0; r < rank; r++) {
        const cx = x + barW + cw * 0.55;
        const cy = y + barH * 0.5 - r * (ch + 1);
        ctx.beginPath();
        ctx.moveTo(cx - cw * 0.5, cy + ch * 0.5);
        ctx.lineTo(cx, cy - ch * 0.5);
        ctx.lineTo(cx + cw * 0.5, cy + ch * 0.5);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        // Outline first so the gold is not eaten by its own dark rim.
        ctx.stroke();
        ctx.fill();
      }
    }
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

  private groupOf(handle: EntityId): number {
    const g = this.groupOfHandle.get(handle as number);
    return g === undefined ? -1 : g;
  }

  /* ------------------------------------------------------------------ */
  /* floaters and marquee                                                */
  /* ------------------------------------------------------------------ */

  private drawFloaters(dt: number): void {
    const ctx = this.ctx;
    const u = this.scale / this.dpr;

    ctx.save();
    ctx.font = `600 ${Math.round(11 * u)}px ${OVERLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // Opaque, and wider than it looks like it needs to be. A floating damage
    // number lands on whatever the explosion happens to be painting at that
    // instant, which is routinely a clipped white — a translucent outline is no
    // outline at all there.
    ctx.lineWidth = Math.max(2, u * 2.2);
    ctx.strokeStyle = 'rgba(3,5,9,1)';
    ctx.lineJoin = 'round';

    for (const f of this.floaters) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= HUD_OVERLAY.floaterSeconds) { f.active = false; continue; }

      const t = f.age / HUD_OVERLAY.floaterSeconds;
      this.v3.set(f.x, f.y, f.z);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) continue;

      // Ease-out rise, linear fade over the last 40% of the life.
      const rise = HUD_OVERLAY.floaterRise * u * (1 - (1 - t) * (1 - t));
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const px = this.v2.x + f.drift * u;
      const py = this.v2.y - rise;
      // A hard outline rather than a soft shadow: the HUD has no shadows.
      ctx.strokeText(f.text, px, py);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, px, py);
    }

    ctx.restore();
  }

  /** The drag-select marquee: a 1 px accent rim over a thin accent wash. */
  private drawMarquee(): void {
    if (!this.marqueeActive) return;
    const ctx = this.ctx;
    const x = Math.min(this.marquee.x0, this.marquee.x1);
    const y = Math.min(this.marquee.y0, this.marquee.y1);
    const w = Math.abs(this.marquee.x1 - this.marquee.x0);
    const h = Math.abs(this.marquee.y1 - this.marquee.y0);
    if (w < 1 || h < 1) return;

    ctx.fillStyle = rgba(this.accent, 0.09);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(this.accent, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));

    // Corner ticks. They cost four strokes and they are the difference between
    // a selection box and a browser text-selection rectangle.
    const t = Math.min(10, Math.min(w, h) * 0.3);
    if (t < 3) return;
    ctx.beginPath();
    ctx.moveTo(x, y + t); ctx.lineTo(x, y); ctx.lineTo(x + t, y);
    ctx.moveTo(x + w - t, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + t);
    ctx.moveTo(x + w, y + h - t); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - t, y + h);
    ctx.moveTo(x + t, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - t);
    ctx.lineWidth = Math.max(1, 2 * (this.scale / this.dpr));
    ctx.stroke();
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.floaters) f.active = false;
    for (const m of this.markers) m.active = false;
  }
}

/** Matches the condensed stack index.html sets on `body`. */
const OVERLAY_FONT =
  "'Rajdhani','Oswald','Arial Narrow','Franklin Gothic Medium',system-ui,sans-serif";

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

/**
 * ============================================================================
 * src/ui/Overlay.ts — IN-WORLD UI
 * ============================================================================
 * The 2D layer drawn over the battlefield, back to front:
 *
 *   1. selection rings — FLAT ELLIPSES on the ground plane
 *   2. rally flags and their tethers, for selected factories
 *   3. order markers — a pulsing double ring at the ordered point
 *   4. target lines — 1 px dashed, attacker -> target
 *   5. health bars — thin, appearing on damage, hover or selection
 *   6. veterancy chevrons and the control-group badge
 *   7. floating damage / credit numbers (pooled)
 *   8. the drag-select marquee
 *
 * WHY ELLIPSES, NOT CIRCLES
 * -------------------------
 * The camera sits at 39 degrees. A screen-space circle drawn at a unit's feet
 * reads as a sphere floating in front of it; the eye wants the ring to lie ON
 * the ground. So the ring is a world-space circle sampled at 20 points and
 * projected — which produces the correct ellipse for free, keeps working when
 * the camera pitches, and needs no trigonometry here at all.
 *
 * THE RALLY FLAG, AND WHY IT IS NOT A BILLBOARD
 * ---------------------------------------------
 * Same argument, one axis over. The flag's mast is a WORLD-SPACE vertical
 * segment: both ends are projected, so the mast leans and foreshortens with the
 * camera exactly as a real pole would, and its foot is anchored by a flat
 * ground ellipse of the selection-ring family. Only the pennant is drawn in
 * screen space, sized as a fraction of the projected mast and clamped in design
 * px so it survives a full zoom-out — a pennant hangs in the air, so it is the
 * one part that is allowed to face the camera.
 *
 * The tether from the structure to its flag is sampled along the ground and
 * follows terrain height. That is what keeps it from being confused with an
 * attack line, which is dashed, red, and drawn at chest height in a straight
 * screen-space segment: the tether is a line PAINTED on the map, the attack
 * line is a line drawn THROUGH the air.
 *
 * WHAT IS DRAWN WHEN NO RALLY POINT IS SET — NOTHING
 * --------------------------------------------------
 * `ProductionService.rallyPoint` answers false for a factory that has none, and
 * the honest picture then is an empty one. Read `ProductionService.tryEgress`:
 * with no flag it writes no order columns at all, so the unit is left standing
 * on the egress spot it spawned on — which is under the selection ring already,
 * a metre outside the structure's own door. A flag planted there would promise
 * a destination where there is none. (In practice every factory production
 * finishes gets a `defaultRally` a short walk in front of its door, so the
 * blank case is a scenario-placed or captured structure, and there the blank is
 * the truth.)
 *
 * FOG OF WAR
 * ----------
 * The flag position is the player's own click, so drawing it reveals nothing —
 * this is the same rule the order marker has always followed, which the player
 * may equally plant into shroud. What the flag must NOT do is read the map
 * back: over an unexplored cell its foot is placed at the STRUCTURE's ground
 * height rather than sampled from `terrain.heightAt`, and its tether
 * interpolates instead of hugging, because the elevation of unexplored ground
 * is information the player has not earned. It is drawn dimmed there, which
 * says only what the minimap already says.
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
 * Zero per frame: the floater, marker and rally pools are fixed, scratch
 * vectors are fields, and the only strings built are floater labels, which are
 * cached on the pool entry at spawn. The rally pass caches its `rgba()` strings
 * on the faction change rather than rebuilding them per flag per frame.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  HUD_OVERLAY, MAX_SELECTION, ORDER_MARKER_POOL, ORDER_MARKER_SECONDS,
} from '../core/config';
import { worldToCell } from '../core/math';
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

/* --------------------------------------------------------------------------
 * RALLY FLAGS
 *
 * The link buffer is a flat Float32Array rather than an array of objects so the
 * collector can be a plain function over the World with a caller-supplied
 * output — the same shape every query path in this engine uses, and the reason
 * it is trivially testable with no canvas and no DOM.
 * -------------------------------------------------------------------------- */

/** Floats per rally link: factory xyz, flag xyz, then one of the RALLY_* tags. */
export const RALLY_LINK_STRIDE = 7;
/** This factory has no rally point. The flag slots hold the factory position. */
export const RALLY_NONE = 0;
/** Flag stands on explored ground; its foot height was sampled from terrain. */
export const RALLY_EXPLORED = 1;
/** Flag stands on ground the player has never seen. Height was NOT sampled. */
export const RALLY_UNEXPLORED = 2;

/** Metres of mast. Clears a tank; well short of a structure's roofline. */
const RALLY_MAST_METRES = 3.4;
/** World radius of the flat ellipse at the mast's foot. */
const RALLY_FOOT_METRES = 0.85;
/** Points sampled along a tether, so it creases over terrain instead of cutting it. */
const RALLY_TETHER_SEGMENTS = 12;

/** Tone slots for the cached rally colours. Indices into the ink tables. */
const TONE_FULL = 0;
/** A flag standing on ground the player has never explored. */
const TONE_DIM = 1;
/** A flag that is about to move: it steps back so the preview reads as the outcome. */
const TONE_MUTED = 2;
/** Master opacity of each tone. */
const RALLY_TONES: readonly number[] = [1, 0.42, 0.62];

/**
 * Every selected structure of the local player that owns a rally flag, packed
 * into `out` as `[fx, fy, fz, rx, ry, rz, tag]` per link. Returns the number of
 * links written, capped by `out.length`.
 *
 * A factory with NO rally point is still emitted, tagged `RALLY_NONE` with its
 * flag slots holding the structure's own position: the drawing pass needs the
 * anchor to tether a preview from, and the caller can tell the two apart from
 * the tag alone. Nothing here allocates, and nothing here reads or writes any
 * state another module owns — `PlayerState.rallyX/rallyZ` is core world state,
 * the same map `ProductionService.rallyPoint()` answers out of.
 */
export function collectRallyLinks(world: World, out: Float32Array): number {
  const sel = world.selection;
  if (sel.count === 0) return 0;
  const p = world.players[world.localPlayer as number];
  if (p === undefined) return 0;

  const store = world.store;
  const local = world.localPlayer;
  const cap = Math.floor(out.length / RALLY_LINK_STRIDE);
  let n = 0;

  for (let i = 0; i < sel.count && n < cap; i++) {
    const handle = sel.ids[i] as EntityId;
    const idx = store.index(handle);
    if (idx < 0) continue;
    if ((store.owner[idx] as PlayerId) !== local) continue;
    if (store.kind[idx] !== EntityKind.Building) continue;
    // The SAME test `src/input/input.system.ts` applies before issuing a
    // SetRally. If the two ever disagree the player gets a flag on a structure
    // that will not take one, or none on a structure that would.
    if ((store.flags[idx] & EntityFlag.IsFactory) === 0) continue;
    if ((store.flags[idx] & EntityFlag.PendingDestroy) !== 0) continue;

    const o = n * RALLY_LINK_STRIDE;
    const fx = store.posX[idx];
    const fy = store.posY[idx];
    const fz = store.posZ[idx];
    out[o] = fx;
    out[o + 1] = fy;
    out[o + 2] = fz;
    n++;

    const rx = p.rallyX.get(handle as number);
    const rz = p.rallyZ.get(handle as number);
    if (rx === undefined || rz === undefined) {
      out[o + 3] = fx;
      out[o + 4] = fy;
      out[o + 5] = fz;
      out[o + 6] = RALLY_NONE;
      continue;
    }

    // See the fog note in the file header: an unexplored cell's elevation is
    // not ours to sample, so the flag stands at the structure's own height.
    const seen = world.vision.isExplored(local, worldToCell(rx), worldToCell(rz));
    out[o + 3] = rx;
    out[o + 4] = seen ? world.terrain.heightAt(rx, rz) : fy;
    out[o + 5] = rz;
    out[o + 6] = seen ? RALLY_EXPLORED : RALLY_UNEXPLORED;
  }
  return n;
}

/**
 * True when a plain right-click right now would move a rally flag rather than
 * order a unit.
 *
 * This mirrors case 4 of `resolveContextOrder` in `src/input/Commands.ts` —
 * "no mobile unit selected, at least one factory selected" — rather than asking
 * input, because the overlay has no dependency on input and must keep drawing
 * with that module absent. When input IS present and the player arms the rally
 * cursor explicitly, it pushes `setRallyArmed(true)` instead.
 */
export function rallyClickArmed(world: World): boolean {
  const sel = world.selection;
  if (sel.count === 0) return false;
  const store = world.store;
  const local = world.localPlayer;
  let factories = 0;
  for (let i = 0; i < sel.count; i++) {
    const idx = store.index(sel.ids[i] as EntityId);
    if (idx < 0) continue;
    if ((store.owner[idx] as PlayerId) !== local) continue;
    if (store.kind[idx] === EntityKind.Building) {
      if ((store.flags[idx] & EntityFlag.IsFactory) !== 0) factories++;
      continue;
    }
    // One selected unit that can move takes the right-click back.
    if ((store.flags[idx] & EntityFlag.CanMove) !== 0) return false;
  }
  return factories > 0;
}

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

  /** Rally flags under the selection. On by default — the whole point. */
  rallyFlags = true;

  private readonly floaters: Floater[] = [];
  private readonly markers: Marker[] = [];
  private marqueeActive = false;
  private readonly marquee = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /* -- rally ---------------------------------------------------------- *
   * One pool entry per selectable entity, which is the hard ceiling on how
   * many factories can be selected at once. Never reallocated. */
  private readonly rallyLinks = new Float32Array(MAX_SELECTION * RALLY_LINK_STRIDE);
  /** Cached `rgba()` strings, one per tone. Rebuilt only on a faction change. */
  private readonly inkAccent: string[] = ['', '', ''];
  private readonly inkAccentSoft: string[] = ['', '', ''];
  private readonly inkPennant: string[] = ['', '', ''];
  private readonly inkShadow: string[] = ['', '', ''];
  private readonly inkTether: string[] = ['', '', ''];
  private readonly inkTetherDark: string[] = ['', '', ''];
  /** Pushed by input while the rally cursor is armed. See `setRallyArmed`. */
  private rallyArmed = false;
  /** Last pointer position in CLIENT px, and whether it is over the window. */
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;

  /** Wall-clock seconds; drives the ring pulse and the marker animation. */
  private time = 0;

  /** entityWorld() output: [x,y,z,yaw,turretYaw,barrelPitch]. */
  private readonly xform = new Float32Array(6);
  private readonly v3 = new THREE.Vector3();
  private readonly v3b = new THREE.Vector3();
  private readonly v3c = new THREE.Vector3();
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
    this.rebuildRallyInk();

    // The rally preview needs the cursor, and nothing pushes it to us: input
    // owns the pointer gesture and must keep owning it. A passive window
    // listener reads the position without touching the event, so it cannot
    // affect a drag, a marquee or a click that is already in flight.
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      window.addEventListener('pointerdown', this.onPointerMove, { passive: true });
      window.addEventListener('pointerout', this.onPointerOut, { passive: true });
      window.addEventListener('blur', this.onPointerOut);
    }
  }

  setFaction(f: Faction): void {
    this.accent = accentFor(f);
    this.rebuildRallyInk();
  }

  /**
   * Cache every rally colour once per faction.
   *
   * `rgba()` builds a string and an array on every call, and the rally pass
   * would want five of them per flag per frame. Three tones x five roles is
   * fifteen strings for the life of a match instead.
   */
  private rebuildRallyInk(): void {
    for (let t = 0; t < RALLY_TONES.length; t++) {
      const a = RALLY_TONES[t];
      this.inkAccent[t] = rgba(this.accent, 0.95 * a);
      this.inkAccentSoft[t] = rgba(this.accent, 0.5 * a);
      this.inkPennant[t] = rgba(this.accent, 0.34 * a);
      this.inkShadow[t] = `rgba(3,6,10,${(0.62 * a).toFixed(3)})`;
      // Quieter than anything else the overlay strokes — the tether is a hint
      // about pairing, not a second attack line — but it still gets the dark
      // under-pass, because a 30% hairline over lit concrete is not a subtle
      // line, it is an invisible one. Measured on `shot=allied-base`: without
      // the dark pass the tether could not be traced at all.
      this.inkTether[t] = rgba(this.accent, 0.5 * a);
      this.inkTetherDark[t] = `rgba(3,6,10,${(0.45 * a).toFixed(3)})`;
    }
  }

  private readonly onPointerMove = (ev: PointerEvent): void => {
    this.pointerX = ev.clientX;
    this.pointerY = ev.clientY;
    this.pointerInside = true;
  };

  private readonly onPointerOut = (ev: Event): void => {
    // Only the pointer leaving the WINDOW clears the preview. `pointerout` also
    // fires for every element boundary crossed inside the page, and treating
    // those as a leave would strobe the ghost flag on and off across the HUD.
    if (ev.type === 'pointerout' && (ev as PointerEvent).relatedTarget !== null) return;
    this.pointerInside = false;
  };

  /**
   * Pushed by `src/input` while the rally cursor is armed (`ord.rally`), so the
   * ghost flag appears for a mixed selection too — the overlay can only infer
   * the CONTEXTUAL rally, which is the all-structures right-click.
   *
   * Safe to never call: the contextual case still previews without it.
   */
  setRallyArmed(on: boolean): void {
    this.rallyArmed = on;
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
    // Under the order markers: a fresh SetRally pulse has to land ON the flag it
    // just planted, which is the whole acknowledgement.
    if (this.rallyFlags) this.drawRallyFlags();
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
  /* rally flags                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * One flag per selected factory, each tethered to the structure it belongs
   * to. Nothing is drawn for an unselected factory — a map permanently studded
   * with flags is noise, and the flag exists to answer a question the player
   * asked by clicking the building.
   */
  private drawRallyFlags(): void {
    const links = this.rallyLinks;
    const n = collectRallyLinks(this.world, links);
    if (n === 0) return;

    const ctx = this.ctx;
    const u = this.scale / this.dpr;
    const preview = this.rallyPreviewPoint();
    // While a click is pending, the flags that are about to MOVE step back so
    // the ghost reads as the outcome rather than as one more flag.
    const tone = preview ? TONE_MUTED : TONE_FULL;

    /* -- tethers, beneath everything, dark pass then accent ----------- */
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass === 0 ? Math.max(2, 2.4 * u) : Math.max(1, 1.2 * u);
      ctx.strokeStyle = pass === 0 ? this.inkTetherDark[tone] : this.inkTether[tone];
      for (let i = 0; i < n; i++) {
        const o = i * RALLY_LINK_STRIDE;
        if (preview) {
          this.strokeGroundTether(
            links[o], links[o + 1], links[o + 2],
            this.v3c.x, this.v3c.y, this.v3c.z, true,
          );
        } else if (links[o + 6] !== RALLY_NONE) {
          this.strokeGroundTether(
            links[o], links[o + 1], links[o + 2],
            links[o + 3], links[o + 4], links[o + 5],
            links[o + 6] === RALLY_EXPLORED,
          );
        }
      }
    }

    /* -- the flags themselves ----------------------------------------- */
    for (let i = 0; i < n; i++) {
      const o = i * RALLY_LINK_STRIDE;
      const tag = links[o + 6];
      if (tag === RALLY_NONE) continue;
      this.strokeRallyFlag(
        links[o + 3], links[o + 4], links[o + 5],
        preview ? TONE_MUTED : tag === RALLY_UNEXPLORED ? TONE_DIM : TONE_FULL,
      );
    }

    /* -- and the one under the cursor --------------------------------- */
    if (preview) this.strokeRallyFlag(this.v3c.x, this.v3c.y, this.v3c.z, TONE_FULL);
    ctx.restore();
  }

  /**
   * Ground point under the cursor when a click would move a rally flag, left in
   * `v3c`. False when no rally is pending, so the caller can skip the ghost.
   */
  private rallyPreviewPoint(): boolean {
    if (!this.pointerInside) return false;
    if (!this.rallyArmed && !rallyClickArmed(this.world)) return false;
    const pf = this.playfield();
    // The cursor over the sidebar is not aiming at the map.
    if (this.pointerX < pf.x || this.pointerX > pf.x + pf.w) return false;
    if (this.pointerY < pf.y || this.pointerY > pf.y + pf.h) return false;
    return this.cameraRig.screenToGround(this.pointerX, this.pointerY, this.v3c);
  }

  /**
   * The structure-to-flag line, sampled along the ground.
   *
   * `hug` false interpolates height instead of sampling terrain — see the fog
   * note in the header; it is the unexplored-destination case.
   */
  private strokeGroundTether(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    hug: boolean,
  ): void {
    const ctx = this.ctx;
    const terrain = this.world.terrain;
    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= RALLY_TETHER_SEGMENTS; s++) {
      const t = s / RALLY_TETHER_SEGMENTS;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const lerp = ay + (by - ay) * t;
      // Max, not the sample alone: near the structure the ground is under the
      // footprint slab and a pure sample would tunnel the line into it.
      const y = (hug ? Math.max(lerp, terrain.heightAt(x, z)) : lerp) + 0.07;
      this.v3.set(x, y, z);
      if (!this.cameraRig.worldToScreen(this.v3, this.v2)) { started = false; continue; }
      if (!started) { ctx.moveTo(this.v2.x, this.v2.y); started = true; }
      else ctx.lineTo(this.v2.x, this.v2.y);
    }
    ctx.stroke();
  }

  /**
   * A mast standing on the ground with a pennant at its head, plus the flat
   * foot ellipse that plants it. `tone` indexes the cached ink tables.
   */
  private strokeRallyFlag(x: number, y: number, z: number, tone: number): void {
    const ctx = this.ctx;
    const u = this.scale / this.dpr;

    // Both ends of the mast are WORLD points, so the pole foreshortens with the
    // camera instead of standing bolt upright on screen at every pitch.
    this.v3.set(x, y + 0.06, z);
    if (!this.cameraRig.worldToScreen(this.v3, this.v2)) return;
    this.v3b.set(x, y + RALLY_MAST_METRES, z);
    if (!this.cameraRig.worldToScreen(this.v3b, this.v2b)) return;
    const footX = this.v2.x;
    const footY = this.v2.y;
    const headX = this.v2b.x;
    const headY = this.v2b.y;

    // The pennant scales with the projected mast so it stays in proportion as
    // the camera dollies, and clamps so it neither vanishes at full zoom-out
    // nor becomes a banner across the base at full zoom-in.
    const mast = Math.hypot(headX - footX, headY - footY);
    const pw = Math.min(Math.max(mast * 0.44, 6 * u), 20 * u);
    const ph = pw * 0.72;

    // Foot ellipse first, under the pole. Same family as the selection ring,
    // which is what tells the eye the flag is ON the ground.
    ctx.lineWidth = Math.max(2, 2.6 * u);
    ctx.strokeStyle = this.inkShadow[tone];
    this.strokeWorldCircle(x, y, z, RALLY_FOOT_METRES);
    ctx.lineWidth = Math.max(1, 1.2 * u);
    ctx.strokeStyle = this.inkAccentSoft[tone];
    this.strokeWorldCircle(x, y, z, RALLY_FOOT_METRES);

    // Dark pass beneath the accent, for the same reason the selection ring has
    // one: an accent hairline on snow or inside a fireball is a rumour.
    ctx.lineWidth = Math.max(2, 3.2 * u);
    ctx.strokeStyle = this.inkShadow[tone];
    this.rallyPath(footX, footY, headX, headY, pw, ph);
    ctx.stroke();

    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.strokeStyle = this.inkAccent[tone];
    this.rallyPath(footX, footY, headX, headY, pw, ph);
    ctx.stroke();

    // The pennant is the only fill in the whole marker, and it is kept under a
    // third so the flag still reads as a line drawing.
    ctx.beginPath();
    this.pennantSubPath(headX, headY, pw, ph);
    ctx.fillStyle = this.inkPennant[tone];
    ctx.fill();
  }

  /** Mast plus pennant outline, as one path ready to stroke. */
  private rallyPath(
    footX: number, footY: number, headX: number, headY: number, pw: number, ph: number,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(footX, footY);
    ctx.lineTo(headX, headY);
    this.pennantSubPath(headX, headY, pw, ph);
  }

  /**
   * A swallowtail pennant hanging off the mast head: out to the upper tip, back
   * into the notch, out to the lower tip, home. Five points, no curves — the
   * notch is what stops it reading as a play button.
   */
  private pennantSubPath(headX: number, headY: number, pw: number, ph: number): void {
    const ctx = this.ctx;
    ctx.moveTo(headX, headY);
    ctx.lineTo(headX + pw, headY + ph * 0.3);
    ctx.lineTo(headX + pw * 0.68, headY + ph * 0.55);
    ctx.lineTo(headX + pw, headY + ph * 0.8);
    ctx.lineTo(headX, headY + ph * 1.05);
    ctx.closePath();
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerdown', this.onPointerMove);
      window.removeEventListener('pointerout', this.onPointerOut);
      window.removeEventListener('blur', this.onPointerOut);
    }
    this.pointerInside = false;
    this.rallyArmed = false;
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

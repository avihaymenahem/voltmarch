/**
 * ============================================================================
 * VOLTMARCH — src/input/input.system.ts
 * ============================================================================
 * THE MODULE. Wires the raw event layer to the selection and the command
 * funnel, drives the camera rig, and draws the one piece of world-space
 * feedback nobody else owns: an ORDER MARKER that punches out and fades at the
 * point of every order — green for move, red for attack, amber for everything
 * else. One InstancedMesh, one draw call, zero allocation per frame.
 *
 * The selection affordance itself belongs to `src/ui/Overlay.ts` (see §3), and
 * the marquee pixels are handed to that same canvas.
 *
 * EVERY HIT-TEST IN THIS FILE GOES THROUGH THE FOG
 * ------------------------------------------------
 * There are exactly four of them — the click, the double-click, the sloppy-drag
 * click and `refreshResolution`'s hover — and all four call `pickEntity`, which
 * refuses to return an entity the local player cannot see (`canInteractWith` in
 * Selection.ts). The marquee goes through `selectInRect`, which filters the same
 * way. So there is no fifth path, and adding one means adding the gate with it.
 *
 * WHY THAT GATE CANNOT LIVE HERE, IN THE FRAME HOOK
 * -------------------------------------------------
 * This module's `frame()` runs at `RenderPhase.Overlay` (70), and the render
 * mask is computed at `RenderPhase.FowUpload` (20) — so a gate that read
 * per-frame mask state would be correct here and nowhere else. Our handlers are
 * DOM callbacks: a click lands BETWEEN frames. That is the whole shape of the
 * reported bug in its original form, when the mask worked by borrowing
 * `EntityFlag.Cloaked` and handing it back at `RenderPhase.Present` — the hover
 * computed during the frame was masked, the hover recomputed on `pointermove`
 * was not, and the click that followed hit-tested raw positions. The cursor and
 * the click genuinely disagreed, which is why it read as intermittent.
 *
 * `Selection.canInteractWith` asks `IVision.visibilityOf` instead. That is a
 * pure query over the vision grid with no per-frame state at all, so it gives
 * the same answer inside a frame, between two frames, and from a DOM callback
 * that fired while the tab was throttled.
 *
 * WHY THIS MODULE TAKES THE CAMERA'S KEYBOARD
 * -------------------------------------------
 * `src/render/camera.ts` ships its own WASD pan, which collides head-on with
 * the classic C&C hotkeys the brief requires: A is attack-move, S is stop, D
 * and W are free for later. camera.ts anticipates this in its own header —
 * "InputModule may call detachInput() and drive the rig purely through its
 * programmatic API" — so that is exactly what we do. We then re-implement the
 * four camera inputs faithfully, on ARROW KEYS instead of WASD:
 *
 *     arrows      ground pan, speed scaled by zoom, frame-rate independent
 *     Q / E       yaw
 *     screen edge pan, same basis, same scaling
 *     middle drag world-grab: the ground point under the cursor stays pinned
 *     wheel       dolly, pulling the point under the cursor toward the centre
 *
 * Every one of them reads `RENDER_CONFIG.camera`, so a live config edit still
 * reaches the camera through us.
 *
 * PHASE PLACEMENT
 * ---------------
 * `Phase.Command` with `order: 9000` puts the fallback order executor LAST in
 * the phase. When a real Command-phase orders module lands it will sit at the
 * default order 0, drain the bus first, and find nothing left for us to do —
 * and it should also call `setOrderExecutionEnabled(false)` to make that
 * explicit. `RenderPhase.Overlay` (70) puts the markers after terrain (10) and
 * the render bridge (30), and one order behind sim/production's placement
 * ghost, which shares the phase.
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import {
  EntityFlag, EntityKind, NONE, OrderKind, Phase, RenderPhase, Stance, UnitState,
} from '../core/types';
import type { DefTables, EntityId, RenderContext } from '../core/types';
import {
  CAMERA_NAV,
  GROUP_DOUBLE_TAP_MS, MAX_SELECTION, ORDER_ATTACK_COLOR, ORDER_MARKER_POOL,
  ORDER_MARKER_POP, ORDER_MARKER_RADIUS, ORDER_MARKER_SECONDS, ORDER_MOVE_COLOR,
  ORDER_SPECIAL_COLOR, OVERLAY_LIFT,
} from '../core/config';
import { clampWorld, DEG2RAD } from '../core/math';
import { ctx } from '../game/context';
import { RENDER_CONFIG } from '../render/renderer';
import type { CameraPose } from '../render/camera';
import { LAYERS, RENDER_ORDER } from '../render/scene';
import { resolveDefBinding } from '../game/Scenarios';

import {
  CursorKind, InputManager, MouseButton,
  type DragInfo, type KeyInfo, type PointerInfo,
} from './Input';
import {
  Selection, SelectMode, canInteractWith, pickEntity, pickStructureToolTarget,
  type ScreenProjector,
} from './Selection';
import {
  CommandMode, FeedbackKind, OrderExecutor, createCapabilities, feedbackFor,
  gatherDeployable, gatherLoadedTransports, gatherOccupiedGarrisons,
  deadClickReason, deadClickText,
  garrisonRefusalText, issueOrder, makeDefRoleResolver, planScatter,
  readCapabilities, resolveContextOrder, setRoleResolver,
  type OrderResolution, type SelectionCapabilities,
} from './Commands';
import { isDeployable } from '../sim/Deploy';
import { abilities } from '../sim/Abilities';
import { notifyTutorialAction } from '../core/tutorial';
import {
  CAMERA_KEY_IDS, COMMAND_ACTION_IDS, defaultCameraCodes, defaultCommandChords,
  type ActionChord,
} from './ActionCatalogue';
import { planFormation, type FormationShape } from './Formations';

/* ==========================================================================
 * 1. MODULE STATE
 * ========================================================================== */

let input: InputManager | null = null;
let selection: Selection | null = null;
let executor: OrderExecutor | null = null;
let overlay: Overlay | null = null;
let projector: RigProjector | null = null;

/** Four classic RTS camera slots, F5-F8. Match-local by design. */
const cameraBookmarks: Array<CameraPose | null> = [null, null, null, null];
/** Last idle miner selected, so the next press advances instead of sticking. */
let lastIdleHarvester: EntityId = NONE;

/** The armed mode. Cleared by Escape, by a right-click, or by using it. */
let mode: CommandMode = CommandMode.None;

type HudCommandAction = 'move' | 'attack' | 'guard' | 'stop' | 'scatter';

function commandActionFor(modeValue: CommandMode): HudCommandAction | 'none' {
  if (modeValue === CommandMode.Move) return 'move';
  if (modeValue === CommandMode.AttackMove) return 'attack';
  return 'none';
}

/** One writer for modal command state, so the cursor and command deck agree. */
function setCommandMode(modeValue: CommandMode): void {
  mode = modeValue;
  hud()?.setCommandMode?.(commandActionFor(modeValue));
}

function invokeHudCommand(action: HudCommandAction): boolean {
  if (selection === null || input === null) return false;
  refreshResolution();
  switch (action) {
    case 'move':
      setCommandMode(caps.mobileCount > 0 ? CommandMode.Move : CommandMode.None);
      return true;
    case 'attack':
      setCommandMode(caps.mobileCount > 0 ? CommandMode.AttackMove : CommandMode.None);
      return true;
    case 'guard':
      setCommandMode(CommandMode.None);
      issueImmediate(OrderKind.Guard);
      return true;
    case 'stop':
      setCommandMode(CommandMode.None);
      issueImmediate(OrderKind.Stop);
      return true;
    case 'scatter':
      setCommandMode(CommandMode.None);
      issueImmediate(OrderKind.Scatter);
      return true;
  }
}

/** Put the current mobile selection into a deliberate, replay-safe shape. */
function invokeHudFormation(shape: FormationShape): boolean {
  if (selection === null || input === null) return false;
  const { world, channels } = ctx();
  const n = gatherOwnOrderable(true);
  if (n < 2) {
    hud()?.toast?.('info', 'formation:selection', 'Formation needs a group', 'Select at least two mobile units');
    return n === 1;
  }

  // Stable handle order: the visible result cannot depend on whether these
  // units entered the local selection through a drag or a control group.
  for (let i = 1; i < n; i++) {
    const v = ORDER_IDS[i];
    let j = i - 1;
    while (j >= 0 && ORDER_IDS[j] > v) { ORDER_IDS[j + 1] = ORDER_IDS[j]; j--; }
    ORDER_IDS[j + 1] = v;
  }
  const dest = planFormation(world.store, ORDER_IDS, n, shape);
  for (let i = 0; i < n; i++) {
    ONE_ID[0] = ORDER_IDS[i];
    issueOrder(
      world, channels, world.localPlayer, OrderKind.Move, ONE_ID, 1,
      dest[i * 2], dest[i * 2 + 1], NONE, false,
    );
  }
  feedback(OrderKind.Move, dest[0], dest[1]);
  notifyTutorialAction('formation-use');
  return true;
}

const HUD_COMMAND_SERVICE = {
  invoke: invokeHudCommand,
  formation: invokeHudFormation,
  cancel: cancelBattlefieldMode,
};

/** Last digit pressed and when, for the double-tap-to-centre rule. */
let lastGroupKey = -1;
let lastGroupTime = -1e9;

const caps: SelectionCapabilities = createCapabilities();
const resolution: OrderResolution = {
  order: OrderKind.None, target: NONE, x: 0, z: 0,
  cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
};

/* -- scratch, allocated once ---------------------------------------------- */
const V2 = new Float32Array(2);
const V3 = new Float32Array(3);
const EDGE = new Float32Array(2);
/** Own, orderable entities distilled out of the selection. */
const ORDER_IDS = new Int32Array(MAX_SELECTION);
/** Own construction vehicles distilled out of the selection. */
const DEPLOY_IDS = new Int32Array(MAX_SELECTION);
/** One-entity window, so a per-unit order never allocates a subarray. */
const ONE_ID = new Int32Array(1);
/** Ground anchor for the middle-button world grab. */
const PAN_ANCHOR = new Float32Array(3);
let panning = false;

/** Modifier snapshot handed to the resolver. Reused. */
const MODS = { shift: false, ctrl: false, alt: false };

/** Scratch vector for the ground-pick adapter handed to InputManager. */
const SCRATCH_V = new THREE.Vector3();

/** Unsubscribe for the entity:killed listener. Cleared on dispose. */
let unsubscribeKilled: (() => void) | null = null;

/* ==========================================================================
 * 2. THE PROJECTOR
 *
 * Wraps CameraRig so Selection never imports THREE or the render layer.
 * ========================================================================== */

class RigProjector implements ScreenProjector {
  private readonly v = new THREE.Vector3();
  private readonly p = new THREE.Vector2();

  constructor(private readonly rig: { camera: THREE.Camera; worldToScreen(v: THREE.Vector3, out: THREE.Vector2): boolean }, private readonly element: HTMLElement) {}

  project(x: number, y: number, z: number, out: Float32Array): boolean {
    this.v.set(x, y, z);
    const inFront = this.rig.worldToScreen(this.v, this.p);
    out[0] = this.p.x;
    out[1] = this.p.y;
    return inFront;
  }

  viewport(out: Float32Array): void {
    const r = this.element.getBoundingClientRect();
    out[0] = r.left;
    out[1] = r.top;
    out[2] = r.width;
    out[3] = r.height;
  }
}

/* ==========================================================================
 * 3. ORDER FEEDBACK
 *
 * One InstancedMesh of ground markers, additive so they glow against the
 * median-0.32 frame the bible demands rather than washing it out. Green for a
 * move, red for an attack, amber for everything else; punch out, hold, fade.
 *
 * WHAT IS DELIBERATELY NOT HERE: selection brackets. `src/ui/Overlay.ts` owns
 * the in-world selection affordance and its header cites VISUAL_DNA
 * non-negotiable #9 — "selection is the health bar appearing", no circles, no
 * corner brackets, with an optional 1-px faction ground ellipse as OUR flagged
 * addition. Drawing a second, competing indicator here would be a scored fail
 * and a duplicate draw call. We own the GESTURE and the CURSOR; they own the
 * pixels that say "this one is selected".
 * ========================================================================== */

/** A live order marker. The pool is fixed; the oldest slot is recycled. */
interface Marker {
  x: number;
  y: number;
  z: number;
  age: number;
  kind: FeedbackKind;
  active: boolean;
}

class Overlay {
  readonly markers: THREE.InstancedMesh;

  private readonly pool: Marker[] = [];
  private nextMarker = 0;

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();

  private readonly colMove = new THREE.Color().setStyle(ORDER_MOVE_COLOR);
  private readonly colAttack = new THREE.Color().setStyle(ORDER_ATTACK_COLOR);
  private readonly colSpecial = new THREE.Color().setStyle(ORDER_SPECIAL_COLOR);

  constructor(scene: THREE.Scene) {
    const mesh = new THREE.InstancedMesh(buildMarkerGeometry(), overlayMaterial(), ORDER_MARKER_POOL);
    this.markers = mesh;

    mesh.name = 'OrderMarkers';
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // One mesh; culling it would save nothing and would need a bounding-volume
    // refit every frame.
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER.OVERLAY;
    mesh.layers.set(LAYERS.OVERLAY);
    mesh.layers.enable(LAYERS.DEFAULT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    for (let i = 0; i < ORDER_MARKER_POOL; i++) {
      this.pool.push({ x: 0, y: 0, z: 0, age: 0, kind: FeedbackKind.Move, active: false });
    }
  }

  /** Drop a marker at a ground position. Oldest slot wins when the pool is full. */
  spawn(kind: FeedbackKind, x: number, y: number, z: number): void {
    const m = this.pool[this.nextMarker];
    this.nextMarker = (this.nextMarker + 1) % ORDER_MARKER_POOL;
    m.x = x;
    m.y = y;
    m.z = z;
    m.age = 0;
    m.kind = kind;
    m.active = true;
  }

  /** Age and rebuild the order markers. */
  updateMarkers(dt: number): void {
    const mesh = this.markers;
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i];
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= ORDER_MARKER_SECONDS) {
        m.active = false;
        continue;
      }
      const t = m.age / ORDER_MARKER_SECONDS;
      // Punch out fast, settle, fade. `1 - (1-t)^3` is the ease-out that makes
      // the pop read as an impact rather than a balloon.
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = ORDER_MARKER_RADIUS * (ORDER_MARKER_POP - (ORDER_MARKER_POP - 1) * ease);
      // Hold full brightness for the first third, then fall off.
      const fade = t < 0.33 ? 1 : 1 - (t - 0.33) / 0.67;

      this.pos.set(m.x, m.y + OVERLAY_LIFT * 1.5, m.z);
      this.scale.set(radius, 1, radius);
      // Attack markers ride at 45 degrees so they read differently from a move
      // marker even for a colour-blind player.
      this.quat.setFromAxisAngle(this.axisY, m.kind === FeedbackKind.Attack ? Math.PI * 0.25 : 0);
      this.m.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(n, this.m);

      const base = m.kind === FeedbackKind.Attack
        ? this.colAttack
        : m.kind === FeedbackKind.Move ? this.colMove : this.colSpecial;
      this.color.copy(base).multiplyScalar(fade * fade);
      mesh.setColorAt(n, this.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    const mesh = this.markers;
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  }
}

function overlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    // Additive: the accents SCREAM against a median-0.32 frame, and a fade to
    // black is a fade to invisible, which is what lets one material animate
    // opacity per instance through the colour channel alone.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    // DOUBLE-SIDED **AND** TRANSPARENT IS A TWO-DRAW MATERIAL IN THREE, and the
    // second draw is not the expensive part. `WebGLRenderer` submits the mesh
    // twice (back faces, then front) and sets `material.needsUpdate = true`
    // before each submission; that bumps `material.version`, so `setProgram`'s
    // cache check misses on EVERY frame and `getProgramCacheKey` runs its
    // `const array = []` / `array.join()` — a fresh array and a fresh string,
    // twice a frame, in the render path. `mesh.count === 0` pays it too: the
    // early-out for an empty instanced draw happens after `setProgram`.
    //
    // Provably free here. Under AdditiveBlending the back-face submission
    // rasterises nothing for a flat XZ annulus seen from above, so a single
    // pass is the same pixels. NOT `side: FrontSide` — that would depend on
    // `pushArc`'s winding below and can make the whole glyph vanish.
    forceSinglePass: true,
    toneMapped: false,
  });
}

/* -- geometry --------------------------------------------------------------
 * The glyph is authored in the XZ plane at unit radius, with vertex colours
 * carrying its internal brightness ramp, so one instance colour drives the
 * whole shape and one instance scale drives the pop.
 * ------------------------------------------------------------------------ */

/** Push one flat annulus sector into the arrays. */
function pushArc(
  pos: number[], col: number[], idx: number[],
  a0: number, a1: number, r0: number, r1: number, segments: number, brightness: number,
): void {
  const base = pos.length / 3;
  for (let s = 0; s <= segments; s++) {
    const a = a0 + (a1 - a0) * (s / segments);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    pos.push(c * r0, 0, sn * r0);
    pos.push(c * r1, 0, sn * r1);
    col.push(brightness, brightness, brightness);
    col.push(brightness, brightness, brightness);
  }
  for (let s = 0; s < segments; s++) {
    const i0 = base + s * 2;
    idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
  }
}

/** Push a flat triangle. */
function pushTri(
  pos: number[], col: number[], idx: number[],
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number, brightness: number,
): void {
  const base = pos.length / 3;
  pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
  for (let i = 0; i < 3; i++) col.push(brightness, brightness, brightness);
  idx.push(base, base + 1, base + 2);
}

function finish(pos: number[], col: number[], idx: number[], name: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.name = name;
  return g;
}

/**
 * The order marker: a bright ring with four outward chevrons. One glyph for all
 * three order families — colour and rotation carry the meaning, which keeps the
 * whole feedback layer inside one draw call.
 */
function buildMarkerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  pushArc(pos, col, idx, 0, Math.PI * 2, 0.70, 0.88, 40, 1.0);

  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI * 0.5;
    const w = 0.26;
    const ax = Math.cos(a) * 1.38;
    const az = Math.sin(a) * 1.38;
    const bx = Math.cos(a - w) * 0.98;
    const bz = Math.sin(a - w) * 0.98;
    const cx = Math.cos(a + w) * 0.98;
    const cz = Math.sin(a + w) * 0.98;
    pushTri(pos, col, idx, ax, az, bx, bz, cx, cz, 1.0);
  }
  return finish(pos, col, idx, 'OrderMarker');
}

/* ==========================================================================
 * 4. CAMERA CONTROL
 *
 * Everything camera.ts used to do for itself. Frame-rate independent: every
 * term is multiplied by dt.
 *
 * THESE ARE HELD KEYS, NOT CHORDS, so they cannot go through `actionFor` —
 * a pan is polled every frame from `isKeyDown`, not dispatched on a keystroke.
 * They resolve against the SAME settings store all the same (see
 * `rebuildCameraKeys`), because the Controls tab lists all six rows as live and
 * a rebind that does nothing is worse than no row at all.
 *
 * The arrow keys are a PERMANENT ALIAS on top of whatever is bound. A player
 * who rebinds pan onto a chord they then forget, or clears the row entirely,
 * must not end up with no way to move the camera.
 * ========================================================================== */

function updateCamera(dt: number): void {
  if (input === null) return;
  const rig = ctx().cameraRig;
  const cfg = RENDER_CONFIG.camera;
  const d = Math.min(dt, 0.1);

  const held = (id: string, arrow: string): boolean =>
    (arrow !== '' && input!.isKeyDown(arrow)) ||
    (cameraKeys[id] !== undefined && cameraKeys[id] !== '' && input!.isKeyDown(cameraKeys[id]));

  let mx = 0;
  let mz = 0;
  if (held('cam.panLeft', 'ArrowLeft')) mx -= 1;
  if (held('cam.panRight', 'ArrowRight')) mx += 1;
  if (held('cam.panUp', 'ArrowUp')) mz -= 1;
  if (held('cam.panDown', 'ArrowDown')) mz += 1;
  if (held('cam.rotateLeft', '')) rig.setYaw(rig.targetYaw + cfg.yawSpeed * DEG2RAD * d);
  if (held('cam.rotateRight', '')) rig.setYaw(rig.targetYaw - cfg.yawSpeed * DEG2RAD * d);

  // THE ONLY ZOOM WITH NO POINTER IN IT. Reported from a Mac trackpad as "cant
  // zoom or scroll on z"; before this, `rig.zoomBy` had two callers and both
  // were wheel-driven, so every route to the dolly went through a `wheel`
  // event. `zoomBy` is multiplicative, so `zoomBy(rate * d)` composes to
  // `zoomStep^(rate * t)` whatever the frame rate — held for one second at
  // 60 fps and at 240 fps land on the same distance, which is a test.
  //
  // No arrow alias: the arrows are the pan fallback and `held`'s second
  // argument is that alias, not a second binding. A cleared row here really is
  // cleared, and the wheel and the pinch remain.
  const zoomRate = CAMERA_NAV.keyZoomNotchesPerSecond * d;
  if (held('cam.zoomIn', '')) rig.zoomBy(-zoomRate);
  if (held('cam.zoomOut', '')) rig.zoomBy(zoomRate);

  if (mx !== 0 || mz !== 0) {
    const inv = 1 / Math.hypot(mx, mz);
    const speed = cfg.panSpeed * d * (rig.distance / cfg.distance);
    panScreenSpace(mx * inv * speed, mz * inv * speed);
  } else if (!panning && input.edgeDirection(EDGE)) {
    const speed = cfg.edgePanSpeed * d * (rig.distance / cfg.distance);
    panScreenSpace(EDGE[0] * speed, EDGE[1] * speed);
  }
}

/** Move the focus in the camera's ground-projected right/forward basis. */
function panScreenSpace(right: number, forward: number): void {
  const rig = ctx().cameraRig;
  const s = Math.sin(rig.yaw);
  const c = Math.cos(rig.yaw);
  rig.panBy(right * c + forward * s, right * -s + forward * c);
}

/**
 * Wheel dolly. After the step we pull the focus toward the ground point that
 * was under the cursor by the same ratio the distance changed, which keeps that
 * point (very nearly) pinned — the only zoom that never feels like it has the
 * wrong anchor.
 */
function zoomAtCursor(notches: number, p: PointerInfo): void {
  const rig = ctx().cameraRig;
  const cfg = RENDER_CONFIG.camera;
  const before = rig.targetDistance;
  rig.zoomBy(notches);
  const after = rig.targetDistance;
  if (!p.worldValid || before <= 0 || cfg.zoomToCursor <= 0) return;

  const ratio = after / before;
  const pull = (1 - ratio) * cfg.zoomToCursor;
  const fx = rig.targetFocus.x;
  const fz = rig.targetFocus.z;
  rig.setFocus(fx + (p.worldX - fx) * pull, fz + (p.worldZ - fz) * pull);
}

/* ==========================================================================
 * 5. ORDER ISSUE
 * ========================================================================== */

/** Collect the local player's orderable entities out of the selection. */
function gatherOwnOrderable(mobileOnly: boolean): number {
  const { world } = ctx();
  const s = world.store;
  const local = world.localPlayer as number;
  const sel = world.selection;
  let n = 0;
  for (let i = 0; i < sel.count && n < ORDER_IDS.length; i++) {
    const idx = s.index(sel.ids[i] as EntityId);
    if (idx < 0 || s.owner[idx] !== local) continue;
    if (mobileOnly && (s.flags[idx] & EntityFlag.CanMove) === 0) continue;
    ORDER_IDS[n++] = sel.ids[i];
  }
  return n;
}

/** Ground height at a point, for placing a marker on the terrain. */
function groundY(x: number, z: number): number {
  return ctx().world.terrain.heightAt(x, z);
}

/** Drop the marker for an order that was just issued. */
function feedback(order: OrderKind, x: number, z: number): void {
  overlay?.spawn(feedbackFor(order), x, groundY(x, z), z);
}

/**
 * Execute a resolved context order against the current selection: one command
 * for the whole group, plus one order marker at the point.
 */
/**
 * Real def tables, once a content module has published any. Null otherwise.
 *
 * Bound at `init` alongside `setRoleResolver`, off the SAME `resolveDefBinding`
 * call, because it answers the same class of question: what content says about
 * a thing, as opposed to what its flags say. Only the display NAME is read.
 */
let defTables: DefTables | null = null;

/**
 * The content name of a building, or '' when there is none to be had.
 *
 * Total by construction — no tables, an unknown `defId`, a dead handle and a
 * non-building all answer '', and the one caller phrases its sentence without
 * a name in that case. A refusal toast must never be the thing that throws.
 */
function buildingDisplayName(id: EntityId): string {
  if (defTables === null || id === NONE) return '';
  const s = ctx().world.store;
  const i = s.index(id);
  if (i < 0 || s.kind[i] !== EntityKind.Building) return '';
  const def = defTables.buildings[s.defId[i]];
  return def?.name ?? '';
}

/**
 * Say why a right-click issued nothing.
 *
 * The RULE is `deadClickReason` in Commands.ts, next to the resolver whose
 * output it reads; this is only the part that needs a HUD. Keyed
 * `order:refused` so walking the cursor along a cliff edge replaces one toast
 * rather than stacking thirty — the stack coalesces by key and counts the
 * repeats — and it is a different key from `garrison:refused` for the reason
 * recorded there: sharing one filed a refusal under somebody else's heading.
 */
function explainDeadClick(res: OrderResolution, issued: number): void {
  const text = deadClickText(deadClickReason(caps, res, issued));
  if (text === null) return;
  hud()?.toast?.('warn', 'order:refused', text[0], text[1]);
}

function executeResolved(res: OrderResolution, queued: boolean): void {
  if (!res.valid) { explainDeadClick(res, 0); return; }
  const { world, channels } = ctx();
  const player = world.localPlayer;

  // THE REFUSED GARRISON SPEAKS. The order below is still a Move and that is
  // still right — refusing to move is the more correct answer and the more
  // annoying one — but the click was aimed at a building by a squad that could
  // have gone inside one, and a rule was applied. Before this, the squad walked
  // to the wall and stood there and nothing anywhere said why.
  //
  // Keyed on `garrison`, so walking a column past a row of refineries replaces
  // one toast rather than stacking six.
  if (res.garrisonRefusal !== '') {
    // `selection.hovered` rather than a field on the resolution: it is the
    // entity `refreshResolution` just handed the resolver, set on the same
    // line, so it is the same building by construction — and a Move's `target`
    // is deliberately NONE, which is a promise this must not break.
    const name = buildingDisplayName(selection?.hovered ?? NONE);
    hud()?.toast?.(
      // `garrison:refused`, NOT `garrison`. The toast stack COALESCES by key —
      // it keeps the first title and counts the repeats — so sharing a key with
      // the HUD's Evacuate confirmation made a refusal arrive under the heading
      // "Evacuate". Same family, different event, different key.
      'warn', 'garrison:refused',
      name === '' ? 'Cannot be manned' : `Cannot man the ${name}`,
      garrisonRefusalText(res.garrisonRefusal),
    );
  }

  // Deploy never travels through the group path: each vehicle unpacks where IT
  // stands, so there is no shared destination for Steering to preserve a
  // formation around, and a mixed selection must leave the escort alone.
  if (res.order === OrderKind.Deploy) {
    issueDeploy(res.target);
    return;
  }

  if (res.isRally) {
    const s = world.store;
    const sel = world.selection;
    let issued = 0;
    for (let i = 0; i < sel.count; i++) {
      const idx = s.index(sel.ids[i] as EntityId);
      if (idx < 0 || s.owner[idx] !== (player as number)) continue;
      if ((s.flags[idx] & EntityFlag.IsFactory) === 0) continue;
      channels.commands.issueSetRally(player, sel.ids[i] as EntityId, res.x, res.z);
      issued++;
    }
    if (issued > 0) {
      feedback(OrderKind.SetRally, res.x, res.z);
      // DESELECT, because the flag IS the selection. `Overlay.collectRallyLinks`
      // draws a rally marker for every SELECTED factory and nothing else — it
      // has no visibility flag, no timer and no fade — so a player who sets a
      // rally point and looks away is left with a flag stuck under the cursor
      // until they happen to click elsewhere. Setting the point is the end of
      // the gesture, so end the gesture.
      //
      // Selection is not sim state: it carries no `CommandKind`, crosses no
      // wire, and appears in none of the three checksum blocks. Clearing it
      // here changes what one player sees and nothing either client simulates.
      selection?.clear();
      refreshResolution();
    }
    return;
  }

  const n = gatherOwnOrderable(res.order !== OrderKind.Stop);
  if (n === 0) { explainDeadClick(res, 0); return; }

  // ONE command, ONE destination, for the whole group. That is what makes
  // sim/Steering.ts recognise them as a group and preserve the formation's
  // shape — see the note at the top of Commands.ts §4.
  issueOrder(world, channels, player, res.order, ORDER_IDS, n, res.x, res.z, res.target, queued);
  feedback(res.order, res.x, res.z);
}

/**
 * Unpack every selected construction vehicle where it stands.
 *
 * ONE COMMAND PER VEHICLE, each carrying that vehicle's own position. Guard is
 * the same shape and for the same reason: there is no single point that could
 * express "everybody, here, individually". The sim re-validates each one and
 * answers `EvaLine.CannotDeployHere` for the ones that cannot.
 *
 * `only` restricts the order to a single vehicle — the double-click and the
 * deploy-cursor right-click both name the exact MCV the player pointed at, and
 * neither should unpack the other two sitting behind it.
 */
function issueDeploy(only: EntityId = NONE): number {
  const { world, channels } = ctx();
  const s = world.store;
  const player = world.localPlayer;
  const sel = world.selection;

  let n: number;
  if (only !== NONE) {
    const i = s.index(only);
    if (i < 0 || s.owner[i] !== (player as number) || !isDeployable(world, i)) return 0;
    DEPLOY_IDS[0] = only as number;
    n = 1;
  } else {
    n = gatherDeployable(world, sel.ids, sel.count, DEPLOY_IDS);
  }
  if (n === 0) return 0;

  for (let k = 0; k < n; k++) {
    const i = s.index(DEPLOY_IDS[k] as EntityId);
    if (i < 0) continue;
    ONE_ID[0] = DEPLOY_IDS[k];
    const x = s.posX[i];
    const z = s.posZ[i];
    issueOrder(world, channels, player, OrderKind.Deploy, ONE_ID, 1, x, z, DEPLOY_IDS[k] as EntityId);
    overlay?.spawn(FeedbackKind.Special, x, groundY(x, z), z);
  }
  return n;
}

/**
 * Put the squad down, from every selected transport that has one.
 *
 * Same shape as `issueDeploy` and on the same key, because it is the same
 * gesture: D means "unpack where you stand", and the two things in this game
 * that can are an MCV and a loaded transport. One command per hull, each
 * carrying its own position — there is no shared destination, and a mixed
 * selection must not drag the escort into it.
 */
function issueUnload(): number {
  const { world, channels } = ctx();
  const s = world.store;
  const player = world.localPlayer;
  const sel = world.selection;

  const n = gatherLoadedTransports(world, sel.ids, sel.count, DEPLOY_IDS);
  if (n === 0) return 0;

  for (let k = 0; k < n; k++) {
    const i = s.index(DEPLOY_IDS[k] as EntityId);
    if (i < 0) continue;
    ONE_ID[0] = DEPLOY_IDS[k];
    const x = s.posX[i];
    const z = s.posZ[i];
    issueOrder(world, channels, player, OrderKind.Unload, ONE_ID, 1, x, z, DEPLOY_IDS[k] as EntityId);
    overlay?.spawn(FeedbackKind.Special, x, groundY(x, z), z);
  }
  return n;
}

/**
 * Turn out the garrison of every selected structure that has one.
 *
 * The third sibling on the D key, and the reason it belongs there rather than
 * on a key of its own: D means "unpack where you stand", and a squad walking
 * out of a strongpoint is the same event as a squad walking out of a hull —
 * same flag, same `place` ring, same order on the wire. Binding it anywhere
 * else would teach the player that they are two different verbs.
 *
 * One command per building, each carrying its own position, exactly as
 * `issueUnload` does — and for the same reason: a mixed selection empties the
 * strongpoints and leaves everything else alone.
 */
function issueEvacuate(): number {
  const { world, channels } = ctx();
  const s = world.store;
  const player = world.localPlayer;
  const sel = world.selection;

  const n = gatherOccupiedGarrisons(world, sel.ids, sel.count, DEPLOY_IDS);
  if (n === 0) return 0;

  for (let k = 0; k < n; k++) {
    const i = s.index(DEPLOY_IDS[k] as EntityId);
    if (i < 0) continue;
    ONE_ID[0] = DEPLOY_IDS[k];
    const x = s.posX[i];
    const z = s.posZ[i];
    issueOrder(world, channels, player, OrderKind.Unload, ONE_ID, 1, x, z, DEPLOY_IDS[k] as EntityId);
    overlay?.spawn(FeedbackKind.Special, x, groundY(x, z), z);
  }
  return n;
}

/**
 * Fire the faction ability of every selected commander.
 *
 * ONE order per unit, each carrying that unit's own position — the ability is
 * self-centred, so the point on the command is the commander's, never the
 * cursor's. Two commanders can never be selected at once in practice (there is
 * one per army and a player has one army), but the loop costs nothing and is
 * correct if that ever stops being true.
 *
 * No availability check here. `src/sim/Abilities.ts` refuses a unit with no
 * ability and a cooldown that has not expired, and duplicating either test in
 * the input layer is how the two would eventually disagree — the HUD button
 * greys itself off the SERVICE's answer for exactly the same reason.
 */
function issueAbility(): number {
  const { world, channels } = ctx();
  const s = world.store;
  const player = world.localPlayer;
  const sel = world.selection;

  let issued = 0;
  for (let k = 0; k < sel.count; k++) {
    const id = sel.ids[k] as EntityId;
    const i = s.index(id);
    if (i < 0 || s.owner[i] !== (player as number)) continue;
    const kind = s.kind[i];
    if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
    // Observation only: the service remains the sole authority and still
    // receives/refuses the command below. This snapshot prevents a tutorial
    // step from accepting the ability key on an ordinary tank or on cooldown.
    const willFire = abilities()?.isReady(id) === true;
    ONE_ID[0] = sel.ids[k];
    const x = s.posX[i];
    const z = s.posZ[i];
    issueOrder(world, channels, player, OrderKind.UseAbility, ONE_ID, 1, x, z);
    if (willFire) notifyTutorialAction('commander-ability');
    overlay?.spawn(FeedbackKind.Special, x, groundY(x, z), z);
    issued++;
  }
  return issued;
}

/** Hotkey orders that need no target: stop, guard, scatter. */
function issueImmediate(order: OrderKind): void {
  const { world, channels } = ctx();
  const player = world.localPlayer;
  const s = world.store;
  const n = gatherOwnOrderable(order !== OrderKind.Stop);
  if (n === 0) return;

  if (order === OrderKind.Scatter) {
    const dests = planScatter(world, ORDER_IDS, n);
    for (let i = 0; i < n; i++) {
      issueOrder(
        world, channels, player, OrderKind.Scatter, ORDER_IDS.subarray(i, i + 1), 1,
        dests[i * 2], dests[i * 2 + 1],
      );
    }
  } else if (order === OrderKind.Guard) {
    // Guard is "hold where you stand", so every unit gets its own point.
    for (let i = 0; i < n; i++) {
      const idx = s.index(ORDER_IDS[i] as EntityId);
      if (idx < 0) continue;
      issueOrder(
        world, channels, player, OrderKind.Guard, ORDER_IDS.subarray(i, i + 1), 1,
        s.posX[idx], s.posZ[idx],
      );
    }
  } else {
    issueOrder(world, channels, player, order, ORDER_IDS, n, 0, 0);
  }

  // One marker at the centroid: N markers for a stop order is confetti.
  if (selection !== null && selection.centroid(V2)) {
    overlay?.spawn(feedbackFor(order), V2[0], groundY(V2[0], V2[1]), V2[1]);
  }
}

/* ==========================================================================
 * 6. EVENT HANDLERS
 * ========================================================================== */

function refreshResolution(): void {
  const { world } = ctx();
  if (selection === null || input === null || projector === null) return;

  readCapabilities(world, world.selection.ids, world.selection.count, caps);

  const hasWorld = input.worldUnderPointer(V3);
  const hover = hasWorld
    ? pickEntity(world, projector, input.pointerX, input.pointerY, V3[0], V3[2])
    : NONE;
  selection.setHovered(hover);
  // Same line as the flag write, deliberately: the overlay's copy is then
  // exactly as fresh as `EntityFlag.Hovered` itself, whichever of the two the
  // draw pass happens to run after. Unconditional rather than gated on
  // `setHovered`'s changed flag — a HUD that mounts mid-match would otherwise
  // never learn the current hover.
  hud()?.overlay.setHoveredEntity?.(hover);

  MODS.shift = input.shift;
  MODS.ctrl = input.ctrl;
  MODS.alt = input.alt;
  resolveContextOrder(world, hover, V3[0], V3[2], hasWorld, MODS, mode, caps, resolution);
}

const handlers = {
  onPointerDown(p: PointerInfo): void {
    if (p.button === MouseButton.Middle && p.worldValid) {
      PAN_ANCHOR[0] = p.worldX;
      PAN_ANCHOR[2] = p.worldZ;
      panning = true;
    }
  },

  onPointerMove(): void {
    refreshResolution();
  },

  onClick(p: PointerInfo): void {
    if (selection === null || projector === null) return;
    if (placementActive()) return;
    const { world } = ctx();

    if (p.button === MouseButton.Left) {
      // A commander power outranks everything: it is the most recently armed
      // modal thing on the cursor, the player can see its reticle, and the
      // click they are making is unambiguously for it.
      if (applyArmedPower(p)) { refreshResolution(); return; }
      // An armed mode turns the left button into the order button for one click.
      if (mode !== CommandMode.None) {
        refreshResolution();
        executeResolved(resolution, p.shift || waypointLatched());
        if (!p.shift) setCommandMode(CommandMode.None);
        return;
      }
      const armedTool = hud()?.armedMode ?? 'none';
      const id = p.worldValid
        ? armedTool === 'none'
          ? pickEntity(world, projector, p.x, p.y, p.worldX, p.worldZ)
          : pickStructureToolTarget(world, projector, p.x, p.y, p.worldX, p.worldZ)
        : NONE;
      // The sidebar's repair/sell tool outranks selection while it is armed.
      if (applyArmedTool(id)) return;
      selection.select(id, p.ctrl ? SelectMode.Toggle : p.shift ? SelectMode.Add : SelectMode.Replace);
      refreshResolution();
      return;
    }

    if (p.button === MouseButton.Right) {
      // Right-click cancels an armed mode or tool instead of firing it — the
      // universal "never mind", and the reason A is safe to press speculatively.
      if (clearArmedPower()) { refreshResolution(); return; }
      if (clearArmedTool()) return;
      if (mode !== CommandMode.None) {
        setCommandMode(CommandMode.None);
        refreshResolution();
        return;
      }
      refreshResolution();
      executeResolved(resolution, p.shift || waypointLatched());
    }
  },

  onDoubleClick(p: PointerInfo): void {
    if (selection === null || projector === null) return;
    if (placementActive()) return;
    const { world } = ctx();

    if (p.button === MouseButton.Left) {
      const id = p.worldValid
        ? pickEntity(world, projector, p.x, p.y, p.worldX, p.worldZ)
        : NONE;
      if (id === NONE) { selection.clear(); return; }

      // DOUBLE-CLICKING A CONSTRUCTION VEHICLE DEPLOYS IT. This outranks
      // select-all-of-type, and it has to: an MCV is the one unit where
      // "select every other one on screen" is never what the gesture meant,
      // and double-click-to-deploy is the muscle memory every C&C player
      // arrives with. Select it first so the player can see what just took
      // the order.
      if (!p.shift) {
        const i = world.store.index(id);
        if (i >= 0 && world.store.owner[i] === (world.localPlayer as number)
          && isDeployable(world, i)) {
          selection.select(id, SelectMode.Replace);
          issueDeploy(id);
          refreshResolution();
          return;
        }
      }

      selection.selectSameTypeOnScreen(id, projector, p.shift);
      refreshResolution();
      return;
    }
    // A fast second right-click is a second order, not a swallowed one.
    if (p.button === MouseButton.Right && mode === CommandMode.None) {
      refreshResolution();
      executeResolved(resolution, p.shift || waypointLatched());
    }
  },

  onDragMove(d: DragInfo): void {
    if (d.button === MouseButton.Middle) {
      // World grab: keep the ground point that was under the cursor pinned.
      if (input !== null && input.worldUnderPointer(V3)) {
        const rig = ctx().cameraRig;
        rig.setFocus(
          clampWorld(rig.targetFocus.x + (PAN_ANCHOR[0] - V3[0])),
          clampWorld(rig.targetFocus.z + (PAN_ANCHOR[2] - V3[2])),
          true,
        );
      }
    }
  },

  onDragEnd(d: DragInfo): void {
    if (d.button === MouseButton.Middle) {
      panning = false;
      return;
    }
    if (selection === null || projector === null || input === null) return;
    const { world } = ctx();

    if (d.button === MouseButton.Left) {
      if (d.significant) {
        selection.selectInRect(d.minX, d.minY, d.maxX, d.maxY, projector, d.shift);
      } else {
        // Past the dead zone but too small to mean a box: treat it as a click
        // at the release point rather than clearing the selection.
        const cx = (d.minX + d.maxX) * 0.5;
        const cy = (d.minY + d.maxY) * 0.5;
        if (input.worldUnderPointer(V3)) {
          const id = pickEntity(world, projector, cx, cy, V3[0], V3[2]);
          selection.select(id, d.shift ? SelectMode.Add : SelectMode.Replace);
        }
      }
      refreshResolution();
      return;
    }

    if (d.button === MouseButton.Right && mode === CommandMode.None) {
      // A sloppy right-drag is still a right-click order at the release point.
      refreshResolution();
      executeResolved(resolution, d.shift || waypointLatched());
    }
  },

  onDragCancel(): void {
    panning = false;
  },

  onWheel(notches: number, p: PointerInfo): void {
    zoomAtCursor(notches, p);
  },

  onBlur(): void {
    setCommandMode(CommandMode.None);
    panning = false;
  },

  onKeyDown(k: KeyInfo): boolean {
    if (selection === null) return false;
    // A structure on the cursor owns Escape (it cancels the ghost). Everything
    // else stays live so the camera still moves while placing.
    if (placementActive() && k.code === 'Escape') return false;
    const { cameraRig } = ctx();

    // --- camera bookmarks: Ctrl+F5..F8 stores, F5..F8 recalls ------------
    const bookmark = cameraBookmarkSlot(k.code);
    if (bookmark >= 0 && !k.shift && !k.alt && !k.meta) {
      if (k.repeat) return true;
      if (k.ctrl) storeCameraBookmark(bookmark);
      else recallCameraBookmark(bookmark);
      return true;
    }

    // --- control groups: Digit0..9 ---------------------------------------
    if (k.code.length === 6 && k.code.startsWith('Digit')) {
      const n = k.code.charCodeAt(5) - 48;
      if (n < 0 || n > 9) return false;
      if (k.repeat) return true;

      if (k.ctrl) {
        if (k.shift) selection.addToGroup(n);
        else selection.setGroup(n);
        notifyTutorialAction('control-group-store');
        return true;
      }
      const now = nowMs();
      const doubleTap = lastGroupKey === n && now - lastGroupTime <= GROUP_DOUBLE_TAP_MS;
      lastGroupKey = n;
      lastGroupTime = now;
      selection.recallGroup(n, k.shift);
      notifyTutorialAction('control-group-recall');
      if (doubleTap && selection.groupCentroid(n, V2)) {
        cameraRig.setFocus(V2[0], V2[1]);
      }
      refreshResolution();
      return true;
    }

    if (k.repeat) return false;

    switch (actionFor(k)) {
      // Ctrl+A shares its CODE with Attack Move and not its CHORD, so it needs
      // no special case: `chordKey` includes the modifiers, `KeyA|100` and
      // `KeyA|000` are different entries, and the row is rebindable like any
      // other. It used to be resolved ahead of the table, which quietly made
      // the Select All Army row on the options screen do nothing.
      case 'sel.allArmy':
        selection.selectAllArmy();
        refreshResolution();
        return true;

      case 'sel.idleHarvester':
        cycleIdleHarvester();
        refreshResolution();
        return true;

      case 'ord.attackMove':
        setCommandMode(caps.mobileCount > 0 ? CommandMode.AttackMove : CommandMode.None);
        return true;

      case 'ord.stop':
        issueImmediate(OrderKind.Stop);
        return true;

      case 'ord.guard':
        issueImmediate(OrderKind.Guard);
        return true;

      case 'ord.scatter':
        issueImmediate(OrderKind.Scatter);
        return true;

      case 'ord.deploy':
        // The classic binding. Consumed whether or not anything deployable is
        // selected: D is not bound to anything else, and letting the keystroke
        // fall through would hand it to the build grid, where it does nothing
        // either but does it less predictably.
        //
        // ALL THREE, not any one. D means "unpack where you stand", and an MCV,
        // a loaded transport and an occupied strongpoint are the three things
        // that can — so a selection holding one of each does all three, and
        // each gatherer ignores what is not its own. The order between them
        // makes no difference: nothing in this roster is simultaneously two of
        // the three, and all three gatherers re-validate against the store.
        issueDeploy();
        issueUnload();
        issueEvacuate();
        return true;

      case 'ord.forceAttack':
        setCommandMode(caps.canAttack ? CommandMode.ForceAttack : CommandMode.None);
        return true;

      case 'ord.rally':
        setCommandMode(caps.factoryCount > 0 ? CommandMode.Rally : CommandMode.None);
        return true;

      case 'ord.stance':
        // Stance cycle on the selection: aggressive -> defensive -> hold fire ->
        // hold ground. Goes through the bus like everything else.
        cycleStance();
        return true;

      case 'ord.ability':
        // Consumed whether or not a commander is selected, for the same reason
        // Deploy is: a keystroke that falls through to the build grid does
        // nothing there either, but does it less predictably.
        issueAbility();
        return true;

      case 'cam.home':
        centreOnHome();
        return true;

      default:
        break;
    }

    switch (k.code) {
      case 'Escape':
        // Innermost armed thing first, outward: power, then tool, then command
        // mode, then the selection itself. One Escape undoes one thing.
        if (!cancelBattlefieldMode()) {
          selection.clear();
          refreshResolution();
        }
        return true;

      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        // Consumed so the page never scrolls under the battlefield.
        return true;

      default:
        return false;
    }
  },
};

/* ==========================================================================
 * KEY BINDINGS
 *
 * The order surface is DATA, resolved against the live settings store, so the
 * Options screen's Controls tab actually rebinds the game instead of merely
 * displaying the scheme. The shell publishes `window.__vmSettings`; this module
 * must not import it, because the shell is a lazily loaded chunk that a
 * `?shot=` boot never loads at all — so the table is duck-typed.
 *
 * THE DEFAULTS ARE NOT WRITTEN HERE ANY MORE.
 * ------------------------------------------
 * They come from `src/input/ActionCatalogue.ts`, which is also what the options
 * screen and the help screen render. This file used to hold its own copy of the
 * scheme and the settings store held a second one; the moment a third consumer
 * (help) appeared, "three lists that agree today" stopped being good enough.
 * The catalogue has no imports and no DOM, so a `?shot=` boot still pays for
 * nothing but a small frozen table.
 * ========================================================================== */

/** A settings-store chord as it arrives over the duck-typed bridge. */
interface BoundChord { code: string; ctrl: boolean; shift: boolean; alt: boolean }

/** `id -> chord` for every dispatched action. Frozen at module load. */
const DEFAULT_ACTION_CHORDS: Readonly<Record<string, ActionChord>> = defaultCommandChords();

/** `id -> code` for every polled camera key. `''` means the player cleared it. */
const DEFAULT_CAMERA_KEYS: Readonly<Record<string, string>> = defaultCameraCodes();

/** Live camera-key id -> code. */
let cameraKeys: Record<string, string> = { ...DEFAULT_CAMERA_KEYS };

interface SettingsBridge {
  get(): { controls?: { bindings?: Record<string, BoundChord> } };
  subscribe?(fn: () => void): () => void;
}

/** `code|ctrl|shift|alt` -> action id. Rebuilt only when the store changes. */
let chordToAction: Map<string, string> = new Map();
let unsubscribeSettings: (() => void) | null = null;

function chordKey(code: string, ctrl: boolean, shift: boolean, alt: boolean): string {
  return `${code}|${ctrl ? 1 : 0}${shift ? 1 : 0}${alt ? 1 : 0}`;
}

function settingsBridge(): SettingsBridge | null {
  const g = globalThis as unknown as { __vmSettings?: SettingsBridge };
  const s = g.__vmSettings;
  return s !== undefined && typeof s.get === 'function' ? s : null;
}

function rebuildBindings(): void {
  const bound = settingsBridge()?.get().controls?.bindings;
  const next = new Map<string, string>();
  for (const id of COMMAND_ACTION_IDS) {
    const c = bound?.[id];
    const live = c !== undefined && typeof c.code === 'string' ? c : DEFAULT_ACTION_CHORDS[id];
    if (live === undefined || live.code === '') continue; // deliberately unbound
    next.set(chordKey(live.code, live.ctrl === true, live.shift === true, live.alt === true), id);
  }
  chordToAction = next;

  const cam: Record<string, string> = { ...DEFAULT_CAMERA_KEYS };
  for (const id of CAMERA_KEY_IDS) {
    const c = bound?.[id];
    // An explicitly cleared row is a real choice ('' = unbound); only a MISSING
    // row falls back to the default.
    if (c !== undefined && typeof c.code === 'string') cam[id] = c.code;
  }
  cameraKeys = cam;
}

/** Subscribe to the store if it exists, so a rebind takes effect immediately. */
function bindSettings(): void {
  rebuildBindings();
  const s = settingsBridge();
  if (s?.subscribe !== undefined) unsubscribeSettings = s.subscribe(rebuildBindings);
}

function unbindSettings(): void {
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  chordToAction = new Map();
  cameraKeys = { ...DEFAULT_CAMERA_KEYS };
}

function actionFor(k: KeyInfo): string | undefined {
  return chordToAction.get(chordKey(k.code, k.ctrl, k.shift, k.alt));
}

/** Wall clock. Render-side only; never reached from a sim tick. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Rotate the whole selection's auto-engagement policy one step. */
function cycleStance(): void {
  const { world, channels } = ctx();
  const s = world.store;
  const n = gatherOwnOrderable(true);
  if (n === 0) return;
  const first = s.index(ORDER_IDS[0] as EntityId);
  const current = first >= 0 ? (s.stance[first] as Stance) : Stance.Aggressive;
  const next = ((current + 1) % 4) as Stance;
  channels.commands.issueSetStance(world.localPlayer, ORDER_IDS, n, next);
  notifyTutorialAction('stance-change');
}

/** Centre the camera on the player's first structure, else on their army. */
function centreOnHome(): void {
  const { world, cameraRig } = ctx();
  const s = world.store;
  const local = world.localPlayer as number;
  const buildings = s.byKind[EntityKind.Building];
  for (let i = 0; i < s.byKindCount[EntityKind.Building]; i++) {
    const idx = buildings[i];
    if (s.owner[idx] !== local) continue;
    if ((s.flags[idx] & EntityFlag.IsBuilder) === 0 && (s.flags[idx] & EntityFlag.IsFactory) === 0) continue;
    cameraRig.setFocus(s.posX[idx], s.posZ[idx]);
    return;
  }
  let n = 0;
  let sx = 0;
  let sz = 0;
  for (let a = 0; a < s.aliveCount; a++) {
    const idx = s.alive[a];
    if (s.owner[idx] !== local) continue;
    sx += s.posX[idx];
    sz += s.posZ[idx];
    n++;
  }
  if (n > 0) cameraRig.setFocus(sx / n, sz / n);
}

/** F5..F8 -> 0..3, or -1 for every other key. */
export function cameraBookmarkSlot(code: string): number {
  const n = /^F([5-8])$/.exec(code);
  return n === null ? -1 : Number(n[1]) - 5;
}

function storeCameraBookmark(slot: number): void {
  const rig = ctx().cameraRig;
  cameraBookmarks[slot] = { ...rig.getPose() };
  hud()?.toast?.(
    'info', `camera:bookmark:${slot}`, `Camera bookmark ${slot + 1} saved`,
    `Press F${slot + 5} to return`,
  );
}

function recallCameraBookmark(slot: number): void {
  const pose = cameraBookmarks[slot];
  if (pose === null) {
    hud()?.toast?.(
      'info', `camera:bookmark:${slot}`, `Camera bookmark ${slot + 1} is empty`,
      `Press Ctrl + F${slot + 5} to save this view`,
    );
    return;
  }
  // Let pitch keep following zoom; storing it as an override would make a
  // recalled bookmark permanently flatten/steepen subsequent wheel zooms.
  ctx().cameraRig.clearPitchOverride();
  ctx().cameraRig.setPose({
    x: pose.x, z: pose.z, yaw: pose.yaw, distance: pose.distance,
    immediate: false,
  });
}

/** Select, centre, and advance through the local player's idle miners. */
function cycleIdleHarvester(): void {
  if (selection === null) return;
  const { world, cameraRig } = ctx();
  const s = world.store;
  const local = world.localPlayer as number;
  let first: EntityId = NONE;
  let after: EntityId = NONE;
  let seenLast = lastIdleHarvester === NONE;

  for (let a = 0; a < s.aliveCount; a++) {
    const i = s.alive[a];
    if (s.owner[i] !== local) continue;
    if ((s.flags[i] & EntityFlag.IsHarvester) === 0) continue;
    if ((s.flags[i] & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
    if (s.state[i] !== UnitState.Idle) continue;
    const id = s.handleOf(i);
    if (first === NONE) first = id;
    if (seenLast && id !== lastIdleHarvester) { after = id; break; }
    if (id === lastIdleHarvester) seenLast = true;
  }

  const next = after !== NONE ? after : first;
  if (next === NONE) {
    lastIdleHarvester = NONE;
    hud()?.toast?.('info', 'harvester:none-idle', 'No idle harvesters', 'Every ore miner is working');
    return;
  }
  const idx = s.index(next);
  if (idx < 0) return;
  lastIdleHarvester = next;
  selection.select(next, SelectMode.Replace);
  cameraRig.setFocus(s.posX[idx], s.posZ[idx]);
}

/* ==========================================================================
 * 7. THE SIBLING MODULES
 *
 * Two modules publish console globals we are the intended consumer of. Both are
 * reached structurally rather than by import, so this file compiles and runs
 * whether or not either of them ever lands.
 *
 *   __vmHud       src/ui/Hud.ts     — "hud.overlay.setMarquee / clearMarquee →
 *                                     input: drag select" is verbatim from its
 *                                     public-hooks header, as are `armedMode`
 *                                     and `waypointMode`.
 *   __vmPlacement src/sim/Placement.ts — while a structure is on the cursor it
 *                                     owns the click. Its own listeners are
 *                                     capture-phase and stop propagation, so
 *                                     the only thing we must not steal is the
 *                                     keyboard.
 * ========================================================================== */

interface HudBridge {
  minimap?: { onOrderRequest?(fn: ((x: number, z: number) => boolean) | null): void };
  overlay: {
    setMarquee(x0: number, y0: number, x1: number, y1: number): void;
    clearMarquee(): void;
    /**
     * THE HOVERED ENTITY, PUSHED RATHER THAN SEARCHED FOR.
     *
     * `Selection.setHovered` moves `EntityFlag.Hovered` — it clears the old
     * slot before setting the new one — so there is at most ONE hovered entity
     * in the world, and this module is the only thing that decides which. The
     * overlay's hover ring used to find it with two full walks of `store.alive`
     * per frame, ~800 iterations at 400 entities, to locate a handle we are
     * holding on the line below.
     *
     * OPTIONAL, like `armedPower` and `toast`, and for the same reason: an
     * overlay that predates this method simply does not have it, keeps finding
     * the flag its own way, and nothing here can take input down. `EntityId`
     * and not `number` — the overlay re-checks the flag off `store.index()`,
     * and a raw slot would be a different thing wearing the same type.
     */
    setHoveredEntity?(id: EntityId): void;
  };
  sidebar: { setArmed(mode: 'none' | 'repair' | 'sell'): void };
  readonly armedMode: 'none' | 'repair' | 'sell';
  waypointMode: boolean;
  /** Keep the perimeter command deck in sync with the armed cursor. */
  setCommandMode?(action: HudCommandAction | 'none'): void;
  /**
   * THE COMMANDER POWER ON THE CURSOR, or 0. The HUD's power bar arms it and
   * this module spends it, which is the identical division of labour
   * `armedMode` already describes: the bar owns the TOGGLE, the ground click is
   * a GESTURE, and gestures belong to input.
   *
   * A superweapon needs none of this because `src/sim/Superweapons.ts` installs
   * its own capture-phase pointer handler. A commander power has no service
   * that could — `CommanderPowerService` is a pure charge table with no DOM in
   * it at all — so the click has to be read where every other click is read.
   *
   * All three members are OPTIONAL, which is the same bargain the rest of this
   * section makes: an older HUD, or a HUD that failed to build its power bar,
   * leaves them undefined and every branch below falls through to what it did
   * before. Nothing here can take input down.
   */
  readonly armedPower?: number;
  firePowerAt?(x: number, z: number): boolean;
  cancelArmedPower?(): boolean;
  /**
   * The toast stack, from the HUD's own public-hooks header
   * (`hud.toast(kind,key,title,detail)` — "anyone"). Input is `anyone`: it is
   * the module that knows a click was refused and by what rule, and the HUD is
   * the module that owns the only surface able to say so.
   *
   * Optional like the three above, and for the same reason.
   */
  toast?(kind: 'info' | 'warn' | 'alert', key: string, title: string, detail: string): void;
}

interface PlacementBridge {
  readonly active: boolean;
}

/** The concrete HUD instance carrying our callbacks, not a one-shot latch. */
let linkedHud: HudBridge | null = null;

/** Resolve a minimap point through the ordinary battlefield context rules. */
function issueMinimapOrder(x: number, z: number): boolean {
  if (selection === null) return false;
  const { world } = ctx();
  readCapabilities(world, world.selection.ids, world.selection.count, caps);
  if (caps.ownCount === 0) return false;

  // The tactical map has no screen-space picker. Resolve the nearest visible
  // blip under its click footprint, then let `resolveContextOrder` decide
  // attack / move / capture / repair exactly as it does over the world.
  const count = world.spatial.queryCircleFat(x, z, 4, ORDER_IDS, ORDER_IDS.length);
  const st = world.store;
  let hover = NONE;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < count; k++) {
    const i = ORDER_IDS[k];
    if (!canInteractWith(world, world.localPlayer, i)) continue;
    const dx = st.posX[i] - x;
    const dz = st.posZ[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; hover = st.handleOf(i); }
  }

  MODS.shift = input?.shift ?? false;
  MODS.ctrl = input?.ctrl ?? false;
  MODS.alt = input?.alt ?? false;
  resolveContextOrder(world, hover, x, z, true, MODS, mode, caps, resolution);
  if (!resolution.valid) return false;
  executeResolved(resolution, MODS.shift || waypointLatched());
  return true;
}

function hud(): HudBridge | null {
  const g = globalThis as unknown as { __vmHud?: HudBridge };
  return g.__vmHud ?? null;
}

function placementActive(): boolean {
  const g = globalThis as unknown as { __vmPlacement?: PlacementBridge };
  return g.__vmPlacement?.active === true;
}

/** Hand the marquee pixels to the HUD's overlay canvas, once it exists. */
function linkHud(): void {
  const h = hud();
  if (input === null) return;
  if (h === null) {
    if (linkedHud !== null) {
      linkedHud.minimap?.onOrderRequest?.(null);
      linkedHud = null;
      input.clearMarqueeRenderer();
    }
    return;
  }
  if (h === linkedHud) return;

  // Matches can recreate the HUD without reloading this module. A boolean
  // latch left every later minimap without an order callback, so right-click
  // silently fell through to the presentation ping path (or did nothing in
  // solo). Detach the old surface and bind the actual current HUD identity.
  linkedHud?.minimap?.onOrderRequest?.(null);
  linkedHud = h;
  input.setMarqueeRenderer(
    (x0, y0, x1, y1) => h.overlay.setMarquee(x0, y0, x1, y1),
    () => h.overlay.clearMarquee(),
  );
  h.minimap?.onOrderRequest?.(issueMinimapOrder);
}

/** True when the player has latched waypoint mode in the command bar. */
function waypointLatched(): boolean {
  return hud()?.waypointMode === true;
}

/**
 * The sidebar's repair / sell tools. Left-clicking a structure while one is
 * armed sends the matching command instead of selecting.
 * Returns true when the click was consumed.
 */
function applyArmedTool(target: EntityId): boolean {
  const h = hud();
  if (h === null || h.armedMode === 'none') return false;
  const { world, channels } = ctx();
  const s = world.store;
  const i = s.index(target);
  if (i < 0 || s.kind[i] !== EntityKind.Building) return true; // armed: eat the click
  if (s.owner[i] !== (world.localPlayer as number)) return true;

  if (h.armedMode === 'repair') channels.commands.issueRepairToggle(world.localPlayer, target);
  else channels.commands.issueSell(world.localPlayer, target);
  overlay?.spawn(FeedbackKind.Special, s.posX[i], s.posY[i], s.posZ[i]);
  return true;
}

/** Drop the sidebar's armed tool. Right-click and Escape both do this. */
function clearArmedTool(): boolean {
  const h = hud();
  if (h === null || h.armedMode === 'none') return false;
  h.sidebar.setArmed('none');
  return true;
}

/** True while a commander power is on the cursor and wants the next click. */
function powerArmed(): boolean {
  const h = hud();
  return h !== null && (h.armedPower ?? 0) !== 0 && typeof h.firePowerAt === 'function';
}

/**
 * Spend an armed commander power at the world point under the cursor.
 * Returns true when the click was consumed.
 *
 * EATS THE CLICK EVEN OFF THE MAP. A power is armed modally and the player can
 * see the reticle; letting a click that missed the ground fall through to
 * SELECTION would clear their army while they were mid-gesture, which is the
 * worst possible answer. Off-map disarms and does nothing else, exactly as
 * `applyArmedTool` eats a click that lands on the wrong kind of entity.
 */
function applyArmedPower(p: PointerInfo): boolean {
  const h = hud();
  if (h === null) return false;
  const fire = h.firePowerAt;
  if ((h.armedPower ?? 0) === 0 || typeof fire !== 'function') return false;
  if (p.worldValid) {
    fire.call(h, p.worldX, p.worldZ);
    overlay?.spawn(FeedbackKind.Special, p.worldX, groundY(p.worldX, p.worldZ), p.worldZ);
  } else {
    h.cancelArmedPower?.();
  }
  return true;
}

/** Drop an armed commander power. Right-click and Escape both do this. */
function clearArmedPower(): boolean {
  const h = hud();
  if (h === null || (h.armedPower ?? 0) === 0) return false;
  return h.cancelArmedPower?.() ?? false;
}

/**
 * Cancel exactly one modal battlefield interaction, innermost first. The shell
 * calls this before opening Pause because its capture-phase listener otherwise
 * intercepts Escape before InputManager can receive it.
 */
function cancelBattlefieldMode(): boolean {
  let cancelled = false;
  if (clearArmedPower()) cancelled = true;
  else if (clearArmedTool()) cancelled = true;
  else if (mode !== CommandMode.None) {
    setCommandMode(CommandMode.None);
    cancelled = true;
  }
  if (cancelled) refreshResolution();
  return cancelled;
}

/* ==========================================================================
 * 8. CURSOR CHOICE
 * ========================================================================== */

function chooseCursor(): CursorKind {
  if (input === null) return CursorKind.Default;

  // A live marquee owns the pointer.
  if (input.isDragging && input.dragButtonId === MouseButton.Left) return CursorKind.Select;
  if (input.isDragging && input.dragButtonId === MouseButton.Middle) return CursorKind.Default;

  // Edge band: show which way the camera will scroll.
  if (input.edgeDirection(EDGE)) return InputManager.panCursor(EDGE[0], EDGE[1]);

  // A commander power owns the pointer above everything else it can be armed
  // alongside. `Rally` is the reticle: it is the one cursor in the set that
  // means "the next click names a POINT", which is exactly what a power wants,
  // and it is never simultaneously live — a power and a rally cannot both be
  // armed, because arming either clears the other's owner.
  if (powerArmed()) return CursorKind.Rally;

  // The sidebar's repair / sell tools own the pointer while they are armed.
  const armed = hud()?.armedMode ?? 'none';
  if (armed === 'repair') return CursorKind.Repair;
  if (armed === 'sell') return CursorKind.Sell;

  if (mode === CommandMode.Move) return CursorKind.Move;
  if (mode === CommandMode.AttackMove) return CursorKind.AttackMove;
  if (mode === CommandMode.ForceAttack) return CursorKind.ForceAttack;
  if (mode === CommandMode.Rally) return CursorKind.Rally;

  if (caps.ownCount === 0) {
    return selection !== null && selection.hovered !== NONE ? CursorKind.Select : CursorKind.Default;
  }
  return resolution.cursor;
}

/* ==========================================================================
 * 8. THE SYSTEM MODULE
 * ========================================================================== */

export default defineSystem({
  id: 'input',
  // Last in Phase.Command: a real orders module registers at order 0, drains
  // first, and leaves our fallback with nothing to do.
  phase: Phase.Command,
  renderPhase: RenderPhase.Overlay,
  order: 9000,

  async init(): Promise<void> {
    const { world, channels, sceneRig, cameraRig, handle } = ctx();

    selection = new Selection(world, channels);
    cameraBookmarks.fill(null);
    lastIdleHarvester = NONE;
    executor = new OrderExecutor(world, channels);
    overlay = new Overlay(sceneRig.scene);
    (globalThis as unknown as { __vmInputCommands?: typeof HUD_COMMAND_SERVICE })
      .__vmInputCommands = HUD_COMMAND_SERVICE;

    // Resolve the order hotkeys against the live settings store, and keep
    // resolving them: a rebind on the Options screen takes effect on the next
    // keystroke without a rebuild.
    bindSettings();

    const element = handle.canvas;
    projector = new RigProjector(cameraRig, element);

    // Take the keyboard (and the rest of the camera input) off the rig — see
    // the header. Everything the rig used to do for itself now runs in
    // `updateCamera` on keys that leave A/S/G/X free for orders.
    cameraRig.detachInput();

    input = new InputManager({
      element,
      ground: (x, y, out) => {
        const v = SCRATCH_V.set(0, 0, 0);
        if (!cameraRig.screenToGround(x, y, v)) return false;
        out[0] = v.x;
        out[1] = v.y;
        out[2] = v.z;
        return true;
      },
      handlers,
    });

    // Real def tables let us answer "is this an engineer / a transport" from
    // content instead of from heuristics. Absent, the heuristics stand.
    try {
      const binding = await resolveDefBinding();
      if (binding.tables !== null && binding.tables !== undefined) {
        setRoleResolver(makeDefRoleResolver(binding.tables));
        // Kept for `buildingDisplayName`, so a refused garrison can name the
        // building it was refused by. Without it the toast still fires and
        // still explains the rule; it just cannot say which wall they hit.
        defTables = binding.tables;
      }
    } catch {
      // No def module yet. HEURISTIC_ROLES is a working answer, not a stub.
    }

    // Dead units must leave the selection the moment they die, not on the next
    // pointer move — the portrait would otherwise show a smoking hole.
    unsubscribeKilled = channels.events.on('entity:killed', () => {
      selection?.pruneDead();
    });
  },

  /** Fallback order application. Runs last in Phase.Command. */
  simTick(): void {
    executor?.tick();
  },

  frame(r: RenderContext): void {
    if (input === null || selection === null || overlay === null) return;
    const { world, debug } = ctx();

    // The HUD mounts one phase after us, so its overlay canvas is claimed on
    // the first frame rather than in init().
    linkHud();

    updateCamera(r.dt);
    selection.pruneDead();

    // The camera moves every frame, so what is under the cursor changes even
    // when the mouse is perfectly still.
    refreshResolution();

    input.setCursor(chooseCursor());
    input.flushCursor();

    overlay.updateMarkers(r.dt);

    debug.counters.selected = world.selection.count;
    debug.counters.orders = executor !== null ? executor.ordersApplied : 0;
  },

  dispose(): void {
    unbindSettings();
    unsubscribeKilled?.();
    unsubscribeKilled = null;
    linkedHud?.minimap?.onOrderRequest?.(null);
    linkedHud = null;
    input?.dispose();
    input = null;
    // `Selection.dispose` gives the `Hovered` bit back; tell the overlay too, or
    // it holds a handle nobody will ever clear. (It re-checks the flag, so this
    // is belt and braces rather than a live bug.)
    hud()?.overlay.setHoveredEntity?.(NONE);
    selection?.dispose();
    selection = null;
    overlay?.dispose();
    overlay = null;
    executor = null;
    projector = null;
    cameraBookmarks.fill(null);
    lastIdleHarvester = NONE;
    setCommandMode(CommandMode.None);
    const commandGlobal = globalThis as unknown as {
      __vmInputCommands?: typeof HUD_COMMAND_SERVICE;
    };
    if (commandGlobal.__vmInputCommands === HUD_COMMAND_SERVICE) {
      delete commandGlobal.__vmInputCommands;
    }
    panning = false;
  },
});

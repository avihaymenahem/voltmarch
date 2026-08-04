/**
 * VOLTMARCH — src/render/camera.ts
 * =============================================================================
 * The RTS camera rig, and the navigation scheme that drives it.
 *
 * MODEL
 * -----
 * The rig owns a ground-plane FOCUS point (x, z) and orbits a perspective
 * camera above it at a fixed pitch and a free yaw. There is no free-look, no
 * roll, and no way to get under the terrain — the pitch is a config value and
 * the only way to change it is to change the config. That constraint is what
 * makes every screenshot of this game look like the same game.
 *
 * Pitch breathes slightly with zoom (46 deg zoomed in -> 58 deg zoomed out).
 * Zoomed in you want to see the sides of tanks; zoomed out you want the map.
 *
 * DAMPING
 * -------
 * Every smoothed value uses `1 - exp(-rate * dt)`, which is frame-rate
 * independent. A naive `lerp(a, b, 0.1)` is 3x faster at 165 fps than at 60,
 * and that is exactly the class of bug that makes a game feel different on
 * someone else's machine.
 *
 * =============================================================================
 * NAVIGATION — why this file was rewritten
 * =============================================================================
 * The old scheme was WASD, an 8 px screen-edge band, middle-drag, and `wheel`
 * bound unconditionally to zoom. On a desktop with a mouse that is fine. On a
 * MacBook — which is what this game is actually played on — it is close to
 * worst case:
 *
 *   - The pointer is a TRACKPAD. The cursor ends up at a screen edge every time
 *     the player reaches for the sidebar or the tactical map, so edge panning
 *     fires constantly and unintentionally. It is now OFF by default.
 *   - A two-finger swipe — the single most natural pan gesture on the machine —
 *     arrives as a `wheel` event with `deltaX` and `deltaY`. Binding `wheel` to
 *     zoom meant the pan gesture zoomed. THIS is the headline bug.
 *   - macOS pinch-to-zoom arrives as a `wheel` event with `ctrlKey: true`. It
 *     was not handled at all.
 *   - There is no middle button, so the only drag-pan was unreachable.
 *
 * So `wheel` is no longer one gesture. It is three, and which one you get
 * depends on the event:
 *
 *   ctrlKey             -> PINCH ZOOM        (macOS pinch, and ctrl+wheel)
 *   trackpad, no ctrl   -> TWO-FINGER PAN    (deltaX/deltaY across the ground)
 *   mouse wheel         -> DOLLY toward the cursor, exactly as before
 *
 * Distinguishing the last two is a heuristic — see `classifyWheelEvent`, which
 * is exported and unit-tested precisely because it is a heuristic. It is also
 * overridable from Options, because heuristics are never perfect and a player
 * stuck in the wrong mode must be able to say so.
 *
 * Drag-pan now has three bindings, all of which reach the same world-grab:
 * MIDDLE-drag, SPACE+left-drag, and RIGHT-drag past a threshold. The threshold
 * is what keeps right-drag from eating orders: a right-click that never moves
 * is still an order, and only once the pointer has travelled
 * `dragPanThresholdPx` does the gesture become a pan (see `commitRightDrag`
 * for how the order layer is told to let go).
 *
 * Panning carries a little inertia and settles rather than stopping dead. The
 * momentum lives in `update()` and is fed by an accumulator inside `panBy`, so
 * EVERY pan source inherits it — including callers outside this file.
 *
 * INPUT OWNERSHIP
 * ---------------
 * The rig ships with its own listeners so the camera is alive on frame one.
 * `src/input/input.system.ts` calls `detachInput()` during a match because it
 * needs the KEYBOARD (A/S/G/X are orders, not pan keys) and it owns selection
 * and orders on the left and right buttons.
 *
 * `detachInput()` therefore now defaults to `{ keepNavigation: true }`: it
 * hands back the keyboard and the order buttons and KEEPS the pure navigation
 * surfaces — wheel, pinch, middle-drag, space-drag, right-drag-past-threshold,
 * edge pan. Without that, every gesture above would be dead in the only place
 * that matters, which is during a game. Pass `{ keepNavigation: false }` for
 * the old all-or-nothing behaviour; `dispose()` does.
 *
 * To make that co-existence safe the navigation listeners are installed on
 * `window` in the CAPTURE phase and filtered to events whose target is inside
 * our own element. Window-capture runs before anything bound on the canvas, so
 * a gesture the rig claims can be stopped before the order layer ever sees it —
 * which is what stops the wheel being handled twice.
 *
 * ALLOCATION
 * ----------
 * `update()`, `screenToGround()` and every listener allocate nothing. All
 * scratch is module or instance level. The one exception is the synthetic
 * `PointerEvent` in `commitRightDrag`, which happens once per right-drag.
 */

import * as THREE from 'three';
import { CAMERA_NAV } from '../core/config';
import { RENDER_CONFIG, onConfigChanged, touched, dampFactor } from './renderer';

/* -------------------------------------------------------------------------- */

export interface CameraPose {
  /** Ground focus point. */
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
}

export type GroundHeightFn = (x: number, z: number) => number;

/** How the rig is currently listening. */
export type CameraInputMode = 'full' | 'navigation' | 'none';

export interface CreateCameraOptions {
  /** Element that receives pointer/wheel listeners. Usually the canvas. */
  domElement: HTMLElement;
  /** Attach the built-in input listeners immediately. Default true. */
  attachInput?: boolean;
  /** Initial focus. Defaults to the middle of a 512 m map. */
  focusX?: number;
  focusZ?: number;
  aspect?: number;
}

const KEY_PAN_LEFT = new Set(['KeyA', 'ArrowLeft']);
const KEY_PAN_RIGHT = new Set(['KeyD', 'ArrowRight']);
const KEY_PAN_UP = new Set(['KeyW', 'ArrowUp']);
const KEY_PAN_DOWN = new Set(['KeyS', 'ArrowDown']);
const KEY_YAW_LEFT = new Set(['KeyQ']);
const KEY_YAW_RIGHT = new Set(['KeyE']);
const KEY_HOME = new Set(['KeyH', 'Home']);

const MOUSE_LEFT = 0;
const MOUSE_MIDDLE = 1;
const MOUSE_RIGHT = 2;

/* ==========================================================================
 * TRACKPAD vs MOUSE
 *
 * A `wheel` event does not say what produced it. The browser gives us four
 * usable signals and none of them is decisive on its own, so this is a running
 * SCORE rather than a per-event verdict: one wheel notch and one frame of a
 * trackpad fling can look identical, but a hundred of them never do.
 *
 *   deltaMode   Firefox reports 1 (lines) for a wheel and 0 (pixels) for a
 *               trackpad. When it is not 0 the answer is simply "mouse".
 *   deltaX      A wheel has one axis. A trackpad has two, and a human swipe is
 *               never perfectly axis-aligned, so any horizontal component at
 *               all is strong trackpad evidence.
 *   magnitude   Wheel detents are coarse and land on browser constants — 100
 *               and 120 on Chrome/Edge, and exact multiples when events
 *               coalesce. Trackpad samples are small and often fractional,
 *               because they come from a scaled physical distance.
 *   rate        A trackpad streams at display refresh. Detents are isolated
 *               even from a fast scroller.
 *
 * The known blind spot, stated plainly because the override exists for it: a
 * MOUSE WHEEL ON macOS, where the OS applies scroll acceleration and Chrome
 * reports small integer deltas that look exactly like a slow trackpad swipe.
 * That is why Options carries Auto / Force Trackpad / Force Mouse.
 * ========================================================================== */

export type PointerDeviceKind = 'mouse' | 'trackpad';
export type PointerDeviceMode = 'auto' | PointerDeviceKind;

/** The four fields of a `WheelEvent` the classifier reads. */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  /** `WheelEvent.timeStamp`, milliseconds, monotonic. */
  timeStamp: number;
}

export interface WheelDeviceState {
  /** −1 = certainly a mouse, +1 = certainly a trackpad. */
  score: number;
  kind: PointerDeviceKind;
  lastTime: number;
  seen: number;
}

export function createWheelDeviceState(): WheelDeviceState {
  // A fresh session assumes a mouse: it is the safer wrong answer, because a
  // desktop player who gets a pan instead of a zoom has lost their bearings,
  // while a laptop player who gets a zoom on the first flick self-corrects on
  // the second event.
  return { score: 0, kind: 'mouse', lastTime: 0, seen: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Signed evidence for one event. Positive is trackpad, negative is mouse. */
function wheelEvidence(s: WheelSample, gapMs: number): number {
  // Line- and page-mode scrolling is the legacy mouse path and nothing else
  // produces it. No other signal can outvote this one.
  if (s.deltaMode !== 0) return -2;

  const ax = Math.abs(s.deltaX);
  const ay = Math.abs(s.deltaY);
  let ev = 0;

  if (ax > 0) ev += 0.9;
  if (!Number.isInteger(s.deltaY) || !Number.isInteger(s.deltaX)) ev += 0.9;

  if (ay >= CAMERA_NAV.coarseDeltaPx) ev -= 0.9;
  else if (ay > 0 && ay < CAMERA_NAV.fineDeltaPx) ev += 0.6;

  // The browser wheel constants. Nothing organic lands on an exact multiple of
  // 100 or 120 with no horizontal component.
  if (ax === 0 && ay >= 100 && (ay % 100 === 0 || ay % 120 === 0)) ev -= 1.4;

  if (gapMs < CAMERA_NAV.streakGapMs) ev += 0.7;
  else if (gapMs > CAMERA_NAV.isolatedGapMs) ev -= 0.4;

  return ev;
}

/**
 * Fold one wheel event into the running device verdict. Mutates `state` and
 * returns the current answer.
 *
 * The FIRST event of a session is decided on its evidence alone, with no
 * hysteresis: there is no running score to lean on yet, and the first gesture a
 * player makes is the one that decides whether the controls feel broken.
 */
export function classifyWheelEvent(s: WheelSample, state: WheelDeviceState): PointerDeviceKind {
  const gap = state.seen === 0 ? Infinity : Math.max(0, s.timeStamp - state.lastTime);
  const ev = wheelEvidence(s, gap);
  state.lastTime = s.timeStamp;

  if (state.seen === 0) {
    state.seen = 1;
    state.score = clamp(ev, -1, 1);
    state.kind = ev > 0 ? 'trackpad' : 'mouse';
    return state.kind;
  }

  state.seen++;
  state.score = clamp(
    state.score + clamp(ev, -1.6, 1.6) * CAMERA_NAV.deviceScoreBlend,
    -1,
    1,
  );
  if (state.score > CAMERA_NAV.deviceFlipScore) state.kind = 'trackpad';
  else if (state.score < -CAMERA_NAV.deviceFlipScore) state.kind = 'mouse';
  return state.kind;
}

/* ==========================================================================
 * NAVIGATION OPTIONS
 *
 * These are the PLAYER-FACING knobs. `RENDER_CONFIG.camera` stays what it has
 * always been — where the camera is and how fast it damps — and this is how a
 * human asks it to move. Options writes here through `setNavigation`.
 * ========================================================================== */

export interface NavigationOptions {
  /** Auto-detect the pointing device, or force one. */
  pointerDevice: PointerDeviceMode;
  /** Multiplier on two-finger trackpad pan. 1 = the ground tracks the fingers. */
  trackpadPanSensitivity: number;
  /** Multiplier on mouse-wheel zoom notches. */
  wheelZoomSensitivity: number;
  /** Notches of zoom per unit of pinch `deltaY`. */
  pinchZoomSensitivity: number;
  /** Multiplier on drag-pan and keyboard pan. */
  dragPanSensitivity: number;
  invertPanX: boolean;
  invertPanY: boolean;
  invertZoom: boolean;
  /**
   * false = WORLD GRAB: the ground point under the cursor stays pinned, so the
   * map follows your finger. true = the CAMERA follows your finger instead,
   * which is what players coming from a first-person game expect.
   */
  invertDragPan: boolean;
  momentum: boolean;
  /** Exponential decay of the coast, per second. */
  momentumDamping: number;
  /** Pixels a right-drag must travel before it stops being an order. */
  dragPanThresholdPx: number;
  /** How fast keyboard pan ramps to full speed, per second. */
  keyAccelRate: number;
  enableMiddleDrag: boolean;
  enableSpaceDrag: boolean;
  enableRightDrag: boolean;
  /** Seconds an inward pointer movement keeps edge panning armed. */
  edgeIntentSeconds: number;
  /** Seconds any pointer movement keeps an already-armed edge alive. */
  edgeIdleSeconds: number;
}

export function defaultNavigationOptions(): NavigationOptions {
  return {
    pointerDevice: 'auto',
    trackpadPanSensitivity: CAMERA_NAV.trackpadPanSensitivity,
    wheelZoomSensitivity: CAMERA_NAV.wheelZoomSensitivity,
    pinchZoomSensitivity: CAMERA_NAV.pinchZoomSensitivity,
    dragPanSensitivity: 1.0,
    invertPanX: false,
    invertPanY: false,
    invertZoom: false,
    invertDragPan: false,
    momentum: CAMERA_NAV.momentum,
    momentumDamping: CAMERA_NAV.momentumDamping,
    dragPanThresholdPx: CAMERA_NAV.dragPanThresholdPx,
    keyAccelRate: CAMERA_NAV.keyAccelRate,
    enableMiddleDrag: true,
    enableSpaceDrag: true,
    enableRightDrag: true,
    edgeIntentSeconds: CAMERA_NAV.edgeIntentMs / 1000,
    edgeIdleSeconds: CAMERA_NAV.edgeIdleMs / 1000,
  };
}

/** Which binding started the current drag-pan. */
const DRAG_NONE = 0;
const DRAG_MIDDLE = 1;
const DRAG_SPACE = 2;
const DRAG_RIGHT = 3;

/* -------------------------------------------------------------------------- */

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;

  /** Smoothed, rendered focus point on the ground plane. */
  readonly focus = new THREE.Vector3();
  /** Where the focus is heading. Input writes here. */
  readonly targetFocus = new THREE.Vector3();

  yaw: number;
  targetYaw: number;
  distance: number;
  targetDistance: number;
  /** Derived from distance; read-only in practice. */
  pitch: number;

  /** 0..1 trauma; decays. VFX pushes into this via addShake(). */
  private shakeTrauma = 0;
  private shakeTime = 0;

  private groundHeightFn: GroundHeightFn | null = null;

  private readonly keys = new Set<string>();
  private spaceDown = false;
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private attached = false;
  private enabled = true;
  private inputEnabled = true;
  private disposed = false;
  private inputMode: CameraInputMode = 'none';
  private readonly unsubscribeConfig: () => void;

  // --- navigation state ----------------------------------------------------
  private readonly nav: NavigationOptions = defaultNavigationOptions();
  private readonly wheelDevice: WheelDeviceState = createWheelDeviceState();

  /** Active drag-pan: which binding, which pointer, and the pinned ground pt. */
  private dragKind = DRAG_NONE;
  private dragPointerId = -1;
  private readonly dragAnchor = new THREE.Vector3();
  /** A right-button press that has not yet travelled far enough to be a pan. */
  private pendingRight = false;
  private pendingRightId = -1;
  private pendingRightX = 0;
  private pendingRightY = 0;
  /** Guard so our own synthetic `pointercancel` is not mistaken for a real one. */
  private synthesizing = false;

  /** Momentum: world m/s, plus the per-frame input accumulator that feeds it. */
  private panVelX = 0;
  private panVelZ = 0;
  private panAccumX = 0;
  private panAccumZ = 0;
  /** Frames of grace after a trackpad pan before the coast takes over. */
  private wheelPanGrace = 0;

  /** 0..1 keyboard pan ramp — this is the "smooth acceleration". */
  private keyRamp = 0;

  /** Edge-pan arming. Timers count down in `update`, so no clock is needed. */
  private edgeSignX = 0;
  private edgeSignZ = 0;
  private edgeTimerX = 0;
  private edgeTimerZ = 0;

  /** Where "centre on my base" goes. Seeded with the initial focus. */
  private homeX = 0;
  private homeZ = 0;

  // --- scratch (never allocate in update) ---------------------------------
  private readonly _v = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _ndc = new THREE.Vector3();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _offset = new THREE.Vector3();
  private readonly _shakeOffset = new THREE.Vector3();
  private readonly _rect = { left: 0, top: 0, width: 1, height: 1 };
  private readonly _mpp = { h: 1, v: 1 };

  constructor(options: CreateCameraOptions) {
    const cfg = RENDER_CONFIG.camera;
    this.domElement = options.domElement;

    this.camera = new THREE.PerspectiveCamera(
      cfg.fov,
      options.aspect ?? (options.domElement.clientWidth || 1) / (options.domElement.clientHeight || 1),
      cfg.near,
      cfg.far
    );
    this.camera.name = 'RtsCamera';
    this.camera.up.set(0, 1, 0);

    this.yaw = this.targetYaw = THREE.MathUtils.degToRad(cfg.yaw);
    this.distance = this.targetDistance = cfg.distance;
    this.pitch = THREE.MathUtils.degToRad(cfg.pitch);

    const fx = options.focusX ?? 256;
    const fz = options.focusZ ?? 256;
    this.focus.set(fx, 0, fz);
    this.targetFocus.copy(this.focus);
    this.homeX = fx;
    this.homeZ = fz;

    this.unsubscribeConfig = onConfigChanged((changed) => {
      if (touched(changed, 'camera.fov')) {
        this.camera.fov = RENDER_CONFIG.camera.fov;
        this.camera.updateProjectionMatrix();
      }
      if (touched(changed, 'camera.near') || touched(changed, 'camera.far')) {
        this.camera.near = RENDER_CONFIG.camera.near;
        this.camera.far = RENDER_CONFIG.camera.far;
        this.camera.updateProjectionMatrix();
      }
      if (touched(changed, 'camera.distance')) {
        this.targetDistance = RENDER_CONFIG.camera.distance;
      }
      if (touched(changed, 'camera.pitch') || touched(changed, 'camera.pitchAtMinDistance') || touched(changed, 'camera.pitchAtMaxDistance')) {
        this.applyImmediate();
      }
    });

    this.applyImmediate();
    if (options.attachInput !== false) this.attachInput();
  }

  /* ---------------------------------------------------------------------- */
  /* Public API                                                             */
  /* ---------------------------------------------------------------------- */

  setAspect(width: number, height: number): void {
    const a = Math.max(1e-3, width / Math.max(1, height));
    if (Math.abs(this.camera.aspect - a) < 1e-6) return;
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** Terrain module installs this so the camera hugs plateaus. */
  setGroundHeightFn(fn: GroundHeightFn | null): void {
    this.groundHeightFn = fn;
  }

  /** Master switch: false freezes the rig entirely (used by ShotDirector). */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.keys.clear();
      this.abortDrag();
      this.stopMomentum();
    }
  }

  /** Disable only the input, keeping damping/update alive. */
  setInputEnabled(v: boolean): void {
    this.inputEnabled = v;
    if (!v) {
      this.keys.clear();
      this.spaceDown = false;
      this.abortDrag();
      this.stopMomentum();
    }
  }

  /* -- navigation ---------------------------------------------------------- */

  /** Merge player-facing control preferences. Unlisted fields are untouched. */
  setNavigation(patch: Partial<NavigationOptions>): void {
    for (const key of Object.keys(patch) as Array<keyof NavigationOptions>) {
      const value = patch[key];
      if (value === undefined) continue;
      // Each field is assigned through its own narrowed branch; a blanket cast
      // would let a boolean land in a number field and never be caught.
      switch (key) {
        case 'pointerDevice':
          this.nav.pointerDevice = value as PointerDeviceMode;
          // A forced mode must not be second-guessed by stale auto evidence.
          this.resetDeviceDetection();
          break;
        case 'trackpadPanSensitivity': this.nav.trackpadPanSensitivity = value as number; break;
        case 'wheelZoomSensitivity': this.nav.wheelZoomSensitivity = value as number; break;
        case 'pinchZoomSensitivity': this.nav.pinchZoomSensitivity = value as number; break;
        case 'dragPanSensitivity': this.nav.dragPanSensitivity = value as number; break;
        case 'momentumDamping': this.nav.momentumDamping = value as number; break;
        case 'dragPanThresholdPx': this.nav.dragPanThresholdPx = value as number; break;
        case 'keyAccelRate': this.nav.keyAccelRate = value as number; break;
        case 'edgeIntentSeconds': this.nav.edgeIntentSeconds = value as number; break;
        case 'edgeIdleSeconds': this.nav.edgeIdleSeconds = value as number; break;
        case 'invertPanX': this.nav.invertPanX = value as boolean; break;
        case 'invertPanY': this.nav.invertPanY = value as boolean; break;
        case 'invertZoom': this.nav.invertZoom = value as boolean; break;
        case 'invertDragPan': this.nav.invertDragPan = value as boolean; break;
        case 'momentum':
          this.nav.momentum = value as boolean;
          if (!this.nav.momentum) this.stopMomentum();
          break;
        case 'enableMiddleDrag': this.nav.enableMiddleDrag = value as boolean; break;
        case 'enableSpaceDrag': this.nav.enableSpaceDrag = value as boolean; break;
        case 'enableRightDrag': this.nav.enableRightDrag = value as boolean; break;
        default: break;
      }
    }
  }

  getNavigation(): Readonly<NavigationOptions> {
    return this.nav;
  }

  /** What the rig currently believes it is being pointed at with. */
  get pointerDevice(): PointerDeviceKind {
    return this.nav.pointerDevice === 'auto' ? this.wheelDevice.kind : this.nav.pointerDevice;
  }

  /** Throw away the accumulated wheel evidence and start detecting again. */
  resetDeviceDetection(): void {
    this.wheelDevice.score = 0;
    this.wheelDevice.kind = 'mouse';
    this.wheelDevice.lastTime = 0;
    this.wheelDevice.seen = 0;
  }

  get inputListeningMode(): CameraInputMode {
    return this.inputMode;
  }

  /* -- pose ---------------------------------------------------------------- */

  setFocus(x: number, z: number, immediate = false): void {
    this.targetFocus.set(x, this.targetFocus.y, z);
    this.clampFocus(this.targetFocus);
    // A jump is not a pan: a minimap click must not leave the camera coasting
    // past the point the player asked for.
    this.stopMomentum();
    if (immediate) {
      this.focus.copy(this.targetFocus);
      this.applyImmediate();
    }
  }

  /**
   * Move the focus in WORLD metres. This is the one pan every other module
   * calls, so it is also where momentum is sampled from — an arrow-key pan
   * driven by `input.system.ts` inherits the same inertia as a trackpad swipe
   * without that file knowing momentum exists.
   */
  panBy(dx: number, dz: number): void {
    this.applyPan(dx, dz, true);
  }

  /** Pan in the camera's ground-projected right/forward basis, in metres. */
  panScreenBy(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.applyPan(right * c + forward * s, right * -s + forward * c, true);
  }

  /**
   * Pan by SCREEN pixels — the trackpad's unit. Converts through the ground
   * plane at the current dolly, so one pixel of swipe is one pixel of ground
   * at every zoom level and every pitch.
   */
  panPixels(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    const mpp = this.metresPerPixel();
    this.panScreenBy(dxPx * mpp.h, dyPx * mpp.v);
  }

  setDistance(d: number, immediate = false): void {
    const cfg = RENDER_CONFIG.camera;
    this.targetDistance = THREE.MathUtils.clamp(d, cfg.minDistance, cfg.maxDistance);
    if (immediate) {
      this.distance = this.targetDistance;
      this.applyImmediate();
    }
  }

  zoomBy(notches: number): void {
    const cfg = RENDER_CONFIG.camera;
    this.setDistance(this.targetDistance * Math.pow(cfg.zoomStep, notches));
  }

  setYaw(radians: number, immediate = false): void {
    this.targetYaw = radians;
    if (immediate) {
      this.yaw = radians;
      this.applyImmediate();
    }
  }

  /** Where "centre on base" goes. The game sets this when the base is placed. */
  setHome(x: number, z: number): void {
    this.homeX = x;
    this.homeZ = z;
  }

  getHome(out: THREE.Vector2): THREE.Vector2 {
    return out.set(this.homeX, this.homeZ);
  }

  /** Glide to the home point. Not immediate — the travel is the orientation. */
  centreOnHome(): void {
    this.setFocus(this.homeX, this.homeZ, false);
  }

  /** Kill any coast. Called by every non-pan focus change. */
  stopMomentum(): void {
    this.panVelX = 0;
    this.panVelZ = 0;
    this.panAccumX = 0;
    this.panAccumZ = 0;
    this.wheelPanGrace = 0;
  }

  /**
   * Full programmatic pose — this is what the screenshot harness drives.
   * `immediate` defaults to TRUE: a scripted pose must not be mid-damping when
   * the very next statement grabs a screenshot.
   *
   * Passing `pitch: null` releases an explicit pitch back to the zoom curve.
   */
  setPose(pose: Partial<CameraPose> & { pitch?: number | null; immediate?: boolean }): void {
    const cfg = RENDER_CONFIG.camera;
    this.stopMomentum();
    if (pose.x !== undefined) this.targetFocus.x = pose.x;
    if (pose.z !== undefined) this.targetFocus.z = pose.z;
    this.clampFocus(this.targetFocus);
    if (pose.yaw !== undefined) this.targetYaw = pose.yaw;
    if (pose.distance !== undefined) {
      this.targetDistance = THREE.MathUtils.clamp(pose.distance, cfg.minDistance, cfg.maxDistance);
    }
    if (pose.pitch === null) {
      this.pitchOverride = null;
    } else if (pose.pitch !== undefined) {
      // An explicit pitch pins the camera until the player zooms with the
      // wheel or someone passes `pitch: null`.
      this.pitch = pose.pitch;
      this.pitchOverride = pose.pitch;
    }
    if (pose.immediate !== false) {
      this.focus.copy(this.targetFocus);
      this.yaw = this.targetYaw;
      this.distance = this.targetDistance;
      // Snap the focus height too, or the first scripted frame is still
      // easing vertically toward the terrain.
      this.focus.y = this.groundHeightFn ? this.groundHeightFn(this.focus.x, this.focus.z) : 0;
      this.applyImmediate();
    }
  }

  /** Hand pitch control back to the zoom curve. */
  clearPitchOverride(): void {
    this.pitchOverride = null;
  }

  getPose(out?: CameraPose): CameraPose {
    const o = out ?? ({} as CameraPose);
    o.x = this.focus.x;
    o.z = this.focus.z;
    o.yaw = this.yaw;
    o.pitch = this.pitch;
    o.distance = this.distance;
    return o;
  }

  /** Additive screen shake. 0..1; explosions push ~0.35, nukes 1.0. */
  addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  setBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const b = RENDER_CONFIG.camera.bounds;
    b.minX = minX;
    b.minZ = minZ;
    b.maxX = maxX;
    b.maxZ = maxZ;
    this.clampFocus(this.targetFocus);
  }

  /* ---------------------------------------------------------------------- */
  /* Picking                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Unproject a client-space point onto the ground plane.
   * Returns false when the ray points at or above the horizon.
   *
   * With a groundHeightFn installed this does two refinement iterations, which
   * is enough to be pixel-accurate on RA2-style plateaus without a raymarch.
   */
  screenToGround(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    const rect = this.readRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);

    this._origin.setFromMatrixPosition(this.camera.matrixWorld);
    this._ndc.set(nx, ny, 0.5).unproject(this.camera);
    this._dir.copy(this._ndc).sub(this._origin).normalize();

    if (this._dir.y > -1e-5) return false;

    let planeY = 0;
    for (let iter = 0; iter < (this.groundHeightFn ? 3 : 1); iter++) {
      const t = (planeY - this._origin.y) / this._dir.y;
      if (!(t > 0) || t > 1e6) return false;
      out.copy(this._dir).multiplyScalar(t).add(this._origin);
      if (!this.groundHeightFn) return true;
      const h = this.groundHeightFn(out.x, out.z);
      if (Math.abs(h - planeY) < 0.01) {
        out.y = h;
        return true;
      }
      planeY = h;
    }
    out.y = planeY;
    return true;
  }

  /** Convenience: normalized-device coordinates for a world point. */
  worldToScreen(world: THREE.Vector3, out: THREE.Vector2): boolean {
    this._v.copy(world).project(this.camera);
    const rect = this.readRect();
    out.x = (this._v.x * 0.5 + 0.5) * rect.width + rect.left;
    out.y = (-this._v.y * 0.5 + 0.5) * rect.height + rect.top;
    return this._v.z < 1;
  }

  /**
   * Ground metres per CSS pixel at the current dolly.
   *
   * Horizontal is exact: the camera's ground-projected right vector is parallel
   * to the image plane's right vector, so it is just the frustum width at the
   * focus distance divided by the viewport width.
   *
   * Vertical is the same frustum height divided by `sin(pitch)`, because the
   * ground is tilted away from the image plane by exactly the pitch — at 52
   * degrees a pixel of screen travel is 1/0.79 = 1.27 pixels of ground. Without
   * that term a two-finger pan drifts under your fingers vertically but not
   * horizontally, which feels like the camera is fighting you.
   */
  private metresPerPixel(): { h: number; v: number } {
    const rect = this.readRect();
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) * this.distance;
    this._mpp.h = (2 * halfHeight * this.camera.aspect) / rect.width;
    // Guard the near-horizontal case; the rig never gets there, but a config
    // edit could, and a division by ~0 would fling the camera off the map.
    this._mpp.v = (2 * halfHeight) / rect.height / Math.max(0.2, Math.sin(this.pitch));
    return this._mpp;
  }

  /* ---------------------------------------------------------------------- */
  /* Frame update                                                           */
  /* ---------------------------------------------------------------------- */

  private pitchOverride: number | null = null;

  update(dt: number): void {
    if (this.disposed) return;
    const cfg = RENDER_CONFIG.camera;
    const d = Math.min(dt, 0.1); // never integrate a tab-switch hitch

    if (this.enabled && this.inputEnabled) {
      this.applyKeyboard(d);
      this.applyEdgePan(d);
    } else {
      this.keyRamp = 0;
    }

    this.integrateMomentum(d);
    this.decayEdgeIntent(d);

    // --- damping ---------------------------------------------------------
    const kPan = dampFactor(cfg.panDamping, d);
    const kZoom = dampFactor(cfg.zoomDamping, d);
    const kYaw = dampFactor(cfg.rotateDamping, d);

    this.clampFocus(this.targetFocus);
    this.focus.x += (this.targetFocus.x - this.focus.x) * kPan;
    this.focus.z += (this.targetFocus.z - this.focus.z) * kPan;
    this.distance += (this.targetDistance - this.distance) * kZoom;

    // Shortest-arc yaw so crossing +-PI does not spin the world.
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * kYaw;

    // --- shake -----------------------------------------------------------
    if (this.shakeTrauma > 0) {
      this.shakeTime += d;
      this.shakeTrauma = Math.max(0, this.shakeTrauma - d * 1.6);
      const s = this.shakeTrauma * this.shakeTrauma; // quadratic falloff
      const t = this.shakeTime * 34;
      this._shakeOffset.set(
        Math.sin(t * 1.13) * s * 0.9,
        Math.sin(t * 1.71 + 1.7) * s * 0.55,
        Math.sin(t * 0.97 + 3.1) * s * 0.9
      );
    } else {
      this._shakeOffset.set(0, 0, 0);
    }

    this.applyImmediate();
  }

  /**
   * The momentum integrator, and the reason `panBy` records an accumulator.
   *
   * While ANY source is feeding pan this frame, the velocity estimate tracks
   * it. The frame the input stops, the estimate becomes a coast that decays
   * exponentially — frame-rate independent, and identical whether the pan came
   * from a trackpad, a drag, the arrow keys, or another module calling `panBy`.
   *
   * A held drag with a motionless finger tracks toward ZERO rather than
   * coasting, so parking the cursor mid-drag and letting go does not fling the
   * camera with a velocity from half a second ago.
   */
  private integrateMomentum(d: number): void {
    const nav = this.nav;
    const driving = this.panAccumX !== 0 || this.panAccumZ !== 0;

    if (this.wheelPanGrace > 0) this.wheelPanGrace--;

    if (driving || this.dragKind !== DRAG_NONE || this.wheelPanGrace > 0) {
      const k = 1 - Math.exp(-CAMERA_NAV.momentumTrackRate * d);
      this.panVelX += (this.panAccumX / d - this.panVelX) * k;
      this.panVelZ += (this.panAccumZ / d - this.panVelZ) * k;
      this.panAccumX = 0;
      this.panAccumZ = 0;
      this.clampVelocity();
      return;
    }

    this.panAccumX = 0;
    this.panAccumZ = 0;

    if (!nav.momentum || !this.enabled) {
      this.panVelX = 0;
      this.panVelZ = 0;
      return;
    }

    const speed = Math.hypot(this.panVelX, this.panVelZ);
    if (speed <= CAMERA_NAV.momentumMinSpeed) {
      this.panVelX = 0;
      this.panVelZ = 0;
      return;
    }

    this.applyPan(this.panVelX * d, this.panVelZ * d, false);
    const decay = Math.exp(-nav.momentumDamping * d);
    this.panVelX *= decay;
    this.panVelZ *= decay;
  }

  private clampVelocity(): void {
    const max = CAMERA_NAV.momentumMaxSpeed;
    const speed = Math.hypot(this.panVelX, this.panVelZ);
    if (speed > max) {
      const k = max / speed;
      this.panVelX *= k;
      this.panVelZ *= k;
    }
  }

  private decayEdgeIntent(d: number): void {
    if (this.edgeTimerX > 0) {
      this.edgeTimerX -= d;
      if (this.edgeTimerX <= 0) this.edgeSignX = 0;
    }
    if (this.edgeTimerZ > 0) {
      this.edgeTimerZ -= d;
      if (this.edgeTimerZ <= 0) this.edgeSignZ = 0;
    }
  }

  /** Recompose the camera transform from the current state. */
  private applyImmediate(): void {
    const cfg = RENDER_CONFIG.camera;

    // Ground height under the focus so the camera rides plateaus.
    const groundY = this.groundHeightFn ? this.groundHeightFn(this.focus.x, this.focus.z) : 0;
    this.focus.y += (groundY - this.focus.y) * 0.25;

    // Pitch interpolates with zoom unless explicitly overridden.
    if (this.pitchOverride !== null) {
      this.pitch = this.pitchOverride;
    } else {
      const t = THREE.MathUtils.clamp(
        (this.distance - cfg.minDistance) / Math.max(1e-3, cfg.maxDistance - cfg.minDistance),
        0,
        1
      );
      const deg = THREE.MathUtils.lerp(cfg.pitchAtMinDistance, cfg.pitchAtMaxDistance, t * t * (3 - 2 * t));
      this.pitch = THREE.MathUtils.degToRad(deg);
    }

    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    // yaw 0 => camera sits on +Z of the focus, looking toward -Z.
    this._offset.set(Math.sin(this.yaw) * cosP, sinP, Math.cos(this.yaw) * cosP).multiplyScalar(this.distance);

    this.camera.position.copy(this.focus).add(this._offset).add(this._shakeOffset);
    this._v2.copy(this.focus).add(this._shakeOffset);
    this.camera.lookAt(this._v2);
    this.camera.updateMatrixWorld();
  }

  private clampFocus(v: THREE.Vector3): void {
    const b = RENDER_CONFIG.camera.bounds;
    if (v.x < b.minX) v.x = b.minX;
    else if (v.x > b.maxX) v.x = b.maxX;
    if (v.z < b.minZ) v.z = b.minZ;
    else if (v.z > b.maxZ) v.z = b.maxZ;
  }

  /** The single write path for the focus target. `record` feeds momentum. */
  private applyPan(dx: number, dz: number, record: boolean): void {
    if (dx === 0 && dz === 0) return;
    this.targetFocus.x += dx;
    this.targetFocus.z += dz;
    this.clampFocus(this.targetFocus);
    if (record) {
      this.panAccumX += dx;
      this.panAccumZ += dz;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Keyboard and edge                                                      */
  /* ---------------------------------------------------------------------- */

  private applyKeyboard(dt: number): void {
    const cfg = RENDER_CONFIG.camera;
    let mx = 0;
    let mz = 0;

    if (this.keys.size !== 0) {
      for (const code of this.keys) {
        if (KEY_PAN_LEFT.has(code)) mx -= 1;
        else if (KEY_PAN_RIGHT.has(code)) mx += 1;
        else if (KEY_PAN_UP.has(code)) mz -= 1;
        else if (KEY_PAN_DOWN.has(code)) mz += 1;
        else if (KEY_YAW_LEFT.has(code)) this.targetYaw += THREE.MathUtils.degToRad(cfg.yawSpeed) * dt;
        else if (KEY_YAW_RIGHT.has(code)) this.targetYaw -= THREE.MathUtils.degToRad(cfg.yawSpeed) * dt;
      }
    }

    // Smooth acceleration. A key is either down or up, so "acceleration" has to
    // be a ramp on this side: tap and the camera nudges, hold and it sprints.
    // On release the ramp collapses and the momentum integrator inherits the
    // velocity, so the stop is a settle rather than a wall.
    const wants = mx !== 0 || mz !== 0 ? 1 : 0;
    this.keyRamp += (wants - this.keyRamp) * (1 - Math.exp(-this.nav.keyAccelRate * dt));
    if (wants === 0) return;

    const inv = 1 / Math.hypot(mx, mz);
    mx *= inv;
    mz *= inv;
    // Pan speed scales with zoom — at 140 m you cover ground three times faster.
    const speed = cfg.panSpeed * dt * this.keyRamp * this.nav.dragPanSensitivity
      * (this.distance / cfg.distance);
    this.panScreenBy(mx * speed, mz * speed);
  }

  /**
   * Edge panning. Off unless the player turned it on, and even then it must be
   * ARMED by pointer movement toward the edge — see `CAMERA_NAV.edgeIntentMs`.
   * A cursor that merely comes to rest in the band does nothing, which is the
   * whole complaint about edge scrolling on a laptop.
   */
  private applyEdgePan(dt: number): void {
    const cfg = RENDER_CONFIG.camera;
    if (cfg.edgePanPixels <= 0 || !this.pointerInside || this.dragKind !== DRAG_NONE) return;
    if (typeof document !== 'undefined' && !document.hasFocus()) return;

    const rect = this.readRect();
    const px = this.pointerX - rect.left;
    const py = this.pointerY - rect.top;
    const e = cfg.edgePanPixels;

    let mx = 0;
    let mz = 0;
    if (px <= e) mx = -(1 - px / e);
    else if (px >= rect.width - e) mx = 1 - (rect.width - px) / e;
    if (py <= e) mz = -(1 - py / e);
    else if (py >= rect.height - e) mz = 1 - (rect.height - py) / e;

    // Motion gate: the pointer has to have been travelling toward this edge.
    if (mx !== 0 && !(this.edgeTimerX > 0 && this.edgeSignX === Math.sign(mx))) mx = 0;
    if (mz !== 0 && !(this.edgeTimerZ > 0 && this.edgeSignZ === Math.sign(mz))) mz = 0;
    if (mx === 0 && mz === 0) return;

    const speed = cfg.edgePanSpeed * dt * (this.distance / cfg.distance);
    this.panScreenBy(
      THREE.MathUtils.clamp(mx, -1, 1) * speed,
      THREE.MathUtils.clamp(mz, -1, 1) * speed
    );
  }

  private readRect(): { left: number; top: number; width: number; height: number } {
    const r = this.domElement.getBoundingClientRect();
    this._rect.left = r.left;
    this._rect.top = r.top;
    this._rect.width = Math.max(1, r.width);
    this._rect.height = Math.max(1, r.height);
    return this._rect;
  }

  /* ---------------------------------------------------------------------- */
  /* Wheel: pan, pinch, dolly                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * The whole wheel story. Public so an input owner that has taken the rig's
   * listeners can forward events without re-deriving any of this.
   *
   * Returns true when the rig consumed the event, which is what the listener
   * uses to decide whether to stop it reaching the order layer.
   */
  handleWheel(e: WheelEvent): boolean {
    if (this.disposed || !this.enabled || !this.inputEnabled) return false;

    const nav = this.nav;
    const kind = nav.pointerDevice === 'auto'
      ? classifyWheelEvent(e, this.wheelDevice)
      : nav.pointerDevice;

    // macOS turns a pinch into a wheel event with ctrlKey set. Alt is offered
    // as a keyboard alternative for trackpads whose pinch the browser eats.
    const pinch = e.ctrlKey;
    const wantsZoom = pinch || e.altKey || kind === 'mouse';

    // Hard override: there is no such thing as a horizontal zoom. A gesture
    // that is mostly sideways is a pan whatever the classifier thinks, and this
    // is the safety net that stops a misdetected trackpad from being unusable.
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);

    if (wantsZoom && !(horizontal && !pinch)) {
      this.wheelZoom(e, pinch || kind === 'trackpad');
      return true;
    }
    this.wheelPan(e);
    return true;
  }

  private wheelZoom(e: WheelEvent, fineScale: boolean): void {
    const cfg = RENDER_CONFIG.camera;
    const nav = this.nav;

    // A real zoom input reclaims pitch from a scripted override. A PAN does
    // not: panning across a posed shot must not silently reset its framing.
    this.pitchOverride = null;

    let notches: number;
    if (fineScale) {
      // Pinch and trackpad deltas are an order of magnitude smaller than a
      // wheel detent, so they get their own scale rather than the /100
      // normalisation, which would make a full pinch worth a tenth of a notch.
      notches = e.deltaY * nav.pinchZoomSensitivity;
    } else {
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 400;
      notches = (delta / 100) * nav.wheelZoomSensitivity;
    }
    if (nav.invertZoom) notches = -notches;
    notches = THREE.MathUtils.clamp(notches, -CAMERA_NAV.maxNotchesPerEvent, CAMERA_NAV.maxNotchesPerEvent);
    if (notches === 0) return;

    const before = cfg.zoomToCursor > 0 && this.screenToGround(e.clientX, e.clientY, this._v);
    const bx = this._v.x;
    const bz = this._v.z;

    this.zoomBy(notches);

    if (before) {
      // Predict where that ground point lands after the zoom settles and pull
      // the focus so it stays under the cursor. Using the target distance (not
      // the damped one) keeps repeated notches stable.
      const savedD = this.distance;
      this.distance = this.targetDistance;
      this.applyImmediate();
      if (this.screenToGround(e.clientX, e.clientY, this._v2)) {
        // record: false — a zoom nudge is not a pan and must never be flung.
        this.applyPan(
          (bx - this._v2.x) * cfg.zoomToCursor,
          (bz - this._v2.z) * cfg.zoomToCursor,
          false,
        );
      }
      this.distance = savedD;
      this.applyImmediate();
    }
  }

  private wheelPan(e: WheelEvent): void {
    const nav = this.nav;
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    else if (e.deltaMode === 2) { dx *= 400; dy *= 400; }

    // Shift+scroll is the platform convention for "scroll the other axis", and
    // a mouse with no tilt wheel has no other way to pan sideways.
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }

    const s = nav.trackpadPanSensitivity;
    this.panPixels(
      dx * s * (nav.invertPanX ? -1 : 1),
      dy * s * (nav.invertPanY ? -1 : 1),
    );
    // Two frames of grace: macOS keeps delivering inertial wheel events after
    // the fingers lift, and the handover to our own coast must not stutter.
    this.wheelPanGrace = 2;
  }

  /* ---------------------------------------------------------------------- */
  /* Drag pan                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Start a world-grab. `kind` is one of the DRAG_* constants and only affects
   * which gesture the rig thinks it is in the middle of.
   */
  private beginDrag(kind: number, pointerId: number, clientX: number, clientY: number): boolean {
    if (!this.screenToGround(clientX, clientY, this.dragAnchor)) return false;
    this.dragKind = kind;
    this.dragPointerId = pointerId;
    this.stopMomentum();
    try {
      this.domElement.setPointerCapture?.(pointerId);
    } catch {
      // Safari refuses a pointer another element already captured; the
      // window-level pointerup below still ends the drag.
    }
    // Only touch the cursor when nobody else owns it. During a match the order
    // layer writes `element.style.cursor` every frame from its own procedural
    // set, and stamping over it here would leave a blank arrow behind.
    if (this.inputMode === 'full') this.domElement.style.cursor = 'grabbing';
    return true;
  }

  private moveDrag(clientX: number, clientY: number): void {
    // World-grab: keep the ground point that was under the cursor at
    // pointerdown pinned under the cursor. This is the only pan that never
    // feels like it has the wrong speed at some zoom level.
    if (!this.screenToGround(clientX, clientY, this._v)) return;
    const sign = this.nav.invertDragPan ? -1 : 1;
    this.applyPan(
      (this.dragAnchor.x - this._v.x) * sign * this.nav.dragPanSensitivity,
      (this.dragAnchor.z - this._v.z) * sign * this.nav.dragPanSensitivity,
      true,
    );
    // The grab is direct, not damped: a dragged map that lags behind the cursor
    // reads as input lag even when it is only smoothing.
    this.focus.x = this.targetFocus.x;
    this.focus.z = this.targetFocus.z;
    this.applyImmediate();
  }

  private endDrag(): void {
    if (this.dragKind === DRAG_NONE) return;
    if (this.dragPointerId >= 0) {
      try {
        if (this.domElement.hasPointerCapture?.(this.dragPointerId)) {
          this.domElement.releasePointerCapture(this.dragPointerId);
        }
      } catch {
        // Already released by the browser.
      }
    }
    this.dragKind = DRAG_NONE;
    this.dragPointerId = -1;
    if (this.inputMode === 'full') this.domElement.style.cursor = '';
    // panVel keeps whatever the integrator last measured — that IS the fling.
  }

  /** End a drag AND kill the fling. Used when input is being taken away. */
  private abortDrag(): void {
    this.endDrag();
    this.pendingRight = false;
    this.pendingRightId = -1;
  }

  /**
   * Promote a right-button press to a pan, and tell whoever else is tracking
   * that pointer to let go.
   *
   * `src/input/Input.ts` turns a right-drag into an order at the release point.
   * Once the gesture has become a camera pan that order would be a surprise
   * move command in the middle of a battle, so the rig dispatches a synthetic
   * `pointercancel` — the platform's own "another component took this gesture"
   * signal, and precisely what a browser sends when scrolling steals a touch.
   * `InputManager.onPointerCancel` unwinds its drag, and its later `pointerup`
   * finds no live drag and issues nothing.
   */
  private commitRightDrag(e: PointerEvent): void {
    this.pendingRight = false;
    this.pendingRightId = -1;
    this.cancelForeignGesture(e.pointerId);
    // Capture AFTER the cancel: the order layer's own cancel path releases the
    // capture it took, and doing this first would hand it straight back.
    //
    // The anchor is the CURRENT pointer position, not where the button went
    // down. Anchoring at the press would make the world jump by the threshold
    // distance the instant the pan committed.
    this.beginDrag(DRAG_RIGHT, e.pointerId, e.clientX, e.clientY);
  }

  private cancelForeignGesture(pointerId: number): void {
    if (typeof PointerEvent === 'undefined') return;
    this.synthesizing = true;
    try {
      this.domElement.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId, bubbles: true, cancelable: false }),
      );
    } catch {
      // Engines without a constructible PointerEvent simply keep both
      // behaviours; the order still fires, which is the safe failure.
    } finally {
      this.synthesizing = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Listeners                                                              */
  /* ---------------------------------------------------------------------- */

  /** True when the event belongs to the surface this rig navigates. */
  private ownsEvent(e: Event): boolean {
    const t = e.target;
    if (t === this.domElement) return true;
    return t instanceof Node && this.domElement.contains(t);
  }

  private get navigating(): boolean {
    return this.inputMode !== 'none' && this.enabled && this.inputEnabled && !this.disposed;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.navigating) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // Space is tracked in BOTH modes: space+drag is a navigation gesture, and
    // it is never consumed, so a focused HUD button still activates normally.
    if (e.code === 'Space') {
      this.spaceDown = true;
      return;
    }
    if (this.inputMode !== 'full') return;

    if (KEY_HOME.has(e.code)) {
      this.centreOnHome();
      return;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceDown = false;
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.spaceDown = false;
    this.abortDrag();
    this.pointerInside = false;
    this.edgeTimerX = 0;
    this.edgeTimerZ = 0;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.synthesizing) return;
    // A captured drag keeps delivering events wherever the pointer goes, so the
    // inside flag is only re-derived when no drag owns the pointer. Without
    // that, dragging off the canvas and releasing would leave edge pan armed.
    if (this.dragKind === DRAG_NONE) this.pointerInside = this.ownsEvent(e);

    const lastX = this.pointerX;
    const lastY = this.pointerY;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;

    if (!this.navigating) return;

    // --- edge-pan arming ---------------------------------------------------
    if (lastX >= 0) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const intent = this.nav.edgeIntentSeconds;
      const idle = this.nav.edgeIdleSeconds;
      if (dx !== 0) {
        this.edgeSignX = dx > 0 ? 1 : -1;
        this.edgeTimerX = intent;
        this.edgeTimerZ = Math.max(this.edgeTimerZ, idle);
      }
      if (dy !== 0) {
        this.edgeSignZ = dy > 0 ? 1 : -1;
        this.edgeTimerZ = intent;
        this.edgeTimerX = Math.max(this.edgeTimerX, idle);
      }
    }

    // --- right-drag threshold ---------------------------------------------
    if (this.pendingRight && e.pointerId === this.pendingRightId) {
      const ddx = e.clientX - this.pendingRightX;
      const ddy = e.clientY - this.pendingRightY;
      const t = this.nav.dragPanThresholdPx;
      if (ddx * ddx + ddy * ddy >= t * t) {
        this.commitRightDrag(e);
        return;
      }
    }

    if (this.dragKind !== DRAG_NONE && e.pointerId === this.dragPointerId) {
      this.moveDrag(e.clientX, e.clientY);
      // A middle or space drag is ours alone; the order layer never saw the
      // press, so there is nothing to confuse — but the marquee and the order
      // cursor must not track a camera gesture either.
      if (this.dragKind !== DRAG_RIGHT) e.stopPropagation();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.synthesizing || !this.navigating || !this.ownsEvent(e)) return;
    const nav = this.nav;

    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;

    if (e.button === MOUSE_MIDDLE && nav.enableMiddleDrag) {
      e.preventDefault();
      // Claimed outright: nothing else in the game wants the middle button, and
      // stopping it here also kills Chrome's autoscroll puck.
      e.stopPropagation();
      this.beginDrag(DRAG_MIDDLE, e.pointerId, e.clientX, e.clientY);
      return;
    }

    if (e.button === MOUSE_LEFT && this.spaceDown && nav.enableSpaceDrag) {
      e.preventDefault();
      // Space is the explicit "this drag is the camera" modifier, so the
      // selection marquee must never start.
      e.stopPropagation();
      this.beginDrag(DRAG_SPACE, e.pointerId, e.clientX, e.clientY);
      return;
    }

    if (e.button === MOUSE_RIGHT && nav.enableRightDrag) {
      // Deliberately NOT consumed. A right-click that never moves has to reach
      // the order layer; only crossing `dragPanThresholdPx` makes it ours.
      this.pendingRight = true;
      this.pendingRightId = e.pointerId;
      this.pendingRightX = e.clientX;
      this.pendingRightY = e.clientY;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.synthesizing) return;
    if (this.pendingRight && e.pointerId === this.pendingRightId) {
      this.pendingRight = false;
      this.pendingRightId = -1;
    }
    if (e.pointerId !== this.dragPointerId || this.dragKind === DRAG_NONE) return;
    const wasRight = this.dragKind === DRAG_RIGHT;
    this.endDrag();
    // A right-drag that panned must not also land as an order on release. The
    // order layer was cancelled at commit time, so this is belt and braces for
    // any other listener further down the tree.
    if (wasRight) e.stopPropagation();
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.synthesizing) return;
    if (this.pendingRight && e.pointerId === this.pendingRightId) {
      this.pendingRight = false;
      this.pendingRightId = -1;
    }
    if (e.pointerId === this.dragPointerId) this.abortDrag();
  };

  private onPointerLeave = (e: Event): void => {
    if (!this.ownsEvent(e)) return;
    // A captured drag keeps delivering events outside the element; clearing the
    // flag mid-drag would let edge pan engage the moment the drag ends.
    if (this.dragKind === DRAG_NONE) this.pointerInside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.navigating || !this.ownsEvent(e)) return;
    // Always: the page must never scroll under the battlefield, and on macOS an
    // unprevented ctrl+wheel is a full browser zoom.
    e.preventDefault();
    if (this.handleWheel(e)) e.stopPropagation();
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (!this.ownsEvent(e)) return;
    // Right-click is an in-game order and right-drag is a pan; neither wants
    // the browser menu.
    e.preventDefault();
  };

  /* ---------------------------------------------------------------------- */
  /* Attach / detach                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * `full` also takes the keyboard (WASD/arrows/QE/Home). `navigation` leaves
   * the keyboard alone — during a match those keys are orders — and keeps only
   * the pointer gestures.
   *
   * Everything is bound on `window` in the CAPTURE phase and filtered by
   * `ownsEvent`, so the rig sees a gesture before any listener on the canvas
   * and can claim it cleanly. Binding on the element instead would put us in
   * registration order against the order layer, which is not a contract worth
   * depending on.
   */
  attachInput(options?: { navigationOnly?: boolean }): void {
    this.setInputMode(options?.navigationOnly === true ? 'navigation' : 'full');
  }

  /**
   * Hand input back. **Defaults to keeping the navigation gestures**, because
   * the only caller in the game (`input.system.ts`) detaches to free the
   * KEYBOARD for orders — and if that also killed wheel-pan, pinch-zoom and
   * drag-pan, the entire control scheme would be dead in the one place it is
   * used. Pass `{ keepNavigation: false }` for a total release.
   */
  detachInput(options?: { keepNavigation?: boolean }): void {
    // Detaching never ESCALATES. `?shot=` boots the rig with `attachInput:
    // false`, and `input.system.ts` still calls `detachInput()` in its init —
    // waking the listeners there would let a stray wheel event ruin a posed
    // frame that the harness believes is frozen.
    if (this.inputMode === 'none') return;
    this.setInputMode(options?.keepNavigation === false ? 'none' : 'navigation');
  }

  setInputMode(mode: CameraInputMode): void {
    if (this.disposed && mode !== 'none') return;
    if (this.inputMode === mode) return;
    this.inputMode = mode;

    if (mode === 'none') {
      this.removeListeners();
      this.keys.clear();
      this.spaceDown = false;
      this.abortDrag();
      return;
    }
    if (mode === 'navigation') {
      // Order keys are no longer ours; drop any that are still held or they
      // would pan forever.
      this.keys.clear();
    }
    this.addListeners();
  }

  private addListeners(): void {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    const cap = { capture: true } as const;
    window.addEventListener('keydown', this.onKeyDown, cap);
    window.addEventListener('keyup', this.onKeyUp, cap);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointermove', this.onPointerMove, cap);
    window.addEventListener('pointerdown', this.onPointerDown, cap);
    window.addEventListener('pointerup', this.onPointerUp, cap);
    window.addEventListener('pointercancel', this.onPointerCancel, cap);
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', this.onContextMenu, cap);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
  }

  private removeListeners(): void {
    if (!this.attached) return;
    this.attached = false;
    const cap = { capture: true } as const;
    window.removeEventListener('keydown', this.onKeyDown, cap);
    window.removeEventListener('keyup', this.onKeyUp, cap);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove, cap);
    window.removeEventListener('pointerdown', this.onPointerDown, cap);
    window.removeEventListener('pointerup', this.onPointerUp, cap);
    window.removeEventListener('pointercancel', this.onPointerCancel, cap);
    window.removeEventListener('wheel', this.onWheel, cap);
    window.removeEventListener('contextmenu', this.onContextMenu, cap);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);
  }

  dispose(): void {
    if (this.disposed) return;
    this.setInputMode('none');
    this.unsubscribeConfig();
    this.disposed = true;
  }
}

/** Convenience factory matching the other modules' create* style. */
export function createCameraRig(options: CreateCameraOptions): CameraRig {
  return new CameraRig(options);
}

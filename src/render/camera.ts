/**
 * RED ALERT — src/render/camera.ts
 * =============================================================================
 * The RTS camera rig.
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
 * INPUT
 * -----
 * The rig ships with its own listeners (WASD/arrows, screen-edge pan,
 * middle-drag world-grab, wheel dolly-toward-cursor, Q/E yaw) so the camera is
 * alive on frame one. `src/input/InputModule` may call `detachInput()` and
 * drive the rig purely through its programmatic API instead — every input path
 * writes the same four numbers.
 *
 * ALLOCATION
 * ----------
 * `update()` and `screenToGround()` allocate nothing. All scratch is module or
 * instance level.
 */

import * as THREE from 'three';
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
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private panning = false;
  private panPointerId = -1;
  private readonly panAnchor = new THREE.Vector3();
  private attached = false;
  private enabled = true;
  private inputEnabled = true;
  private disposed = false;
  private readonly unsubscribeConfig: () => void;

  // --- scratch (never allocate in update) ---------------------------------
  private readonly _v = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _ndc = new THREE.Vector3();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _offset = new THREE.Vector3();
  private readonly _shakeOffset = new THREE.Vector3();
  private readonly _rect = { left: 0, top: 0, width: 1, height: 1 };

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
    if (!v) this.keys.clear();
  }

  /** Disable only the input, keeping damping/update alive. */
  setInputEnabled(v: boolean): void {
    this.inputEnabled = v;
    if (!v) {
      this.keys.clear();
      this.panning = false;
    }
  }

  setFocus(x: number, z: number, immediate = false): void {
    this.targetFocus.set(x, this.targetFocus.y, z);
    this.clampFocus(this.targetFocus);
    if (immediate) {
      this.focus.copy(this.targetFocus);
      this.applyImmediate();
    }
  }

  panBy(dx: number, dz: number): void {
    this.targetFocus.x += dx;
    this.targetFocus.z += dz;
    this.clampFocus(this.targetFocus);
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

  /**
   * Full programmatic pose — this is what the screenshot harness drives.
   * `immediate` defaults to TRUE: a scripted pose must not be mid-damping when
   * the very next statement grabs a screenshot.
   *
   * Passing `pitch: null` releases an explicit pitch back to the zoom curve.
   */
  setPose(pose: Partial<CameraPose> & { pitch?: number | null; immediate?: boolean }): void {
    const cfg = RENDER_CONFIG.camera;
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
    }

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

  /* ---------------------------------------------------------------------- */
  /* Built-in input                                                         */
  /* ---------------------------------------------------------------------- */

  private applyKeyboard(dt: number): void {
    if (this.keys.size === 0) return;
    const cfg = RENDER_CONFIG.camera;

    let mx = 0;
    let mz = 0;
    for (const code of this.keys) {
      if (KEY_PAN_LEFT.has(code)) mx -= 1;
      else if (KEY_PAN_RIGHT.has(code)) mx += 1;
      else if (KEY_PAN_UP.has(code)) mz -= 1;
      else if (KEY_PAN_DOWN.has(code)) mz += 1;
      else if (KEY_YAW_LEFT.has(code)) this.targetYaw += THREE.MathUtils.degToRad(cfg.yawSpeed) * dt;
      else if (KEY_YAW_RIGHT.has(code)) this.targetYaw -= THREE.MathUtils.degToRad(cfg.yawSpeed) * dt;
    }
    if (mx === 0 && mz === 0) return;

    const inv = 1 / Math.hypot(mx, mz);
    mx *= inv;
    mz *= inv;
    // Pan speed scales with zoom — at 140 m you cover ground three times faster.
    const speed = cfg.panSpeed * dt * (this.distance / cfg.distance);
    this.panScreenSpace(mx * speed, mz * speed);
  }

  private applyEdgePan(dt: number): void {
    const cfg = RENDER_CONFIG.camera;
    if (cfg.edgePanPixels <= 0 || !this.pointerInside || this.panning) return;
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
    if (mx === 0 && mz === 0) return;

    const speed = cfg.edgePanSpeed * dt * (this.distance / cfg.distance);
    this.panScreenSpace(
      THREE.MathUtils.clamp(mx, -1, 1) * speed,
      THREE.MathUtils.clamp(mz, -1, 1) * speed
    );
  }

  /** Move the focus in the camera's ground-projected right/forward basis. */
  private panScreenSpace(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // right  = ( cos(yaw), 0, -sin(yaw) )
    // forward= ( sin(yaw), 0,  cos(yaw) )   (into the screen = away from camera)
    this.targetFocus.x += right * c + forward * s;
    this.targetFocus.z += right * -s + forward * c;
    this.clampFocus(this.targetFocus);
  }

  private readRect(): { left: number; top: number; width: number; height: number } {
    const r = this.domElement.getBoundingClientRect();
    this._rect.left = r.left;
    this._rect.top = r.top;
    this._rect.width = Math.max(1, r.width);
    this._rect.height = Math.max(1, r.height);
    return this._rect;
  }

  // --- listeners ----------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.panning = false;
    this.pointerInside = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;

    if (this.panning && e.pointerId === this.panPointerId && this.inputEnabled) {
      // World-grab: keep the ground point that was under the cursor at
      // pointerdown pinned under the cursor. This is the only pan that never
      // feels like it has the wrong speed at some zoom level.
      if (this.screenToGround(e.clientX, e.clientY, this._v)) {
        this.targetFocus.x += this.panAnchor.x - this._v.x;
        this.targetFocus.z += this.panAnchor.z - this._v.z;
        this.clampFocus(this.targetFocus);
        this.focus.x = this.targetFocus.x;
        this.focus.z = this.targetFocus.z;
        this.applyImmediate();
      }
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled) return;
    if (e.button !== 1) return; // middle only
    e.preventDefault();
    if (this.screenToGround(e.clientX, e.clientY, this.panAnchor)) {
      this.panning = true;
      this.panPointerId = e.pointerId;
      this.domElement.setPointerCapture?.(e.pointerId);
      this.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.panPointerId) return;
    this.panning = false;
    this.panPointerId = -1;
    this.domElement.releasePointerCapture?.(e.pointerId);
    this.domElement.style.cursor = '';
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.inputEnabled) return;
    e.preventDefault();
    const cfg = RENDER_CONFIG.camera;

    // A real zoom input reclaims pitch from any scripted override.
    this.pitchOverride = null;

    // Normalise across deltaMode (pixels / lines / pages).
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 400;
    const notches = THREE.MathUtils.clamp(delta / 100, -3, 3);

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
        this.targetFocus.x += (bx - this._v2.x) * cfg.zoomToCursor;
        this.targetFocus.z += (bz - this._v2.z) * cfg.zoomToCursor;
        this.clampFocus(this.targetFocus);
      }
      this.distance = savedD;
      this.applyImmediate();
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    // Right-click is an in-game order; never let the browser menu eat it.
    e.preventDefault();
  };

  attachInput(): void {
    if (this.attached || this.disposed) return;
    this.attached = true;
    const el = this.domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('pointermove', this.onPointerMove, { passive: true });
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  detachInput(): void {
    if (!this.attached) return;
    this.attached = false;
    const el = this.domElement;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.keys.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detachInput();
    this.unsubscribeConfig();
    this.disposed = true;
  }
}

/** Convenience factory matching the other modules' create* style. */
export function createCameraRig(options: CreateCameraOptions): CameraRig {
  return new CameraRig(options);
}

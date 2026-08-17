/**
 * VOLTMARCH — src/render/debug.ts
 * =============================================================================
 * Two things:
 *
 *  1. An on-screen performance overlay (F3): fps, frame ms with a rolling
 *     sparkline, CPU time, draw calls, triangles, programs, geometry/texture
 *     counts, texture memory, entity/particle counters and a JS heap canary.
 *     Text nodes are created once and only their `nodeValue` is written, at
 *     6 Hz — the overlay must never be the reason a frame is slow.
 *
 *  2. `window.__VM` — the scripting handle.
 *
 * WHY __VM MATTERS
 * ----------------
 * Visual critics do not play the game; they drive it. Every screenshot in the
 * review loop is produced by a headless script that navigates to the page,
 * awaits `__VM.ready()`, calls `__VM.setCameraPose(...)`, `__VM.setSun(...)`,
 * `__VM.setStudio(true)`, and then `__VM.screenshot()`. If the framing is not
 * byte-reproducible the diffs are worthless, so every pose setter is immediate
 * (damping bypassed) by default and `screenshot()` always renders a fresh
 * frame before reading pixels.
 *
 * The handle is installed in dev AND in production builds. It is ~4 KB and it
 * is the difference between "we think it looks better" and "here is the diff".
 *
 * THE POSE MUST BE PROVEN, NOT ASSUMED
 * ------------------------------------
 * "Every pose setter is immediate" is only half the contract. The other half is
 * that the pose the harness asked for is the pose the rig is actually in, and
 * that half was free for as long as pitch was derived from the dolly and
 * nothing else could write it. It no longer is. See the CANONICAL CAMERA POSE
 * block below for `canonicalPitchDeg`, `comparePoseDeg` and
 * `__VM.assertCameraPose` — all additive, because both `tools/shoot.mjs` and
 * `tools/metrics.mjs` consume this surface and neither may be broken.
 */

import * as THREE from 'three';
import {
  RENDER_CONFIG,
  configureRender,
  applyQualityTier,
  type RendererHandle,
  type RenderConfig,
  type DeepPartial,
  type RenderQualityTier,
} from './renderer';
import type { SceneRig } from './scene';
import type { CameraRig, CameraPose } from './camera';
import type { PostChain, PassId, DrawCallBreakdown } from './post';
import { PASS_ORDER } from './post-order';
import { renderBridge, type RenderAudit } from './RenderBridge';

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

/** Gameplay-side counters. Systems push into these; the overlay reads them. */
export interface DebugCounters {
  entities: number;
  units: number;
  buildings: number;
  projectiles: number;
  particles: number;
  batches: number;
  /** Milliseconds spent in the fixed-step simulation this frame. */
  simMs: number;
  /** Number of sim substeps run this frame. */
  substeps: number;
  [key: string]: number;
}

/**
 * Hooks the rest of the game registers so the debug handle can drive it
 * without importing (and therefore coupling to) any gameplay module.
 */
export interface DebugHooks {
  /**
   * Render exactly one COMPLETE frame, synchronously — every frame system, then
   * presentation. Required for screenshot().
   *
   * "Complete" is load-bearing and was not always true: a host that only
   * presented here made `screenshot()` return the frame before any work queued
   * for the next system frame had run.
   */
  renderFrame?: () => void;
  pause?: () => void;
  resume?: () => void;
  /** Advance the simulation by n fixed steps while paused. No frames. */
  step?: (n: number) => void;
  /**
   * Advance the simulation by n fixed steps, each followed by a complete
   * system frame at exactly the sim dt. The deterministic capture path.
   */
  advanceTicks?: (n: number) => void;
  /**
   * Advance the presentation by n complete system frames of exactly the sim dt,
   * leaving the simulation where it is. The deterministic replacement for a
   * wall-clock sleep.
   */
  advanceFrames?: (n: number) => void;
  /** The fixed simulation rate, so a harness can check its own copy of it. */
  simHz?: () => number;
  setTimeScale?: (scale: number) => void;
  restart?: (seed?: number) => void;
  /** Toggle HUD/menu DOM visibility for clean product shots. */
  setUiVisible?: (v: boolean) => void;
  /** Push an ArtDirection patch through ArtStore. */
  setArt?: (patch: unknown) => void;
  applyMood?: (mood: string) => void;
  /** Return a deterministic hash of sim state (determinism soak). */
  stateHash?: () => string;
  [key: string]: unknown;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  frameMsAvg: number;
  frameMsMax: number;
  cpuMs: number;
  /**
   * `renderer.info.render.calls` — the frame's total across EVERY scene
   * submission. Kept exactly as it was: three consumers read this field, and
   * `shots/_report.json` has published it under this name for a dozen releases.
   */
  drawCalls: number;
  /**
   * The same number, split by what spent it. `drawCalls` is a sum over the
   * shadow pass, the colour pass and GTAO's normal prepass, so it has never been
   * comparable with `MAX_DRAW_CALLS`, which bounds the colour pass alone — read
   * `colour` for that. See `DrawCallBreakdown` in `post.ts`; the four parts sum
   * to `total`, and `total` is `drawCalls` whenever the post chain drew the
   * frame. All zero when there is no post chain to meter.
   */
  drawCallsByPass: DrawCallBreakdown;
  triangles: number;
  points: number;
  lines: number;
  programs: number;
  geometries: number;
  textures: number;
  textureMB: number;
  heapMB: number;
  /** Growth in MB since the overlay was opened — the zero-GC canary. */
  heapGrowthMB: number;
  resolution: string;
  pixelRatio: number;
  quality: RenderQualityTier;
  post: string;
  counters: DebugCounters;
}

/* ==========================================================================
 * CANONICAL CAMERA POSE
 *
 * WHY THIS EXISTS
 * ---------------
 * The scorecard in docs/RA3_LOOK_BIBLE.md is a 40-point weighted grade over
 * twelve fixtures. That number only means anything if all twelve are shot from
 * the SAME camera every run — a grade computed from a camera that moved is an
 * art measurement contaminated by a navigation change, and the two are
 * indistinguishable after the fact.
 *
 * Pitch used to be safe by construction: `CameraRig` derived it from the dolly
 * distance and nothing else could write it. It is about to become player state.
 * A player-chosen pitch that survives into a capture run — through persistence,
 * through a stale rig, through anything — would move the grade silently.
 *
 * So the fixture pose becomes DATA that is asserted rather than assumed:
 *
 *   `canonicalPitchDeg(d)`  the pitch the config curve prescribes at dolly d
 *   `comparePoseDeg(...)`   pure comparison, so the rejection path is testable
 *   `__VM.assertCameraPose` the same comparison against the live rig
 *
 * ANGLES ARE IN DEGREES HERE. `CameraPose` is radians because the rig is, and
 * every fixture in `tools/shoot.mjs` and `src/game/scenarios.system.ts` is
 * authored in degrees. Converting at one boundary beats converting at twelve.
 * ========================================================================== */

/** A camera pose with its angles in degrees — the unit fixtures are authored in. */
export interface CameraPoseDeg {
  x: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
  distance: number;
}

/** How far a pose may drift before the capture is refused. */
export interface PoseTolerance {
  /** Degrees, applied to yaw and pitch. */
  angleDeg: number;
  /** Metres, applied to focus x/z and dolly distance. */
  metres: number;
}

/**
 * 0.05 deg is about a pixel of horizon travel at 1440p and 62 m, and it is two
 * orders of magnitude above the rounding in a 4-decimal fixture table. Wide
 * enough never to fire on arithmetic, tight enough that no human-chosen pitch
 * slips through.
 */
export const DEFAULT_POSE_TOLERANCE: Readonly<PoseTolerance> = { angleDeg: 0.05, metres: 0.05 };

/** One field of the pose that did not survive being set. */
export interface PoseMismatch {
  field: keyof CameraPoseDeg;
  expected: number;
  actual: number;
  /** Absolute difference, in the field's own unit. */
  delta: number;
  tolerance: number;
}

export interface CameraPoseAssertion {
  ok: boolean;
  tolerance: PoseTolerance;
  expected: Partial<CameraPoseDeg>;
  actual: CameraPoseDeg;
  mismatches: PoseMismatch[];
  /** One line, ready to throw. Empty when `ok`. */
  summary: string;
}

/**
 * The pitch the zoom curve prescribes at a dolly distance, in degrees.
 *
 * This is deliberately a SECOND implementation of the interpolation in
 * `CameraRig.applyImmediate` rather than a call into the rig: the rig's answer
 * is whatever state it is in, and the whole point here is to have an
 * independent statement of what the pose is supposed to be. `tests/
 * shot-camera.spec.ts` drives a real `CameraRig` and asserts the two agree at
 * every fixture distance, so the duplication cannot drift unnoticed.
 */
export function canonicalPitchDeg(distance: number): number {
  const cfg = RENDER_CONFIG.camera;
  const span = Math.max(1e-3, cfg.maxDistance - cfg.minDistance);
  const t = Math.min(1, Math.max(0, (distance - cfg.minDistance) / span));
  const s = t * t * (3 - 2 * t); // smoothstep, exactly as the rig does it
  return cfg.pitchAtMinDistance + (cfg.pitchAtMaxDistance - cfg.pitchAtMinDistance) * s;
}

/** Shortest-arc absolute difference between two bearings in degrees. */
function angleDeltaDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

const POSE_ANGLE_FIELDS: ReadonlyArray<keyof CameraPoseDeg> = ['yawDeg', 'pitchDeg'];

/**
 * Compare a measured pose against the pose that was asked for. Pure, so the
 * REJECTION path can be tested without a browser — a guard nobody has watched
 * fire is indistinguishable from no guard.
 *
 * Fields absent from `expected` are not checked, which is what lets the harness
 * assert pitch and distance on a shot whose focus point it does not pin.
 */
export function comparePoseDeg(
  expected: Partial<CameraPoseDeg>,
  actual: CameraPoseDeg,
  tolerance: Partial<PoseTolerance> = {},
): CameraPoseAssertion {
  const tol: PoseTolerance = {
    angleDeg: tolerance.angleDeg ?? DEFAULT_POSE_TOLERANCE.angleDeg,
    metres: tolerance.metres ?? DEFAULT_POSE_TOLERANCE.metres,
  };

  const mismatches: PoseMismatch[] = [];
  for (const field of Object.keys(expected) as Array<keyof CameraPoseDeg>) {
    const want = expected[field];
    if (want === undefined) continue;
    const got = actual[field];
    const angular = POSE_ANGLE_FIELDS.includes(field);
    const limit = angular ? tol.angleDeg : tol.metres;
    // A NaN anywhere is a failure, not a pass: `NaN <= limit` is false, which
    // is the answer we want, but say so explicitly so the message is readable.
    const delta = Number.isFinite(want) && Number.isFinite(got)
      ? (angular ? angleDeltaDeg(want, got) : Math.abs(want - got))
      : Number.POSITIVE_INFINITY;
    if (!(delta <= limit)) {
      mismatches.push({ field, expected: want, actual: got, delta, tolerance: limit });
    }
  }

  const summary = mismatches.length === 0
    ? ''
    : mismatches
        .map((m) => `${m.field}: wanted ${m.expected.toFixed(4)}, rig reports ${m.actual.toFixed(4)} ` +
          `(off by ${m.delta.toFixed(4)}, tolerance ${m.tolerance})`)
        .join('; ');

  return { ok: mismatches.length === 0, tolerance: tol, expected, actual, mismatches, summary };
}

export interface VMHandle {
  readonly version: string;
  readonly THREE: typeof THREE;

  /**
   * The shipping WebGL renderer, or NULL under `?gpu=webgpu`.
   *
   * `window.__VM.renderer` is part of the tooling contract CLAUDE.md calls
   * load-bearing, so it keeps its name and its meaning — "the WebGLRenderer" —
   * and reports null rather than quietly handing back an object of a different
   * class with a different `info`, a different `capabilities` and no
   * `getContext()`. `rendererHandle` is the backend-agnostic one and carries
   * `backend`, `frameInfo()` and both renderers.
   */
  readonly renderer: THREE.WebGLRenderer | null;
  readonly rendererHandle: RendererHandle;
  readonly scene: THREE.Scene;
  readonly sceneRig: SceneRig;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly post: PostChain | null;
  readonly config: RenderConfig;
  readonly counters: DebugCounters;
  readonly hooks: DebugHooks;

  /* -- configuration -- */
  configure(patch: DeepPartial<RenderConfig>): ReadonlyArray<string>;
  quality(tier: RenderQualityTier): void;
  setResolutionScale(scale: number): void;
  setExposure(v: number): void;
  setSun(azimuthDeg: number, elevationDeg: number): void;

  /* -- camera -- */
  setCameraPose(pose: Partial<CameraPose> & { pitch?: number | null; immediate?: boolean }): void;
  getCameraPose(): CameraPose;
  focusOn(x: number, z: number, distance?: number): void;
  orbit(degrees: number): void;

  /* -- camera: canonical pose (ADDITIVE — see the block comment above).
   *    Nothing here changes an existing signature. `tools/shoot.mjs` and
   *    `tools/metrics.mjs` both drive this handle, so the old four calls above
   *    keep behaving exactly as they always did. -- */
  /** The live pose with angles in degrees. */
  getCameraPoseDeg(): CameraPoseDeg;
  /** Pin the pitch, in degrees. Survives until a zoom input or `clearCameraPitch`. */
  setCameraPitchDeg(deg: number): void;
  /** Hand pitch back to the zoom curve. */
  clearCameraPitch(): void;
  /** The pitch the config's zoom curve prescribes at a dolly distance. */
  canonicalPitchDeg(distance: number): number;
  /** Measure the live rig against an intended pose. Never throws; report `ok`. */
  assertCameraPose(
    expected: Partial<CameraPoseDeg>,
    tolerance?: Partial<PoseTolerance>,
  ): CameraPoseAssertion;

  /* -- presentation -- */
  setSize(width: number | null, height: number | null): void;
  setPostEnabled(v: boolean): void;
  setPass(id: PassId, v: boolean): void;
  setStudio(v: boolean): void;
  setUiVisible(v: boolean): void;
  setOverlay(v: boolean): void;
  toggleOverlay(): void;

  /* -- time -- */
  pause(): void;
  resume(): void;
  /** n fixed sim steps and NO frames. Fast; the presentation does not move. */
  step(n?: number): void;
  /**
   * n fixed sim steps with the PRESENTATION IN LOCKSTEP — each step followed by
   * one complete system frame at exactly the sim dt.
   *
   * This is the only correct way to advance a capture. `step()` leaves every
   * effect the ticks spawned piled into one frame at age zero; sleeping in wall
   * clock and photographing the result ages them by however many frames the
   * machine managed. Both were measured to move a graded fixture more than a
   * real art change does. Throws if the host did not register the hook, because
   * a capture that silently did not advance is worse than one that failed.
   */
  advanceTicks(n: number): void;
  /**
   * n complete system frames of exactly the sim dt, with the simulation left
   * alone. What a `?shot=` fixture advances on: those boot paused, their motion
   * comes from the scenario's `settleTicks`, and what the capture needs after
   * that is for the effects those ticks spawned to play out to a chosen moment.
   * Deterministic to the byte; throws if the host did not wire the hook.
   */
  advanceFrames(n: number): void;
  setTimeScale(scale: number): void;
  readonly paused: boolean;

  /* -- capture -- */
  /** Resolves once the first frames are on screen and loaders are idle. */
  ready(): Promise<void>;
  waitFrames(n: number): Promise<void>;
  /** Renders a fresh frame and returns a data URL. */
  screenshot(options?: { mime?: string; quality?: number }): Promise<string>;
  download(filename?: string): Promise<void>;

  /* -- introspection -- */
  stats(): FrameStats;
  setCounter(name: string, value: number): void;
  registerHook<K extends keyof DebugHooks>(name: K, fn: DebugHooks[K]): void;
  /** Subscribe to every rendered frame. Returns an unsubscribe fn. */
  onFrame(cb: (dtMs: number) => void): () => void;
  /** Dump the current render config to the console as pasteable source. */
  dumpConfig(): string;

  /* -- the invisible-entity audit (ADDITIVE — see RenderBridge §5a).
   *    `tools/shoot.mjs` and `tools/metrics.mjs` drive this handle and neither
   *    is touched by this addition. -- */
  /**
   * Which entities the local player is entitled to see did NOT reach a
   * drawable instance slot, and why.
   *
   * Off by default and free when off: the bridge only runs the scan while
   * `{ on: true }`, and the always-on half is two integer counters.
   *
   *   `__VM.renderAudit({ on: true })`     start capturing every frame
   *   `__VM.renderAudit()`                 the most recent captured report
   *   `__VM.renderAudit({ now: true })`    scan the CURRENT bridge state
   *   `__VM.renderAudit({ failure: true })` the FIRST report that found a miss
   *   `__VM.renderAudit({ reset: true })`  zero the running totals
   *
   * Returns null before the bridge exists.
   */
  renderAudit(
    options?: { on?: boolean; now?: boolean; reset?: boolean; failure?: boolean },
  ): RenderAudit | null;
}

declare global {
  interface Window {
    __VM?: VMHandle;
  }
}

/** Injected by vite's `define` from package.json. See `vite.config.ts`. */
declare const __APP_VERSION__: string;

/* ========================================================================== */
/* Overlay DOM                                                                */
/* ========================================================================== */

const OVERLAY_CSS = `
position:absolute;top:8px;left:8px;z-index:9999;
font:11px/1.45 'Rajdhani','Oswald','Consolas','SF Mono',monospace;
color:#DCE4EA;background:linear-gradient(180deg,rgba(18,22,26,.92),rgba(27,31,36,.92));
border:1px solid #4A545E;border-radius:3px;
box-shadow:0 2px 0 #12161A,0 8px 24px rgba(0,0,0,.55),inset 0 1px 0 #6B7681;
padding:7px 9px 8px;min-width:212px;letter-spacing:.4px;
pointer-events:none;user-select:none;text-shadow:0 1px 0 rgba(0,0,0,.6);
`;

function makeOverlay(): {
  root: HTMLDivElement;
  rows: Record<string, Text>;
  spark: HTMLCanvasElement;
  sparkCtx: CanvasRenderingContext2D | null;
} {
  const root = document.createElement('div');
  root.id = 'vm-perf';
  root.style.cssText = OVERLAY_CSS;

  const title = document.createElement('div');
  title.textContent = 'VOLTMARCH · RENDER';
  title.style.cssText =
    'color:#7FD8C0;font-weight:700;letter-spacing:1.6px;margin-bottom:4px;' +
    'border-bottom:1px solid #2E353C;padding-bottom:3px;';
  root.appendChild(title);

  const spark = document.createElement('canvas');
  spark.width = 196;
  spark.height = 34;
  spark.style.cssText =
    'display:block;width:196px;height:34px;margin:2px 0 5px;' +
    'background:#12161A;border:1px solid #2E353C;border-radius:2px;image-rendering:pixelated;';
  root.appendChild(spark);

  const rows: Record<string, Text> = {};
  const addRow = (key: string, label: string) => {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.color = '#7C8792';
    const v = document.createElement('span');
    const t = document.createTextNode('—');
    v.appendChild(t);
    line.appendChild(l);
    line.appendChild(v);
    root.appendChild(line);
    rows[key] = t;
  };

  addRow('fps', 'fps');
  addRow('frame', 'frame ms');
  addRow('cpu', 'cpu ms');
  addRow('sim', 'sim ms');
  addRow('draws', 'draw calls');
  addRow('tris', 'triangles');
  addRow('progs', 'programs');
  addRow('geo', 'geo / tex');
  addRow('texmb', 'texture MB');
  addRow('ents', 'entities');
  addRow('parts', 'particles');
  addRow('res', 'resolution');
  addRow('heap', 'heap MB');

  const hint = document.createElement('div');
  hint.textContent = 'F3 toggle · __VM in console';
  hint.style.cssText = 'margin-top:5px;color:#4A545E;font-size:10px;letter-spacing:1px;';
  root.appendChild(hint);

  return { root, rows, spark, sparkCtx: spark.getContext('2d') };
}

/* ========================================================================== */
/* initDebug                                                                  */
/* ========================================================================== */

export interface InitDebugOptions {
  handle: RendererHandle;
  sceneRig: SceneRig;
  cameraRig: CameraRig;
  post?: PostChain | null;
  hooks?: DebugHooks;
  /** KeyboardEvent.code that toggles the overlay. Default 'F3'. */
  toggleKey?: string;
  /** Show the overlay immediately. Default: true when ?perf is in the URL. */
  visible?: boolean;
  /** Mount point; falls back to #debug-root then document.body. */
  mount?: HTMLElement | null;
  version?: string;
}

export interface DebugHandle {
  readonly api: VMHandle;
  readonly counters: DebugCounters;
  /** Call at the very top of each rendered frame. Returns dt in seconds. */
  beginFrame(nowMs: number): number;
  /** Call after renderer/composer work, before the browser paints. */
  endFrame(): void;
  setVisible(v: boolean): void;
  toggle(): void;
  setCounter(name: string, value: number): void;
  dispose(): void;
}

export function initDebug(options: InitDebugOptions): DebugHandle {
  const { handle, sceneRig, cameraRig } = options;
  const post = options.post ?? null;
  const webgl = handle.webgl;
  const hooks: DebugHooks = options.hooks ?? {};
  // `typeof` is the one operator safe on an undeclared identifier, so this also
  // works under a bare `node`/vitest run where the define never ran.
  const version = options.version
    ?? (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev');

  const counters: DebugCounters = {
    entities: 0,
    units: 0,
    buildings: 0,
    projectiles: 0,
    particles: 0,
    batches: 0,
    simMs: 0,
    substeps: 0,
  };

  /* ---- overlay ---------------------------------------------------------- */
  const mount =
    options.mount ?? (document.getElementById('debug-root') as HTMLElement | null) ?? document.body;
  const { root, rows, spark, sparkCtx } = makeOverlay();
  mount.appendChild(root);

  const urlWantsPerf = typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);
  let visible = options.visible ?? urlWantsPerf;
  root.style.display = visible ? 'block' : 'none';

  /* ---- frame timing ----------------------------------------------------- */
  const HISTORY = 120;
  const history = new Float32Array(HISTORY);
  let historyHead = 0;
  let lastNow = 0;
  let frameStart = 0;
  let cpuMs = 0;
  let frameMs = 16.7;
  let frameMsAvg = 16.7;
  let frameMsMax = 0;
  let fps = 60;
  let uiAccum = 0;
  let heapBase = 0;
  let heapMB = 0;

  const frameListeners: Array<(dtMs: number) => void> = [];

  function pushHistory(ms: number): void {
    history[historyHead] = ms;
    historyHead = (historyHead + 1) % HISTORY;
  }

  function drawSpark(): void {
    if (!sparkCtx) return;
    const w = spark.width;
    const h = spark.height;
    sparkCtx.clearRect(0, 0, w, h);

    // 16.7 ms (60 fps) reference line
    sparkCtx.fillStyle = '#2E353C';
    const ref60 = h - (16.7 / 50) * h;
    sparkCtx.fillRect(0, Math.round(ref60), w, 1);
    sparkCtx.fillStyle = '#3a2a1c';
    const ref30 = h - (33.3 / 50) * h;
    sparkCtx.fillRect(0, Math.round(ref30), w, 1);

    const step = w / HISTORY;
    for (let i = 0; i < HISTORY; i++) {
      const v = history[(historyHead + i) % HISTORY];
      if (v <= 0) continue;
      const bh = Math.max(1, Math.min(h, (v / 50) * h));
      sparkCtx.fillStyle = v > 33.3 ? '#E03A2A' : v > 20 ? '#E0A72A' : '#4ADE80';
      sparkCtx.fillRect(Math.round(i * step), h - bh, Math.max(1, Math.ceil(step)), bh);
    }
  }

  function estimateTextureMB(): number {
    // renderer.info does not report bytes; approximate from live textures.
    let bytes = 0;
    const seen = new Set<THREE.Texture>();
    sceneRig.scene.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        for (const key in m) {
          const v = (m as any)[key];
          if (v && v.isTexture && !seen.has(v)) {
            seen.add(v);
            const img = v.image;
            const w = img?.width ?? 0;
            const h = img?.height ?? 0;
            bytes += w * h * 4 * 1.33; // rgba + mips
          }
        }
      }
    });
    return bytes / (1024 * 1024);
  }

  let cachedTexMB = 0;
  let texMBCountdown = 0;

  function updateOverlay(): void {
    const info = handle.frameInfo();
    const mem = (performance as any).memory;
    if (mem) {
      heapMB = mem.usedJSHeapSize / (1024 * 1024);
      if (heapBase === 0) heapBase = heapMB;
    }

    if (texMBCountdown-- <= 0) {
      texMBCountdown = 30; // recompute every ~5 s at 6 Hz
      cachedTexMB = estimateTextureMB();
    }

    rows.fps.nodeValue = fps.toFixed(0);
    rows.frame.nodeValue = `${frameMs.toFixed(1)} / ${frameMsAvg.toFixed(1)} / ${frameMsMax.toFixed(1)}`;
    rows.cpu.nodeValue = cpuMs.toFixed(2);
    rows.sim.nodeValue = `${counters.simMs.toFixed(2)} (${counters.substeps})`;
    // Total first, then the colour pass in brackets — the only one of the two
    // that `MAX_DRAW_CALLS` is a budget for. Reading 219 against a budget of 130
    // is what made the gap look like outstanding work for three releases; the
    // second number is the one to judge. See `DrawCallBreakdown` in post.ts.
    const byPass = post?.drawCallsByPass;
    /*
     * A ZERO COLOUR BUCKET WITH A NON-ZERO TOTAL MEANS THE SPLIT IS UNAVAILABLE,
     * not that nothing drew. The node renderer has no seam between the shadow
     * pass and the colour pass to meter, so `drawCallsByPass` reports the true
     * total and zeros. Say so on the overlay instead of printing `0 col`, which
     * reads as a catastrophic regression.
     */
    rows.draws.nodeValue = byPass === undefined
      ? String(info.drawCalls)
      : byPass.total > 0 && byPass.colour === 0 && byPass.shadow === 0
        ? `${info.drawCalls} (no per-pass split)`
        : `${info.drawCalls} (${byPass.colour} col ${byPass.shadow} shd ${byPass.ao} ao)`;
    rows.tris.nodeValue = info.triangles.toLocaleString();
    rows.progs.nodeValue = String(info.programs);
    rows.geo.nodeValue = `${info.geometries} / ${info.textures}`;
    rows.texmb.nodeValue = cachedTexMB.toFixed(1);
    rows.ents.nodeValue = `${counters.entities} (${counters.units}u ${counters.buildings}b)`;
    rows.parts.nodeValue = `${counters.particles} / ${counters.batches} batches`;
    rows.res.nodeValue = `${handle.size.width}x${handle.size.height} @${handle.size.pixelRatio.toFixed(2)}`;
    rows.heap.nodeValue = mem ? `${heapMB.toFixed(1)} (+${(heapMB - heapBase).toFixed(1)})` : 'n/a';

    drawSpark();
  }

  /* ---- key toggle ------------------------------------------------------- */
  const toggleKey = options.toggleKey ?? 'F3';
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== toggleKey) return;
    e.preventDefault();
    setVisible(!visible);
  };
  window.addEventListener('keydown', onKeyDown);

  function setVisible(v: boolean): void {
    visible = v;
    root.style.display = v ? 'block' : 'none';
    if (v) {
      frameMsMax = 0;
      heapBase = 0;
    }
  }

  /* ---- capture helpers -------------------------------------------------- */
  function setUiVisible(v: boolean): void {
    if (hooks.setUiVisible) {
      hooks.setUiVisible(v);
      return;
    }
    for (const id of ['hud-root', 'menu-root']) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = v ? '' : 'hidden';
    }
    root.style.visibility = v ? '' : 'hidden';
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function waitFrames(n: number): Promise<void> {
    for (let i = 0; i < Math.max(1, n); i++) await nextFrame();
  }

  let readyPromise: Promise<void> | null = null;
  function ready(): Promise<void> {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      // Three frames guarantees: shaders compiled, env probe baked, first
      // instance buffers uploaded.
      await waitFrames(4);
      // Then let the default loading manager settle (procedural textures that
      // came back from the worker still register here).
      const mgr = THREE.DefaultLoadingManager as any;
      const deadline = performance.now() + 8000;
      while (mgr.itemsLoaded !== undefined && mgr.itemsTotal > mgr.itemsLoaded && performance.now() < deadline) {
        await nextFrame();
      }
      await waitFrames(2);
    })();
    return readyPromise;
  }

  async function screenshot(opts?: { mime?: string; quality?: number }): Promise<string> {
    const mime = opts?.mime ?? 'image/png';
    const quality = opts?.quality ?? 0.95;

    if (hooks.renderFrame) {
      // Synchronous COMPLETE frame — every system, then the draw — and an
      // immediate readback. Always correct, even without preserveDrawingBuffer.
      //
      // The "complete" half is the whole point. The hook used to be a bare
      // present, so a caller that queued work for the next system frame (the
      // usual case: `__vmVfx.advance(ms)`) got the frame BEFORE its own advance
      // and had no way to tell. `tools/flash-stack.mjs` still carries the
      // `waitFrames(3)` it grew to work around that; it is now redundant, not
      // load-bearing.
      hooks.renderFrame();
      return handle.canvas.toDataURL(mime, quality);
    }

    if (!RENDER_CONFIG.renderer.preserveDrawingBuffer) {
      console.warn(
        '[debug] screenshot() without hooks.renderFrame and without preserveDrawingBuffer ' +
          'may return a blank image. Load the page with ?shot=1 or register the renderFrame hook.'
      );
    }
    await waitFrames(2);
    return handle.canvas.toDataURL(mime, quality);
  }

  async function download(filename = `voltmarch-${Date.now()}.png`): Promise<void> {
    const url = await screenshot();
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  /* ---- canonical pose --------------------------------------------------- */
  // One scratch pose, reused: `getCameraPoseDeg` is called once per shot by the
  // harness but also from the console, and the rig's own `getPose` takes an out
  // parameter precisely so nobody has to allocate to read it.
  const poseScratch: CameraPose = { x: 0, z: 0, yaw: 0, pitch: 0, distance: 0 };
  const poseDeg: CameraPoseDeg = { x: 0, z: 0, yawDeg: 0, pitchDeg: 0, distance: 0 };

  function readPoseDeg(): CameraPoseDeg {
    cameraRig.getPose(poseScratch);
    poseDeg.x = poseScratch.x;
    poseDeg.z = poseScratch.z;
    poseDeg.yawDeg = THREE.MathUtils.radToDeg(poseScratch.yaw);
    poseDeg.pitchDeg = THREE.MathUtils.radToDeg(poseScratch.pitch);
    poseDeg.distance = poseScratch.distance;
    return poseDeg;
  }

  /* ---- stats ------------------------------------------------------------ */
  /**
   * The breakdown, COPIED. `PostChain` rewrites one record in place every frame
   * because it runs inside the frame loop; `stats()` is called four times a
   * second (see `EngineSource.read`) and already allocates, so the copy is where
   * it belongs. Handing out the live object would give every consumer a value
   * that changes underneath it — including `tools/shoot.mjs`, which serialises
   * this into `_report.json` as a statement about ONE captured frame.
   */
  function readDrawCallsByPass(totalCalls: number): DrawCallBreakdown {
    const d = post?.drawCallsByPass;
    if (d === undefined) return { shadow: 0, colour: 0, ao: 0, post: 0, total: totalCalls };
    return { shadow: d.shadow, colour: d.colour, ao: d.ao, post: d.post, total: d.total };
  }

  function stats(): FrameStats {
    /*
     * THROUGH `frameInfo()`, NEVER `renderer.info`. Under the node renderer
     * `info.render.calls` is a MONOTONIC COUNT OF `render()` INVOCATIONS since
     * page load that `reset()` does not clear, and `info.programs` is
     * `undefined` so `?? 0` would report 0 forever. Both are silent.
     * `src/render/backend.ts#normaliseInfo` is where that is written down.
     */
    const info = handle.frameInfo();
    return {
      fps,
      frameMs,
      frameMsAvg,
      frameMsMax,
      cpuMs,
      drawCalls: info.drawCalls,
      drawCallsByPass: readDrawCallsByPass(info.drawCalls),
      triangles: info.triangles,
      points: info.points,
      lines: info.lines,
      programs: info.programs,
      geometries: info.geometries,
      textures: info.textures,
      textureMB: cachedTexMB,
      heapMB,
      heapGrowthMB: heapBase ? heapMB - heapBase : 0,
      resolution: `${handle.size.width}x${handle.size.height}`,
      pixelRatio: handle.size.pixelRatio,
      quality: RENDER_CONFIG.quality,
      /*
       * `composer` IS NULL ON THE NODE PATH AND `passes` IS EMPTY, PERMANENTLY.
       * There is no `EffectComposer` and no `Pass` objects there — the chain is
       * one node expression — so this threw `Cannot read properties of null
       * (reading 'passes')` on the first `stats()` call, which is the FIRST
       * thing `tools/shoot.mjs` does after `ready()`. Fall back to the pass ids
       * the chain says are live, which is the same information the WebGL string
       * carries.
       */
      post: !post?.active
        ? 'off'
        : post.composer !== null
          ? (post.composer.passes as Array<{ constructor: { name: string } }>)
              .map((p) => p.constructor.name.replace(/^_|Pass$/g, ''))
              .join('+')
          : PASS_ORDER.filter((id) => post.isPassEnabled(id)).join('+'),
      counters: { ...counters },
    };
  }

  function dumpConfig(): string {
    const src = JSON.stringify(RENDER_CONFIG, null, 2);
    console.log(src);
    return src;
  }

  /* ---- the handle ------------------------------------------------------- */
  let paused = false;

  const api: VMHandle = {
    version,
    THREE,

    renderer: webgl,
    rendererHandle: handle,
    get scene() {
      return sceneRig.scene;
    },
    sceneRig,
    get camera() {
      return cameraRig.camera;
    },
    rig: cameraRig,
    post,
    config: RENDER_CONFIG,
    counters,
    hooks,

    configure(patch) {
      return configureRender(patch);
    },

    quality(tier) {
      applyQualityTier(tier);
    },

    setResolutionScale(scale) {
      handle.setResolutionScale(scale);
    },

    setExposure(v) {
      configureRender({ post: { grade: { exposure: v } }, renderer: { exposure: v } });
    },

    setSun(azimuthDeg, elevationDeg) {
      configureRender({ sun: { azimuth: azimuthDeg, elevation: elevationDeg } });
    },

    setCameraPose(pose) {
      cameraRig.setPose({ immediate: true, ...pose });
    },

    getCameraPose() {
      return cameraRig.getPose();
    },

    focusOn(x, z, distance) {
      cameraRig.setPose({ x, z, distance: distance ?? cameraRig.targetDistance, immediate: true });
    },

    orbit(degrees) {
      cameraRig.setYaw(cameraRig.yaw + THREE.MathUtils.degToRad(degrees), true);
    },

    getCameraPoseDeg() {
      return readPoseDeg();
    },

    setCameraPitchDeg(deg) {
      cameraRig.setPose({ pitch: THREE.MathUtils.degToRad(deg), immediate: true });
    },

    clearCameraPitch() {
      cameraRig.clearPitchOverride();
    },

    canonicalPitchDeg(distance) {
      return canonicalPitchDeg(distance);
    },

    assertCameraPose(expected, tolerance) {
      // Copied out of the scratch pose: the result is a record of a moment and
      // a caller holding two of them must not find both reading the same one.
      return comparePoseDeg(expected, { ...readPoseDeg() }, tolerance);
    },

    setSize(width, height) {
      handle.setFixedSize(width, height);
      if (width && height) cameraRig.setAspect(width, height);
    },

    setPostEnabled(v) {
      post?.setEnabled(v);
    },

    setPass(id, v) {
      post?.setPassEnabled(id, v);
    },

    setStudio(v) {
      sceneRig.setStudioMode(v);
    },

    setUiVisible,

    setOverlay(v) {
      setVisible(v);
    },

    toggleOverlay() {
      setVisible(!visible);
    },

    pause() {
      paused = true;
      hooks.pause?.();
    },

    resume() {
      paused = false;
      hooks.resume?.();
    },

    step(n = 1) {
      hooks.step?.(n);
    },

    advanceTicks(n) {
      if (typeof hooks.advanceTicks !== 'function') {
        throw new Error(
          '__VM.advanceTicks is not wired on this build — the host registered no ' +
            'advanceTicks hook. Refusing to pretend a capture advanced.',
        );
      }
      hooks.advanceTicks(n);
    },

    advanceFrames(n) {
      if (typeof hooks.advanceFrames !== 'function') {
        throw new Error(
          '__VM.advanceFrames is not wired on this build — the host registered no ' +
            'advanceFrames hook. Refusing to pretend a capture advanced.',
        );
      }
      hooks.advanceFrames(n);
    },

    setTimeScale(scale) {
      hooks.setTimeScale?.(scale);
    },

    get paused() {
      return paused;
    },

    ready,
    waitFrames,
    screenshot,
    download,
    stats,

    setCounter(name, value) {
      counters[name] = value;
    },

    registerHook(name, fn) {
      (hooks as any)[name] = fn;
    },

    onFrame(cb) {
      frameListeners.push(cb);
      return () => {
        const i = frameListeners.indexOf(cb);
        if (i >= 0) frameListeners.splice(i, 1);
      };
    },

    dumpConfig,

    renderAudit(options) {
      const b = renderBridge();
      if (b === null) return null;
      if (options?.reset === true) b.resetAudit();
      if (options?.on !== undefined) b.auditEnabled = options.on;
      if (options?.failure === true) return b.failedAudit();
      if (options?.now === true) return b.auditNow();
      return b.lastAudit();
    },
  };

  window.__VM = api;

  /* ---- frame hooks ------------------------------------------------------ */
  function beginFrame(nowMs: number): number {
    frameStart = nowMs;
    const dtMs = lastNow === 0 ? 16.7 : nowMs - lastNow;
    lastNow = nowMs;

    frameMs = dtMs;
    pushHistory(dtMs);
    // Exponential moving average, ~1 s window at 60 fps.
    frameMsAvg += (dtMs - frameMsAvg) * 0.05;
    if (dtMs > frameMsMax) frameMsMax = dtMs;
    fps = dtMs > 0 ? 1000 / frameMsAvg : 0;

    for (let i = 0; i < frameListeners.length; i++) {
      try {
        frameListeners[i](dtMs);
      } catch (err) {
        console.error('[debug] frame listener threw', err);
      }
    }

    return Math.min(dtMs / 1000, 0.25);
  }

  function endFrame(): void {
    cpuMs = performance.now() - frameStart;
    if (!visible) return;
    uiAccum += frameMs;
    if (uiAccum >= 166) {
      // ~6 Hz
      uiAccum = 0;
      updateOverlay();
    }
  }

  const dbg: DebugHandle = {
    api,
    counters,
    beginFrame,
    endFrame,
    setVisible,
    toggle() {
      setVisible(!visible);
    },
    setCounter(name, value) {
      counters[name] = value;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
      frameListeners.length = 0;
      if (window.__VM === api) delete window.__VM;
    },
  };

  console.info(
    `%c VOLTMARCH %c render boot ok — window.__VM ready (F3 for perf overlay) `,
    'background:#C0271E;color:#fff;font-weight:700;padding:2px 4px;border-radius:2px 0 0 2px',
    'background:#1B1F24;color:#7FD8C0;padding:2px 6px;border-radius:0 2px 2px 0'
  );

  return dbg;
}

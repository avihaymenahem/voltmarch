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
import type { PostChain, PassId } from './post';

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
  /** Render exactly one frame, synchronously. Required for screenshot(). */
  renderFrame?: () => void;
  pause?: () => void;
  resume?: () => void;
  /** Advance the simulation by n fixed steps while paused. */
  step?: (n: number) => void;
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
  drawCalls: number;
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

export interface VMHandle {
  readonly version: string;
  readonly THREE: typeof THREE;

  readonly renderer: THREE.WebGLRenderer;
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
  step(n?: number): void;
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
}

declare global {
  interface Window {
    __VM?: VMHandle;
  }
}

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
  const renderer = handle.renderer;
  const hooks: DebugHooks = options.hooks ?? {};
  const version = options.version ?? '1.0.0';

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
    const info = renderer.info;
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
    rows.draws.nodeValue = String(info.render.calls);
    rows.tris.nodeValue = info.render.triangles.toLocaleString();
    rows.progs.nodeValue = String(info.programs?.length ?? 0);
    rows.geo.nodeValue = `${info.memory.geometries} / ${info.memory.textures}`;
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
      // Synchronous render then immediate readback — always correct, even
      // without preserveDrawingBuffer.
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

  /* ---- stats ------------------------------------------------------------ */
  function stats(): FrameStats {
    const info = renderer.info;
    return {
      fps,
      frameMs,
      frameMsAvg,
      frameMsMax,
      cpuMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      textureMB: cachedTexMB,
      heapMB,
      heapGrowthMB: heapBase ? heapMB - heapBase : 0,
      resolution: `${handle.size.width}x${handle.size.height}`,
      pixelRatio: handle.size.pixelRatio,
      quality: RENDER_CONFIG.quality,
      post: post?.active
        ? (post.composer!.passes as Array<{ constructor: { name: string } }>)
            .map((p) => p.constructor.name.replace(/^_|Pass$/g, ''))
            .join('+')
        : 'off',
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

    renderer,
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

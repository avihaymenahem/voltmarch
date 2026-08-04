/**
 * VOLTMARCH — src/render/renderer.ts
 * =============================================================================
 * WebGLRenderer boot + the live render configuration object.
 *
 * OWNERSHIP: this file is owned by the "rendering boot" agent. It is the ONLY
 * file that constructs a THREE.WebGLRenderer.
 *
 * DESIGN NOTES
 * ------------
 * - Colour management: `THREE.ColorManagement.enabled = true`, renderer output
 *   is SRGBColorSpace. Every colour literal in RENDER_CONFIG is an sRGB hex and
 *   is converted to working (linear) space by three on assignment.
 *
 * - Tonemapping: when the post chain is alive the renderer is set to
 *   `NoToneMapping` and AgX happens inside `post.ts` -> GradePass, AFTER bloom.
 *   This is deliberate and non-negotiable: bloom must threshold in HDR, before
 *   the tonemap curve crushes highlights, or only pure white blooms.
 *   If the post chain fails to construct we fall back to ACESFilmic on the
 *   renderer so the image is still filmic rather than clipped-linear garbage.
 *   `setToneMappingMode()` is the single switch.
 *
 * - Resolution: the renderer is sized in CSS pixels; device pixel ratio is
 *   clamped (default 2.0) and multiplied by `resolutionScale`, which the
 *   auto-quality governor drops BEFORE it drops particles. A slightly softer
 *   image photographs better than a battlefield with no smoke.
 *
 * - Resize: handled by ResizeObserver on the canvas' layout box plus a
 *   `window.matchMedia('(resolution: Xdppx)')` listener so dragging the window
 *   between a 4K and a 1080p monitor re-rasterises correctly. Resizes are
 *   coalesced to one per animation frame.
 *
 * CONFIG: `RENDER_CONFIG` below is the live, mutable source of truth for the
 * whole render layer (scene.ts / camera.ts / post.ts all read it). Values are
 * literal transcriptions of the Art Direction bible. The foundation's
 * `src/core/config.ts` / `ArtStore` can push values in at boot via
 * `configureRender(partial)` — a deep merge that emits change notifications so
 * live passes re-read uniforms. Nothing here imports core, so the render layer
 * always compiles and always boots even if the rest of the tree is mid-flight.
 */

import * as THREE from 'three';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/* ========================================================================== */
/* Configuration shape                                                        */
/* ========================================================================== */

export type ToneMappingMode = 'none' | 'agx' | 'aces' | 'neutral' | 'linear';

/**
 * The PIPELINE fidelity bucket: resolution scale, shadow map size, which post
 * passes run. Owned here.
 *
 * THIS IS NOT `QualityTier` FROM `src/core/types.ts`. That one is a numeric
 * const enum (Low=0..Ultra=3) selecting a *content* budget in
 * `core/config.ts#QUALITY_PRESETS` — particle counts, decal pool, generated
 * texture size, LOD bias — and it is what `loop.quality` and `RenderContext.
 * quality` carry. Two tables, two vocabularies, deliberately: the sim must be
 * able to shrink its pools on a machine whose GPU is fine, and vice versa.
 *
 * The two are ordered identically, so `RENDER_QUALITY_TIERS.indexOf(tier)` is
 * the matching core enum value — `coreQualityTierOf()` below is the only place
 * that conversion is written down.
 */
export type RenderQualityTier = 'low' | 'medium' | 'high' | 'ultra';

/** Ordered low..ultra. The index IS `core/types.ts#QualityTier`. */
export const RENDER_QUALITY_TIERS: readonly RenderQualityTier[] = ['low', 'medium', 'high', 'ultra'];

/** Render's string tier -> core's numeric const-enum value (0..3). */
export function coreQualityTierOf(tier: RenderQualityTier): number {
  const i = RENDER_QUALITY_TIERS.indexOf(tier);
  return i < 0 ? 2 : i;
}

/** Parse `?tier=` in either vocabulary ('high' or '2'). Null when unknown. */
export function parseQualityTier(tier: string | null | undefined): RenderQualityTier | null {
  if (!tier) return null;
  const t = tier.toLowerCase();
  if ((RENDER_QUALITY_TIERS as readonly string[]).includes(t)) return t as RenderQualityTier;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0 && n < RENDER_QUALITY_TIERS.length) return RENDER_QUALITY_TIERS[n];
  return null;
}

export interface RendererConfig {
  /** Multiplies the clamped DPR. The quality governor drives this. */
  resolutionScale: number;
  /** Hard ceiling on devicePixelRatio. 2.0 is plenty for an RTS. */
  maxPixelRatio: number;
  /** MSAA is off — SMAA in the post chain is the AA path. */
  antialias: boolean;
  /** Needed only for canvas.toDataURL screenshots; auto-enabled by ?shot=. */
  preserveDrawingBuffer: boolean;
  powerPreference: WebGLPowerPreference;
  /** Exposure used by the GradePass (and by the renderer in fallback mode). */
  exposure: number;
  /** Renderer-side tonemap. 'none' while post is alive. */
  toneMapping: ToneMappingMode;
  shadows: {
    enabled: boolean;
    /** Per-cascade shadow map resolution. */
    mapSize: number;
    /**
     * THREE.PCFShadowMap. Note: PCFSoftShadowMap is DEPRECATED as of three
     * r18x (it silently falls back to PCF and logs a warning). Softness now
     * comes from `radius` below, which drives the Poisson PCF kernel.
     */
    type: THREE.ShadowMapType;
    bias: number;
    normalBias: number;
    /** Distance (m) the near cascade is fitted to. */
    nearExtent: number;
    /** Distance (m) the far cascade is fitted to. */
    farExtent: number;
    /** 0..1 multiplier on shadow darkness. */
    intensity: number;
    /** Poisson PCF radius in texels. */
    radius: number;
  };
}

export interface CameraConfig {
  fov: number;
  /** Degrees from the horizon. 52 is the RA2 read. */
  pitch: number;
  /** Degrees. 0 = looking down -Z. Free with Q/E. */
  yaw: number;
  near: number;
  far: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
  /** Pitch is allowed to breathe slightly with zoom (deg at min/max dist). */
  pitchAtMinDistance: number;
  pitchAtMaxDistance: number;
  /** metres/second at the default zoom; scales with distance. */
  panSpeed: number;
  /** Screen-edge pan hot zone in CSS px. 0 disables. */
  edgePanPixels: number;
  edgePanSpeed: number;
  /** Exponential damping rates (higher = snappier), frame-rate independent. */
  panDamping: number;
  zoomDamping: number;
  rotateDamping: number;
  /** Multiplicative zoom step per wheel notch. */
  zoomStep: number;
  yawSpeed: number;
  /** Wheel zoom pulls the world point under the cursor toward the centre. */
  zoomToCursor: number;
  /** Map bounds for the focus point, in metres. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  invertEdgePanWhenUnfocused: boolean;
}

export interface SunConfig {
  /** Degrees, compass-style. */
  azimuth: number;
  /** Degrees above horizon. */
  elevation: number;
  color: number;
  intensity: number;
  shadowColor: number;
}

export interface SkyConfig {
  zenith: number;
  horizon: number;
  ground: number;
  /** Angular diameter of the sun disk in degrees. */
  sunDiskSize: number;
  sunDiskIntensity: number;
  /** Width of the horizon haze band, degrees. */
  hazeWidth: number;
  hemiSky: number;
  hemiSkyIntensity: number;
  hemiGround: number;
  hemiGroundIntensity: number;
  /** Scene.environmentIntensity for the PMREM'd sky. */
  envIntensity: number;
  /** Cube face resolution used when baking the environment probe. */
  envResolution: number;
}

export interface FogConfig {
  color: number;
  /** Linear fog start, metres. */
  start: number;
  /** Linear fog end, metres. */
  end: number;
  /** 0..1 blend of fog colour toward the sky at the horizon. */
  aerialPerspective: number;
}

export interface AoConfig {
  enabled: boolean;
  /** World-space sample radius, metres. */
  radius: number;
  intensity: number;
  /** Contrast curve on the AO term. */
  power: number;
  samples: number;
  /** Render AO at half resolution and bilaterally upsample. */
  halfRes: boolean;
}

export interface BloomConfig {
  enabled: boolean;
  /** HDR luminance threshold. 1.25 = only genuine emissives bloom. */
  threshold: number;
  strength: number;
  radius: number;
  /** Extra gain applied to values already above threshold. */
  emissiveBoost: number;
  lensDirt: number;
}

export interface GradeConfig {
  enabled: boolean;
  mode: ToneMappingMode;
  exposure: number;
  contrast: number;
  saturation: number;
  /** Extra desaturation applied to shadows only. */
  shadowSaturation: number;
  shadowTint: number;
  midTint: number;
  highlightTint: number;
  lift: number;
  gain: number;
  vignette: number;
  vignetteSoftness: number;
  grain: number;
  grainSize: number;
  chromaticAberration: number;
  sharpen: number;
}

export interface PostConfig {
  enabled: boolean;
  ao: AoConfig;
  bloom: BloomConfig;
  grade: GradeConfig;
  smaa: { enabled: boolean };
}

export interface SceneExtrasConfig {
  /**
   * A 512 m procedural ground plane so the very first frame is a readable
   * battlefield rather than a void. `TerrainModule` calls
   * `sceneRig.setPlaceholderGroundVisible(false)` the moment real terrain
   * chunks exist. Nothing else depends on it.
   */
  placeholderGround: boolean;
  placeholderGroundSize: number;
  placeholderGroundColor: number;
}

export interface RenderConfig {
  renderer: RendererConfig;
  camera: CameraConfig;
  sun: SunConfig;
  sky: SkyConfig;
  fog: FogConfig;
  post: PostConfig;
  scene: SceneExtrasConfig;
  quality: RenderQualityTier;
}

/* ========================================================================== */
/* Defaults — literal transcription of the Art Direction bible (noon mood)     */
/* ========================================================================== */

export const RENDER_CONFIG: RenderConfig = {
  renderer: {
    resolutionScale: 1.0,
    maxPixelRatio: 2.0,
    antialias: false, // SMAA does the AA; MSAA on a deferred-ish chain is waste
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    exposure: 1.05,
    toneMapping: 'agx',
    shadows: {
      enabled: true,
      mapSize: 2048,
      type: THREE.PCFShadowMap,
      bias: -0.0005,
      normalBias: 0.02,
      nearExtent: 90,
      farExtent: 320,
      intensity: 0.92,
      radius: 2.2,
    },
  },

  camera: {
    fov: 36,
    pitch: 52,
    yaw: 0,
    near: 1.0,
    far: 900,
    distance: 55,
    minDistance: 30,
    maxDistance: 140,
    pitchAtMinDistance: 46,
    pitchAtMaxDistance: 58,
    panSpeed: 42,
    edgePanPixels: 8,
    edgePanSpeed: 46,
    panDamping: 14,
    zoomDamping: 12,
    rotateDamping: 10,
    zoomStep: 1.14,
    yawSpeed: 70,
    zoomToCursor: 0.75,
    bounds: { minX: -32, minZ: -32, maxX: 544, maxZ: 544 }, // 512 m map + slack
    invertEdgePanWhenUnfocused: false,
  },

  sun: {
    azimuth: 312,
    elevation: 38,
    color: 0xffe7c4, // ~5200 K
    intensity: 3.1,
    shadowColor: 0x2a3550,
  },

  sky: {
    zenith: 0x3e6fa8,
    horizon: 0xc6d4de,
    ground: 0x6e6252,
    sunDiskSize: 0.6,
    sunDiskIntensity: 12.0,
    hazeWidth: 8,
    hemiSky: 0x8fb6e8,
    hemiSkyIntensity: 0.55,
    hemiGround: 0x6a5a48,
    hemiGroundIntensity: 0.35,
    envIntensity: 0.85,
    envResolution: 256,
  },

  fog: {
    color: 0xb8c6d6,
    start: 60,
    end: 520,
    aerialPerspective: 0.35,
  },

  post: {
    enabled: true,
    ao: {
      enabled: true,
      radius: 1.6,
      intensity: 0.85,
      power: 1.6,
      samples: 12,
      halfRes: true,
    },
    bloom: {
      enabled: true,
      threshold: 1.25,
      strength: 0.55,
      radius: 0.7,
      emissiveBoost: 1.6,
      lensDirt: 0.12,
    },
    grade: {
      enabled: true,
      mode: 'agx',
      exposure: 1.05,
      contrast: 1.06,
      saturation: 1.04,
      shadowSaturation: 0.88,
      shadowTint: 0x1b2a44,
      midTint: 0x8c8578,
      highlightTint: 0xffebc8,
      lift: 0x0a1220,
      gain: 0xfff4e2,
      vignette: 0.28,
      vignetteSoftness: 0.55,
      grain: 0.018,
      grainSize: 1.4,
      chromaticAberration: 0.0012,
      sharpen: 0.22,
    },
    smaa: { enabled: true },
  },

  scene: {
    placeholderGround: true,
    placeholderGroundSize: 512,
    placeholderGroundColor: 0x6e6252,
  },

  quality: 'high',
};

/* -------------------------------------------------------------------------- */
/* Config plumbing                                                            */
/* -------------------------------------------------------------------------- */

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ConfigListener = (changed: ReadonlyArray<string>) => void;

const configListeners: ConfigListener[] = [];

/** Subscribe to configureRender(). Returns an unsubscribe function. */
export function onConfigChanged(fn: ConfigListener): () => void {
  configListeners.push(fn);
  return () => {
    const i = configListeners.indexOf(fn);
    if (i >= 0) configListeners.splice(i, 1);
  };
}

function deepMerge(target: any, patch: any, prefix: string, changed: string[]): void {
  for (const key in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const next = patch[key];
    if (next === undefined) continue;
    const path = prefix ? prefix + '.' + key : key;
    const cur = target[key];
    if (next !== null && typeof next === 'object' && !Array.isArray(next) && typeof cur === 'object' && cur !== null) {
      deepMerge(cur, next, path, changed);
    } else if (cur !== next) {
      target[key] = next;
      changed.push(path);
    }
  }
}

/**
 * Deep-merge a partial config into the live RENDER_CONFIG and notify listeners
 * with the list of dotted paths that actually changed. Implementations must
 * mutate uniforms in response — never rebuild a texture or geometry here, or a
 * slider drag becomes a slideshow.
 */
export function configureRender(patch: DeepPartial<RenderConfig>): ReadonlyArray<string> {
  const changed: string[] = [];
  deepMerge(RENDER_CONFIG as any, patch as any, '', changed);
  if (changed.length) {
    for (let i = 0; i < configListeners.length; i++) {
      try {
        configListeners[i](changed);
      } catch (err) {
        console.error('[render] config listener threw', err);
      }
    }
  }
  return changed;
}

/** True if any changed path starts with `prefix`. Cheap dispatch filter. */
export function touched(changed: ReadonlyArray<string>, prefix: string): boolean {
  for (let i = 0; i < changed.length; i++) {
    const p = changed[i];
    if (p === prefix || p.startsWith(prefix + '.')) return true;
  }
  return false;
}

/* ========================================================================== */
/* Quality tiers                                                              */
/* ========================================================================== */

/**
 * PIPELINE presets. Named apart from `core/config.ts#QUALITY_PRESETS`, which is
 * a different table of different fields keyed by the numeric core tier; the two
 * used to share a bare name and be one import away from silently swapping.
 */
const RENDER_QUALITY_PRESETS: Record<RenderQualityTier, DeepPartial<RenderConfig>> = {
  low: {
    renderer: { resolutionScale: 0.75, maxPixelRatio: 1.0, shadows: { enabled: true, mapSize: 1024 } },
    post: { ao: { enabled: false }, bloom: { enabled: true, radius: 0.5 }, smaa: { enabled: false } },
  },
  medium: {
    renderer: { resolutionScale: 0.9, maxPixelRatio: 1.5, shadows: { enabled: true, mapSize: 1536 } },
    post: { ao: { enabled: true, samples: 8, halfRes: true }, bloom: { enabled: true }, smaa: { enabled: true } },
  },
  high: {
    renderer: { resolutionScale: 1.0, maxPixelRatio: 2.0, shadows: { enabled: true, mapSize: 2048 } },
    post: { ao: { enabled: true, samples: 12, halfRes: true }, bloom: { enabled: true }, smaa: { enabled: true } },
  },
  ultra: {
    renderer: { resolutionScale: 1.0, maxPixelRatio: 2.0, shadows: { enabled: true, mapSize: 4096 } },
    post: { ao: { enabled: true, samples: 16, halfRes: false }, bloom: { enabled: true }, smaa: { enabled: true } },
  },
};

/** Apply a quality preset on top of the current config. */
export function applyQualityTier(tier: RenderQualityTier): ReadonlyArray<string> {
  const preset = RENDER_QUALITY_PRESETS[tier];
  if (!preset) return [];
  const changed = configureRender(preset);
  if (RENDER_CONFIG.quality !== tier) {
    RENDER_CONFIG.quality = tier;
  }
  return changed;
}

/** Crude but useful auto-detection for first boot. */
export function detectQualityTier(): RenderQualityTier {
  if (typeof navigator === 'undefined') return 'high';
  const mem = (navigator as any).deviceMemory as number | undefined;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (mobile) return 'low';
  if (cores <= 4 || (mem !== undefined && mem <= 4)) return 'medium';
  if (cores >= 12 && dpr <= 2 && (mem === undefined || mem >= 8)) return 'ultra';
  return 'high';
}

/* ========================================================================== */
/* Renderer handle                                                            */
/* ========================================================================== */

export interface RenderSize {
  /** CSS pixels of the layout box. */
  cssWidth: number;
  cssHeight: number;
  /** Drawing-buffer pixels (css * dpr * resolutionScale, rounded). */
  width: number;
  height: number;
  /** Effective pixel ratio actually handed to three. */
  pixelRatio: number;
}

export type ResizeListener = (size: Readonly<RenderSize>) => void;

export interface RendererHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly size: Readonly<RenderSize>;
  readonly capabilities: {
    webgl2: boolean;
    maxTextureSize: number;
    maxSamples: number;
    anisotropy: number;
    floatRenderTargets: boolean;
    /** Unmasked GPU string when WEBGL_debug_renderer_info is available. */
    gpu: string;
  };
  /** Force a resize evaluation (also called automatically). */
  resize(force?: boolean): void;
  /** Override the layout size, e.g. the screenshot harness at a fixed res. */
  setFixedSize(width: number | null, height: number | null): void;
  setResolutionScale(scale: number): void;
  setToneMappingMode(mode: ToneMappingMode): void;
  setExposure(v: number): void;
  setShadowsEnabled(v: boolean): void;
  onResize(fn: ResizeListener): () => void;
  /** Reset renderer.info.render counters — call once per rendered frame. */
  beginFrame(): void;
  dispose(): void;
}

const TONE_MAPPING_LOOKUP: Record<ToneMappingMode, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  // AgXToneMapping / NeutralToneMapping exist in three >= r160; guard anyway.
  agx: (THREE as any).AgXToneMapping ?? THREE.ACESFilmicToneMapping,
  neutral: (THREE as any).NeutralToneMapping ?? THREE.ACESFilmicToneMapping,
};

export interface CreateRendererOptions {
  /** Existing canvas (index.html ships `#gl`). One is created if omitted. */
  canvas?: HTMLCanvasElement | null;
  /** Element whose client box drives the size. Defaults to the canvas parent. */
  container?: HTMLElement | null;
  /** Force preserveDrawingBuffer (screenshot harness). */
  preserveDrawingBuffer?: boolean;
}

export function createRenderer(options: CreateRendererOptions = {}): RendererHandle {
  const cfg = RENDER_CONFIG.renderer;

  THREE.ColorManagement.enabled = true;

  let canvas = options.canvas ?? (document.getElementById('gl') as HTMLCanvasElement | null);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gl';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
    document.body.appendChild(canvas);
  }

  // ?shot= implies we will read pixels back out of the canvas.
  const wantsShot =
    typeof location !== 'undefined' && /[?&]shot=/.test(location.search);
  const preserveDrawingBuffer =
    options.preserveDrawingBuffer ?? (cfg.preserveDrawingBuffer || wantsShot);
  if (preserveDrawingBuffer) cfg.preserveDrawingBuffer = true;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: cfg.antialias,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer,
    powerPreference: cfg.powerPreference,
    failIfMajorPerformanceCaveat: false,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPPING_LOOKUP[cfg.toneMapping] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  renderer.autoClear = true;
  renderer.sortObjects = true;
  renderer.info.autoReset = false; // we reset once per frame in beginFrame()

  renderer.shadowMap.enabled = cfg.shadows.enabled;
  renderer.shadowMap.type = cfg.shadows.type;
  renderer.shadowMap.autoUpdate = true;

  // Nice default background so frame zero is never a black void.
  renderer.setClearColor(new THREE.Color(RENDER_CONFIG.sky.horizon), 1);

  const gl = renderer.getContext();
  let gpu = 'unknown';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) gpu = String(gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL));
  } catch {
    /* blocked by privacy settings — fine */
  }

  const capabilities = {
    webgl2: renderer.capabilities.isWebGL2 !== false,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    maxSamples: (renderer.capabilities as any).maxSamples ?? 0,
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
    floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float'),
    gpu,
  };

  const container = options.container ?? canvas.parentElement ?? document.body;

  const size: RenderSize = { cssWidth: 1, cssHeight: 1, width: 1, height: 1, pixelRatio: 1 };
  const resizeListeners: ResizeListener[] = [];

  let fixedWidth: number | null = null;
  let fixedHeight: number | null = null;
  let resizePending = false;
  let disposed = false;

  function measure(): { w: number; h: number } {
    if (fixedWidth !== null && fixedHeight !== null) return { w: fixedWidth, h: fixedHeight };
    // Prefer the container box; fall back to the viewport (fullscreen canvas).
    const rect = container.getBoundingClientRect();
    let w = Math.round(rect.width);
    let h = Math.round(rect.height);
    if (w < 2 || h < 2) {
      w = Math.round(window.innerWidth);
      h = Math.round(window.innerHeight);
    }
    return { w: Math.max(2, w), h: Math.max(2, h) };
  }

  function doResize(force: boolean): void {
    if (disposed) return;
    const { w, h } = measure();
    // A fixed size means a screenshot: 1 drawing-buffer pixel per requested
    // pixel, so shots are byte-comparable across machines with different DPR.
    const dpr =
      fixedWidth !== null ? 1 : Math.min(window.devicePixelRatio || 1, Math.max(0.5, cfg.maxPixelRatio));
    const effective =
      fixedWidth !== null ? 1 : Math.max(0.25, Math.min(4, dpr * cfg.resolutionScale));
    const pw = Math.max(2, Math.round(w * effective));
    const ph = Math.max(2, Math.round(h * effective));

    if (!force && w === size.cssWidth && h === size.cssHeight && pw === size.width && ph === size.height) return;

    size.cssWidth = w;
    size.cssHeight = h;
    size.width = pw;
    size.height = ph;
    size.pixelRatio = effective;

    renderer.setPixelRatio(effective);
    // updateStyle=false when we are driving a fixed-size offscreen render.
    renderer.setSize(w, h, fixedWidth === null);

    for (let i = 0; i < resizeListeners.length; i++) {
      try {
        resizeListeners[i](size);
      } catch (err) {
        console.error('[render] resize listener threw', err);
      }
    }
  }

  function scheduleResize(): void {
    if (resizePending || disposed) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      doResize(false);
    });
  }

  // --- resize wiring -------------------------------------------------------
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleResize);
    ro.observe(container);
  }
  window.addEventListener('resize', scheduleResize, { passive: true });
  window.addEventListener('orientationchange', scheduleResize, { passive: true });

  // DPR changes (monitor swap / browser zoom) do not fire `resize` reliably.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = () => {
    if (dprQuery) dprQuery.removeEventListener?.('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener?.('change', onDprChange);
  };
  const onDprChange = () => {
    scheduleResize();
    watchDpr();
  };
  try {
    watchDpr();
  } catch {
    /* older Safari — window resize covers most cases */
  }

  const onContextLost = (e: Event) => {
    e.preventDefault();
    console.warn('[render] WebGL context lost');
  };
  const onContextRestored = () => {
    console.warn('[render] WebGL context restored — forcing full resize');
    doResize(true);
  };
  canvas.addEventListener('webglcontextlost', onContextLost as EventListener, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  doResize(true);

  // --- react to live config edits -----------------------------------------
  const unsubscribeConfig = onConfigChanged((changed) => {
    if (touched(changed, 'renderer.resolutionScale') || touched(changed, 'renderer.maxPixelRatio')) {
      doResize(true);
    }
    if (touched(changed, 'renderer.toneMapping')) {
      handle.setToneMappingMode(cfg.toneMapping);
    }
    if (touched(changed, 'renderer.exposure')) {
      renderer.toneMappingExposure = cfg.exposure;
    }
    if (touched(changed, 'renderer.shadows.enabled')) {
      renderer.shadowMap.enabled = cfg.shadows.enabled;
      renderer.shadowMap.needsUpdate = true;
    }
    if (touched(changed, 'renderer.shadows.type')) {
      renderer.shadowMap.type = cfg.shadows.type;
      renderer.shadowMap.needsUpdate = true;
    }
  });

  const handle: RendererHandle = {
    renderer,
    canvas,
    size,
    capabilities,

    resize(force = false) {
      doResize(force);
    },

    setFixedSize(width, height) {
      fixedWidth = width;
      fixedHeight = height;
      if (width === null || height === null) {
        canvas!.style.width = '';
        canvas!.style.height = '';
      } else {
        // Keep the element visually the requested size so HUD overlays line up.
        canvas!.style.width = width + 'px';
        canvas!.style.height = height + 'px';
      }
      doResize(true);
    },

    setResolutionScale(scale) {
      const s = Math.max(0.25, Math.min(2, scale));
      if (Math.abs(s - cfg.resolutionScale) < 1e-4) return;
      cfg.resolutionScale = s;
      doResize(true);
    },

    setToneMappingMode(mode) {
      cfg.toneMapping = mode;
      renderer.toneMapping = TONE_MAPPING_LOOKUP[mode] ?? THREE.NoToneMapping;
      renderer.toneMappingExposure = mode === 'none' ? 1.0 : cfg.exposure;
    },

    setExposure(v) {
      cfg.exposure = v;
      RENDER_CONFIG.post.grade.exposure = v;
      if (renderer.toneMapping !== THREE.NoToneMapping) renderer.toneMappingExposure = v;
    },

    setShadowsEnabled(v) {
      cfg.shadows.enabled = v;
      renderer.shadowMap.enabled = v;
      renderer.shadowMap.needsUpdate = true;
    },

    onResize(fn) {
      resizeListeners.push(fn);
      fn(size);
      return () => {
        const i = resizeListeners.indexOf(fn);
        if (i >= 0) resizeListeners.splice(i, 1);
      };
    },

    beginFrame() {
      renderer.info.reset();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeConfig();
      ro?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('orientationchange', scheduleResize);
      dprQuery?.removeEventListener?.('change', onDprChange);
      canvas!.removeEventListener('webglcontextlost', onContextLost as EventListener);
      canvas!.removeEventListener('webglcontextrestored', onContextRestored);
      resizeListeners.length = 0;
      renderer.dispose();
    },
  };

  if (DEV) {
    console.info(
      `[render] WebGL${capabilities.webgl2 ? '2' : '1'} · ${capabilities.gpu} · ` +
        `${size.width}x${size.height} @ ${size.pixelRatio.toFixed(2)}x · ` +
        `maxTex ${capabilities.maxTextureSize} · aniso ${capabilities.anisotropy}`
    );
  }

  return handle;
}

/* ========================================================================== */
/* Small shared helpers used by scene.ts / post.ts                            */
/* ========================================================================== */

/** Convert an sRGB hex literal into a working-space THREE.Color. */
export function srgb(hex: number, out?: THREE.Color): THREE.Color {
  const c = out ?? new THREE.Color();
  c.setHex(hex, THREE.SRGBColorSpace);
  return c;
}

/** Convert an sRGB hex into a linear-space Vector3 for raw shader uniforms. */
export function srgbVec3(hex: number, out?: THREE.Vector3): THREE.Vector3 {
  const c = srgb(hex);
  const v = out ?? new THREE.Vector3();
  return v.set(c.r, c.g, c.b);
}

/**
 * Compass azimuth (degrees, 0 = +Z / "north", increasing clockwise) and
 * elevation (degrees above horizon) -> a unit direction pointing FROM the
 * origin TOWARD the sun. Shared by scene.ts and the sky shader so the disk and
 * the shadows can never disagree.
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out?: THREE.Vector3): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  const v = out ?? new THREE.Vector3();
  return v.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
}

/** Frame-rate independent exponential damping factor. */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

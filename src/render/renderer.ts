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
 *   TWO RULES GOVERN A RESIZE, AND BOTH ARE LOAD-BEARING. First, a resize that
 *   does not change the drawing buffer must not touch it — assigning to
 *   `canvas.width` reallocates even when the value is unchanged, and the product
 *   calls `resize(true)` on every window event. Second, a reallocation must be
 *   followed by a complete frame BEFORE the browser paints, or the compositor
 *   presents the flat replacement buffer. That is `RepaintGuard`, and it is the
 *   fix for the recurring macOS "black flash" report; see that file for the
 *   measurement.
 *
 * - Compositing: this file also owns the PANEL-BLUR GATE (see "Compositing
 *   policy" below). A `backdrop-filter` over an accelerated WebGL canvas is a
 *   known source of intermittent black frames on macOS; because this file is
 *   the only one that creates the canvas, it is also the one that decides
 *   whether the CSS layers above it are allowed to sample it.
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

import { RepaintGuard } from './RepaintGuard';

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
  /**
   * MSAA samples on the composer's HDR target. 0 disables it.
   *
   * ── THE AA FLAG THAT WAS NEVER THE AA FLAG ───────────────────────────────
   * `RendererConfig.antialias` is `false` and carries the note "SMAA does the
   * AA; MSAA on a deferred-ish chain is waste". That flag is a WebGL CONTEXT
   * attribute and it governs the DEFAULT FRAMEBUFFER. This renderer draws the
   * scene into `WebGLRenderTarget` and composites from there, so the context
   * flag was never going to do anything either way — the only MSAA lever this
   * architecture has is `samples` on that target, and it was 0. The result was
   * a renderer with no geometric antialiasing at all, and a comment explaining
   * why that was on purpose.
   *
   * SMAA does not cover the gap. It is a morphological pass over the finished
   * LDR image, so it can only smooth an edge that was RASTERISED; a 1 px pipe
   * or panel stripe whose centre falls between two pixel centres is simply
   * absent from the image, and no post filter recovers it. That is the reported
   * "straight lines look like broken pixelated lines", and it is worst on this
   * game's art precisely because "Models: boxes are a bug" pushes detail into
   * real thin geometry rather than into textures.
   *
   * Measured on a 3x2 structure at 1200x900, counting strong vertical edges
   * with no matching edge in either neighbouring row (i.e. lines that broke):
   *
   *     samples 0, render scale 1.0    12.5%     <- shipped
   *     samples 4, render scale 1.0     8.2%
   *     samples 0, render scale 1.5     9.1%
   *     samples 0, render scale 2.0     6.4%
   *
   * SMAA was enabled for every one of those rows. 4x MSAA buys most of what
   * 2x supersampling buys for a small fraction of the fill cost, because it
   * multisamples COVERAGE and shades once — which is exactly and only the
   * geometric-edge problem this is.
   */
  msaaSamples: number;
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
      /*
       * GRAIN AND CHROMATIC ABERRATION ARE BANNED, AND BOTH SHIPPED ON.
       *
       * CLAUDE.md lists them by name among the effects "explicitly banned
       * because they read as 'generic engine' and lose points", and
       * `docs/SPEC_DRIFT_AUDIT.md` finding 8 recorded them shipping enabled
       * against that ban on 2026-08-05. They were still enabled.
       *
       * `core/config.ts` already had them at 0 — which is why a search there
       * says the ban is honoured. It is not: these defaults and the literals in
       * `shell/Settings.ts#applySettings` both override it, and `filmGrain`
       * defaults to true, so the values below were live on frame one of every
       * session. Two knobs for one quantity in three files.
       *
       * What the player saw: grain re-rolled at 24 Hz in 1.4 px blocks, ~9 of
       * 255 levels peak-to-peak, animated over the whole frame; and CA
       * displacing R against B by ~5 px at 1080p in the outer third. Neither is
       * something SMAA can touch — SMAA's edge threshold is 0.1 and grain never
       * trips it — so both survive antialiasing and read exactly as "even with
       * antialiasing on, I can see artifacts".
       *
       * Set to 0 at the source. `grainSize` is kept because it is inert while
       * `grain` is 0 and is the parameter a dither would need.
       */
      grain: 0,
      grainSize: 1.4,
      chromaticAberration: 0,
      sharpen: 0.22,
    },
    smaa: { enabled: true },
    msaaSamples: 4,
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
  /*
   * `msaaSamples` per tier. It is the ONLY geometric antialiasing this pipeline
   * has (see `PostConfig.msaaSamples`), so it is spent before AO and before
   * shadow resolution: a thin pipe that breaks into dashes is more visible than
   * a softer contact shadow, and the art direction leans on thin geometry.
   *
   * `low` keeps 0. That tier already renders at 0.75 and caps DPR at 1.0, and a
   * multisampled half-float target is bandwidth on a machine that has none —
   * the tier's whole premise is that it is fill-bound.
   */
  low: {
    renderer: { resolutionScale: 0.75, maxPixelRatio: 1.0, shadows: { enabled: true, mapSize: 1024 } },
    post: {
      ao: { enabled: false }, bloom: { enabled: true, radius: 0.5 },
      smaa: { enabled: false }, msaaSamples: 0,
    },
  },
  medium: {
    renderer: { resolutionScale: 0.9, maxPixelRatio: 1.5, shadows: { enabled: true, mapSize: 1536 } },
    post: {
      ao: { enabled: true, samples: 8, halfRes: true }, bloom: { enabled: true },
      smaa: { enabled: true }, msaaSamples: 4,
    },
  },
  high: {
    renderer: { resolutionScale: 1.0, maxPixelRatio: 2.0, shadows: { enabled: true, mapSize: 2048 } },
    post: {
      ao: { enabled: true, samples: 12, halfRes: true }, bloom: { enabled: true },
      smaa: { enabled: true }, msaaSamples: 4,
    },
  },
  ultra: {
    renderer: { resolutionScale: 1.0, maxPixelRatio: 2.0, shadows: { enabled: true, mapSize: 4096 } },
    post: {
      ao: { enabled: true, samples: 16, halfRes: false }, bloom: { enabled: true },
      smaa: { enabled: true }, msaaSamples: 8,
    },
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

/**
 * What kind of GPU are we actually running on?
 *
 * `'software'` — SwiftShader/llvmpipe. Anything above `low` is unusable.
 * `'integrated'` — shares system memory with the CPU. The important case.
 * `'discrete'` — has its own VRAM.
 * `'unknown'` — the driver masked the string, which browsers increasingly do.
 */
export type GpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/**
 * Classify the GPU from its unmasked renderer string.
 *
 * Order matters: "Radeon RX 6800" and "AMD Radeon(TM) Graphics" both contain
 * "Radeon", and only the second is integrated. Discrete markers are therefore
 * tested first, and the integrated test is what is LEFT of each vendor.
 */
export function classifyGpu(renderer: string): GpuClass {
  const s = renderer.toLowerCase();
  if (s.includes('swiftshader') || s.includes('llvmpipe') || s.includes('software')) return 'software';

  // Discrete first — these names are unambiguous.
  if (/\b(geforce|rtx|gtx|quadro|titan)\b/.test(s)) return 'discrete';
  if (/radeon\s*(rx|pro)\b|firepro|\bw\d{4}\b/.test(s)) return 'discrete';
  if (/\barc\b.*\b(a\d{3})\b/.test(s)) return 'discrete';

  // Apple silicon shares memory but its GPU is genuinely capable; treat it as
  // discrete-class so Macs are not needlessly downgraded.
  if (/apple\s+m\d/.test(s)) return 'discrete';

  // Everything left that names one of the big three is an iGPU. The reported
  // string on this project's own dev machine — "AMD Radeon(TM) Graphics" with
  // no model number — is exactly this case.
  if (/\b(intel|uhd|hd graphics|iris)\b/.test(s)) return 'integrated';
  if (/\bradeon\b|\bvega\b|\bamd\b/.test(s)) return 'integrated';
  if (/\bmali\b|\badreno\b|\bpowervr\b/.test(s)) return 'integrated';

  return 'unknown';
}

/**
 * Read the GPU string without owning a renderer yet.
 *
 * `detectQualityTier()` runs in `Bootstrap` BEFORE `createRenderer`, so there
 * is no context to ask. A throwaway one costs a few milliseconds once at boot
 * and is the only way to make this decision on evidence.
 */
export function probeGpuRenderer(): string | null {
  if (typeof document === 'undefined') return null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl === null) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  } finally {
    canvas = null;
  }
}

/**
 * Auto-detection for first boot.
 *
 * THIS USED TO IGNORE THE GPU ENTIRELY. It picked a tier from CPU core count
 * and system RAM, so a 16-core Ryzen with 32 GB and *integrated* Radeon
 * graphics was handed `ultra` — 4096 shadow maps, 2x pixel ratio, and
 * FULL-RESOLUTION GTAO at 16 samples. The reported symptom was the obvious one:
 * 100% GPU and a game that barely moves.
 *
 * Core count is a poor proxy for GPU power in general and an actively
 * BACKWARDS one for integrated graphics, where a strong CPU usually means a
 * shared, weak GPU competing for the same memory bandwidth. So the GPU is now
 * the primary signal and the CPU/RAM heuristic only refines within a class.
 */
export function detectQualityTier(): RenderQualityTier {
  if (typeof navigator === 'undefined') return 'high';

  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (mobile) return 'low';

  const gpu = probeGpuRenderer();
  const klass: GpuClass = gpu === null ? 'unknown' : classifyGpu(gpu);

  if (klass === 'software') return 'low';

  if (klass === 'integrated') {
    // An iGPU is fill-rate and bandwidth starved long before it runs out of
    // triangles. `medium` is the honest ceiling: half-res AO, a 1536 shadow
    // map, and a 0.9 resolution scale. A generous machine gets the scale back
    // but NOT full-res AO or a 4096 shadow map, which are the two costs that
    // actually saturate it.
    return cores >= 8 && (mem === undefined || mem >= 8) ? 'medium' : 'low';
  }

  // Discrete, or a masked string we have to guess at. Keep the old CPU/RAM
  // shape here, where it is a defensible proxy for "is this a modern machine".
  if (cores <= 4 || (mem !== undefined && mem <= 4)) return 'medium';
  if (klass === 'discrete' && cores >= 12 && dpr <= 2 && (mem === undefined || mem >= 8)) return 'ultra';
  return 'high';
}

/* ========================================================================== */
/* Compositing policy — the panel-blur gate                                   */
/*                                                                            */
/* WHY THIS LIVES IN THE RENDERER FILE                                        */
/* ----------------------------------                                         */
/* `hud.css` and `shell.css` paint dark-glass panels with                      */
/* `backdrop-filter: blur(...)`. A backdrop-filter forces the compositor to    */
/* read back everything painted behind the element — which, for this game, is  */
/* an accelerated WebGL canvas. On macOS (Metal) that read-back is a           */
/* long-standing source of INTERMITTENT BLACK FRAMES in both Chromium and      */
/* WebKit: the backdrop snapshot is occasionally sampled before the canvas     */
/* layer has been drawn into for that frame, and the filter happily blurs an   */
/* empty (black) source. It shows up exactly as reported — a black flash for a */
/* split second, a few times per session, never reproducible on demand.        */
/*                                                                            */
/* `alpha: false` on the context (see `createRenderer`) makes the canvas an    */
/* opaque compositing layer, which is the fragile path; an alpha-enabled       */
/* canvas is composited differently. See the ALPHA note in `createRenderer`    */
/* for why we did NOT flip it.                                                 */
/*                                                                            */
/* The fix is to stop asking the compositor to do the fragile thing where it   */
/* is known to be fragile, rather than to drop the look everywhere. The gate:  */
/*                                                                            */
/*   mode 'auto' (default) -> blur ON, except on Apple platforms               */
/*   mode 'on'             -> blur ON wherever the browser supports it         */
/*   mode 'off'            -> blur OFF always                                  */
/*                                                                            */
/* When the blur is off, `<html>` carries `vm-no-blur` and the two stylesheets  */
/* swap `--vm-blur` to `none` and raise the panel opacity. The panels stay      */
/* translucent dark glass; only the blur — the fragile part — is gone.          */
/*                                                                            */
/* `?blur=on|off|auto` overrides at boot, so the exact artefact can be A/B'd    */
/* on the affected machine without shipping a build.                           */
/* ========================================================================== */

export type PanelBlurMode = 'auto' | 'on' | 'off';

/** Stamped on `<html>` when the blur must not run. The stylesheets key off it. */
export const NO_BLUR_CLASS = 'vm-no-blur';

export interface CompositingProbe {
  /** `backdrop-filter` (or the -webkit- alias) is supported at all. */
  readonly supported: boolean;
  /** The platform is one where blur-over-WebGL is known to drop black frames. */
  readonly risky: boolean;
  /** Best-effort platform string, for the boot log. */
  readonly platform: string;
  /** Human-readable justification, logged once. */
  readonly reason: string;
}

/**
 * Pure classifier — no DOM, no globals. Split out from `compositingProbe()` so
 * the platform table is unit-testable with synthetic UA strings.
 */
export function classifyCompositing(
  platform: string,
  userAgent: string,
  supported: boolean,
  maxTouchPoints = 0
): CompositingProbe {
  if (!supported) {
    return {
      supported: false,
      risky: true,
      platform,
      reason: 'backdrop-filter unsupported',
    };
  }
  const apple =
    /mac|iphone|ipad|ipod|ios/i.test(platform) ||
    /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(userAgent) ||
    // iPadOS 13+ reports itself as a Mac; touch points are the only tell.
    (/MacIntel/i.test(platform) && maxTouchPoints > 1);
  return {
    supported: true,
    risky: apple,
    platform,
    reason: apple
      ? 'Apple/Metal compositing — backdrop-filter over WebGL drops black frames'
      : 'backdrop-filter over WebGL is stable on this platform',
  };
}

/** Resolve a mode against a probe. Pure; the single place the policy is written. */
export function resolvePanelBlur(
  mode: PanelBlurMode,
  probe: Pick<CompositingProbe, 'supported' | 'risky'>
): boolean {
  if (!probe.supported) return false;
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return !probe.risky;
}

function detectPlatformString(): string {
  if (typeof navigator === 'undefined') return '';
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const fromHints = typeof uaData?.platform === 'string' ? uaData.platform : '';
  return fromHints || navigator.platform || '';
}

function detectBackdropSupport(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  try {
    return (
      CSS.supports('backdrop-filter', 'blur(1px)') ||
      CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
    );
  } catch {
    return false;
  }
}

let probeCache: CompositingProbe | null = null;

/** Probe the host once. Pass `true` to re-run it (tests, DPR/display changes). */
export function compositingProbe(force = false): CompositingProbe {
  if (probeCache !== null && !force) return probeCache;
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    probeCache = { supported: false, risky: true, platform: '', reason: 'no DOM' };
    return probeCache;
  }
  probeCache = classifyCompositing(
    detectPlatformString(),
    navigator.userAgent || '',
    detectBackdropSupport(),
    navigator.maxTouchPoints || 0
  );
  return probeCache;
}

let panelBlurMode: PanelBlurMode = 'auto';
let panelBlurActive = false;

/**
 * Apply a blur mode. Returns the EFFECTIVE state, which is not the same as the
 * mode: `'auto'` and `'on'` still resolve to off where the browser cannot do it.
 * Safe to call before the DOM exists (tests) — it just records the mode.
 */
export function setPanelBlurMode(mode: PanelBlurMode): boolean {
  panelBlurMode = mode;
  panelBlurActive = resolvePanelBlur(mode, compositingProbe());
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.classList.toggle(NO_BLUR_CLASS, !panelBlurActive);
    root.dataset.vmPanelBlur = panelBlurActive ? 'on' : 'off';
  }
  return panelBlurActive;
}

export function getPanelBlurMode(): PanelBlurMode {
  return panelBlurMode;
}

/** The state actually in force right now (mode resolved against the probe). */
export function isPanelBlurActive(): boolean {
  return panelBlurActive;
}

function urlPanelBlurOverride(): PanelBlurMode | null {
  if (typeof location === 'undefined' || !location.search) return null;
  const v = new URLSearchParams(location.search).get('blur');
  if (v === null) return null;
  const s = v.toLowerCase();
  if (s === '' || s === 'on' || s === '1' || s === 'true') return 'on';
  if (s === 'off' || s === '0' || s === 'false') return 'off';
  if (s === 'auto') return 'auto';
  return null;
}

let urlForcedMode: PanelBlurMode | null = null;

/**
 * The mode `?blur=` claimed at boot, or null when the URL said nothing.
 *
 * The settings screen persists a panel-blur choice and pushes it through
 * `setPanelBlurMode` — which would silently overwrite the URL override and take
 * the A/B tool away exactly on the machine that needs it. `Settings.ts` checks
 * this and stands down when the URL has spoken.
 */
export function panelBlurUrlOverride(): PanelBlurMode | null {
  return urlForcedMode;
}

/**
 * Stamp the gate onto `<html>`.
 *
 * Called at MODULE LOAD, not from `createRenderer()`, and deliberately so: on
 * the product boot path the shell paints the title screen before a renderer
 * exists, and a menu that renders blurred and then un-blurs is its own visual
 * bug. `renderer.ts` is imported (via Bootstrap) from the entry module, so this
 * runs before the first stylesheet is even injected.
 */
export function initPanelBlurPolicy(): PanelBlurMode {
  urlForcedMode = urlPanelBlurOverride();
  const mode = urlForcedMode ?? 'auto';
  setPanelBlurMode(mode);
  return mode;
}

if (typeof document !== 'undefined') {
  initPanelBlurPolicy();
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

/**
 * WORK OUT THE DRAWING BUFFER FOR A LAYOUT BOX. Pure, so the arithmetic that
 * decides whether the buffer is reallocated is testable without a GL context.
 *
 * `fixed` is the screenshot path: one drawing-buffer pixel per requested pixel,
 * device pixel ratio pinned to 1 and `resolutionScale` ignored, so captures are
 * byte-comparable across machines with different DPR.
 */
export function planDrawingBuffer(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixelRatio: number,
  resolutionScale: number,
  fixed: boolean
): RenderSize {
  const w = Math.max(2, Math.round(cssWidth));
  const h = Math.max(2, Math.round(cssHeight));
  const dpr = fixed ? 1 : Math.min(devicePixelRatio || 1, Math.max(0.5, maxPixelRatio));
  const raw = fixed ? 1 : Math.max(0.25, Math.min(4, dpr * resolutionScale));
  /*
   * The clamp above is not total: `Math.max(0.25, Math.min(4, NaN))` is NaN, and
   * `Math.max(2, Math.round(w * NaN))` is NaN, so a single bad scale sizes the
   * drawing buffer NaN x NaN. `setResolutionScale` now refuses non-finite input,
   * which is the real fix; this is the second wall, because this function is
   * exported and pure and there is no reason it should ever be ABLE to return a
   * size that cannot exist. Falling back to 1 renders at native rather than not
   * at all.
   */
  const effective = Number.isFinite(raw) ? raw : 1;
  return {
    cssWidth: w,
    cssHeight: h,
    width: Math.max(2, Math.round(w * effective)),
    height: Math.max(2, Math.round(h * effective)),
    pixelRatio: effective,
  };
}

/**
 * Would applying `plan` leave the drawing buffer exactly as it already is?
 *
 * This is the test a FORCED resize used to skip, and skipping it is not free:
 * `renderer.setSize` assigns to `canvas.width`, and assigning to `canvas.width`
 * REALLOCATES the drawing buffer even when the value is unchanged. `src/main.ts`
 * calls `GameHandle.resize()` — a forced resize — on every window `resize` event
 * and every DPR change, so a window nudge that changed nothing still threw away
 * the finished frame. See `RepaintGuard`.
 */
export function drawingBufferUnchanged(plan: RenderSize, current: Readonly<RenderSize>): boolean {
  return (
    plan.cssWidth === current.cssWidth &&
    plan.cssHeight === current.cssHeight &&
    plan.width === current.width &&
    plan.height === current.height &&
    plan.pixelRatio === current.pixelRatio
  );
}

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
  /**
   * True between `webglcontextlost` and `webglcontextrestored`. Every draw path
   * must early-out while this is set: commands issued to a lost context are
   * dropped, and what the compositor then presents is an undefined (in
   * practice, black) drawing buffer. Skipping the frame leaves the last good
   * one on screen instead.
   */
  isContextLost(): boolean;
  /**
   * Register "draw one complete frame into the current buffer, right now".
   *
   * The renderer cannot draw the game — it owns no scene, camera or post chain
   * — but it is the only thing that knows when the drawing buffer has just been
   * reallocated and holds nothing. So the host lends it a painter, and every
   * reallocation is followed by a real frame BEFORE the browser paints. Without
   * it the compositor presents the flat replacement buffer: measured at 10 out
   * of 10 forced resizes issued after a frame had already been drawn. See
   * `RepaintGuard`.
   *
   * Pass null to unregister (teardown).
   */
  setPresenter(fn: (() => void) | null): void;
  /**
   * Repaint bookkeeping, for the perf overlay and for tests. `repaints` are the
   * ones that cost an extra draw; `coalesced` are the ones a frame that was
   * about to happen anyway absorbed for free.
   */
  readonly repaintStats: { readonly repaints: number; readonly coalesced: number };
  /** Force a resize evaluation (also called automatically). */
  resize(force?: boolean): void;
  /** Override the layout size, e.g. the screenshot harness at a fixed res. */
  setFixedSize(width: number | null, height: number | null): void;
  setResolutionScale(scale: number): void;
  /**
   * The scale currently in force. Read-only companion to
   * `setResolutionScale`, so a controller can start from whatever the quality
   * tier chose instead of assuming 1.0 and stamping over a deliberate setting.
   */
  readonly resolutionScale: number;
  /**
   * True while `setFixedSize` is driving an offscreen render — a screenshot.
   *
   * Exposed so dynamic resolution can stand down during a capture: the harness
   * requires one drawing-buffer pixel per requested pixel, and a scaled capture
   * would silently corrupt the visual scorecard.
   */
  readonly isFixedSize: boolean;
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

  /*
   * ALPHA: deliberately FALSE, and re-confirmed while chasing the macOS black
   * flashes.
   *
   * `alpha: true` was evaluated as a way to make the canvas composite through
   * the ordinary translucent-layer path instead of the opaque one. It was
   * rejected: the last pass in the post chain is SMAA, and neither SMAAPass nor
   * UnrealBloomPass guarantees an alpha of exactly 1.0 in its output — the
   * grade pass writes `vec4(rgb, 1.0)`, but it is not last. With `alpha: true`
   * any pixel whose alpha came out below 1 lets the page background through,
   * which lifts the blacks and washes the whole frame — a direct hit on
   * scorecard #4 (crushed, contrasty shadows) for a speculative compositing
   * gain we cannot measure from here. `alpha: false` also lets the browser skip
   * a blend when presenting.
   *
   * The compositing fragility that alpha was meant to address is addressed at
   * its source instead: the backdrop-filter gate above stops anything sampling
   * this canvas on the platforms where sampling it is unsafe.
   */
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

  /*
   * CLEAR THE DRAWING BUFFER NOW, before anything can present it.
   *
   * A freshly created WebGL drawing buffer is defined to be zero-filled, and
   * with `alpha: false` that reads as opaque BLACK. Between this call and the
   * first `composer.render()` there are several frames — module init, system
   * registration, terrain generation, shader compilation — during which the
   * compositor is free to put the canvas on screen. Painting the sky colour
   * into it immediately means the worst case is a flat horizon-grey rectangle
   * instead of a black one.
   */
  renderer.setRenderTarget(null);
  renderer.clear(true, true, true);

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
  /** See the context-loss block below. Declared here so `doResize` can read it. */
  let contextLost = false;
  /**
   * Whether the LAST applied size was a fixed-size (screenshot) one. Part of the
   * "did anything actually change" test: entering or leaving fixed-size mode
   * changes `updateStyle` and `isFixedSize` even when the pixel counts match.
   */
  let appliedFixed = false;

  /**
   * The undrawn-buffer guarantee. Every reallocation invalidates; every frame
   * that is about to draw cancels. See `src/render/RepaintGuard.ts` for the
   * measurement this exists for.
   */
  const repaint = new RepaintGuard();

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
    const fixed = fixedWidth !== null;
    // A fixed size means a screenshot: 1 drawing-buffer pixel per requested
    // pixel, so shots are byte-comparable across machines with different DPR.
    const plan = planDrawingBuffer(
      w,
      h,
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      cfg.maxPixelRatio,
      cfg.resolutionScale,
      fixed
    );

    /*
     * DOES THIS RESIZE ACTUALLY CHANGE THE BUFFER?
     *
     * This test used to be skipped whenever `force` was set, and `force` is the
     * common case: `src/main.ts` debounces every window `resize` event and every
     * DPR change into `GameHandle.resize()`, which calls `handle.resize(true)`.
     * `renderer.setSize` assigns to `canvas.width`, and THAT REALLOCATES THE
     * DRAWING BUFFER even when the number is unchanged — so a window nudge that
     * moved nothing still threw away the finished frame and presented a flat
     * one. Forcing now means "re-evaluate and re-notify", not "reallocate".
     */
    const unchanged = drawingBufferUnchanged(plan, size) && fixed === appliedFixed;
    if (!force && unchanged) return;

    size.cssWidth = plan.cssWidth;
    size.cssHeight = plan.cssHeight;
    size.width = plan.width;
    size.height = plan.height;
    size.pixelRatio = plan.pixelRatio;

    if (!unchanged) {
      appliedFixed = fixed;
      renderer.setPixelRatio(plan.pixelRatio);
      // updateStyle=false when we are driving a fixed-size offscreen render.
      renderer.setSize(plan.cssWidth, plan.cssHeight, !fixed);

      /*
       * The buffer we just got is zero-filled — opaque black, with
       * `alpha: false`. Two things happen about that, and both are needed:
       *
       *   1. The sky colour is painted in now, so the worst case is a flat
       *      horizon-grey rectangle rather than a black one. This is the safety
       *      net for the paths where nothing can draw yet (boot, teardown, a
       *      context that has just died).
       *   2. The buffer is marked UNDRAWN. Unless a complete frame follows
       *      before the browser paints, `RepaintGuard` draws one. That is the
       *      actual fix; the clear above is only what happens if it cannot run.
       */
      if (!contextLost) {
        try {
          renderer.setRenderTarget(null);
          renderer.clear(true, true, true);
        } catch {
          /* a context that died between the check and the call — next frame retries */
        }
      }
      repaint.invalidate();
    }

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

  /*
   * CONTEXT LOSS.
   *
   * `preventDefault()` asks the browser to restore the context, but restoration
   * is asynchronous and can take many frames. Every draw issued in that window
   * is silently dropped, and on some drivers the compositor presents the
   * abandoned drawing buffer — a black rectangle where the game was. The flag
   * below is read by `post.render()`, which skips the frame entirely so the
   * last complete image stays on screen until the context is back.
   */
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    console.warn('[render] WebGL context lost — suspending presentation');
  };
  const onContextRestored = () => {
    contextLost = false;
    console.warn('[render] WebGL context restored — forcing full resize');
    doResize(true);
    // Same reasoning as the boot clear: the restored buffer starts at zero.
    try {
      renderer.setRenderTarget(null);
      renderer.clear(true, true, true);
    } catch (err) {
      console.warn('[render] clear after context restore failed', err);
    }
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

    get resolutionScale() { return cfg.resolutionScale; },
    get isFixedSize() { return fixedWidth !== null; },

    isContextLost() {
      return contextLost;
    },

    setPresenter(fn) {
      repaint.setPainter(fn);
    },

    get repaintStats() {
      return repaint;
    },

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
      /*
       * A BAD ARGUMENT HERE POISONS THE DRAWING BUFFER, NOT JUST THIS FIELD.
       *
       * The clamp below looks total and is not. `Math.min(2, undefined)` is NaN
       * and `Math.max(0.25, NaN)` is NaN, so `setResolutionScale(undefined)`
       * assigned NaN to `cfg.resolutionScale` — the equality guard cannot stop
       * it either, because `Math.abs(NaN - x) < 1e-4` is false, so it proceeds.
       * From there `planDrawingBuffer` computes `effective = Math.max(0.25,
       * Math.min(4, dpr * NaN))` = NaN and returns `width`/`height` of NaN, and
       * the renderer is sized NaN x NaN.
       *
       * I hit this myself while probing the live game through `__VM`: I read the
       * wrong config path, got `undefined`, and passed it straight back in to
       * "restore" the old value. `stats().resolution` then read "NaNxNaN" for the
       * rest of the session. That was self-inflicted and NOT a pre-existing bug —
       * but a public entry point on `RendererHandle` and `window.__VM` that turns
       * a fat-fingered argument into a NaN-sized drawing buffer is worth closing
       * regardless of who fat-fingered it.
       *
       * CLAUDE.md records where NaN goes in this renderer once it is loose: into
       * an instance colour, through the bloom mip chain, and out as a black frame
       * while stats cheerfully reported 285 draws. Refusing the value is strictly
       * better than propagating it.
       *
       * `null` was already survivable by accident — it coerces to 0 and clamps to
       * 0.25 — which is its own kind of wrong. Both are rejected now.
       */
      if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        if (DEV) console.warn(`[renderer] setResolutionScale(${String(scale)}) ignored — not a finite number`);
        return;
      }
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
      /*
       * A complete frame is about to be drawn into the current buffer, so a
       * repaint scheduled by a resize earlier in this task is redundant. This is
       * what makes the guarantee nearly free: the adaptive-resolution controller
       * changes scale at `RenderPhase.Present`, which is BEFORE the host draws,
       * so its reallocation is absorbed by the frame it is already inside.
       */
      repaint.frameStarting();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      repaint.dispose();
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
    const probe = compositingProbe();
    console.info(
      `[render] WebGL${capabilities.webgl2 ? '2' : '1'} · ${capabilities.gpu} · ` +
        `${size.width}x${size.height} @ ${size.pixelRatio.toFixed(2)}x · ` +
        `maxTex ${capabilities.maxTextureSize} · aniso ${capabilities.anisotropy}`
    );
    console.info(
      `[render] panel blur: ${panelBlurActive ? 'ON' : 'OFF'} (mode ${panelBlurMode}` +
        `, platform "${probe.platform}") — ${probe.reason}`
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

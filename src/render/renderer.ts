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
import {
  assertBackend,
  describeAdapter,
  liveBackendOf,
  normaliseAdapterInfo,
  normaliseInfo,
  requestedBackend,
  type AdapterIdentity,
  type GpuBackend,
  type LiveBackend,
  type NormalisedFrameInfo,
  type RendererInfoLike,
} from './backend';
import {
  CanvasQuarantine,
  GpuUnavailableError,
  gpuFailureConsoleLine,
  gpuFailureReport,
  hrefWithoutGpuFlag,
  showGpuFailure,
  watchDeviceLoss,
  type GpuFailure,
} from './device-loss';
import { nodePath, prepareGpuPath, type NodeRendererLike } from './gpu-path';

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
    /**
     * Radius (m) `scene.ts#fitShadow` clamps the per-frame ortho fit to.
     *
     * `nearExtent` used to sit above this and is deleted: there is ONE shadow
     * camera, not a cascade chain, and its only read set that camera's initial
     * left/right/top/bottom — which the first `fitShadow` overwrites before a
     * frame is presented. It configured nothing.
     */
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
  /*
   * NO `shadowColor` HERE ANY MORE. It was declared, written in three tables
   * and bridged from `ArtDirection`, and read by nothing — three.js has no
   * shadow-colour input on a `DirectionalLight`. The blue lift in the shadows
   * is `GradeConfig.shadowTint` (post.ts's `uShadowTint`), which is a grade
   * term on the low end of the luminance range. Deleting it moved no pixel.
   */
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
  /** HDR luminance threshold. 1.05 = only genuine emissives and glints bloom. */
  threshold: number;
  /**
   * AUTHORED strength. `post.ts#syncConfig` hands the pass
   * `strength * max(0.25, emissiveBoost / 1.6)`, so this is not the effective
   * figure — see `BLOOM_NOON.strength` in `core/config.ts`.
   */
  strength: number;
  /**
   * `UnrealBloomPass` mip blend, NOT a pixel radius. It lerps the mip weights
   * against their own reverse, so anything over 0.5 makes the widest mip
   * dominate and the bloom reads as a veil. Bible §4.4: 0.34 pre-tonemap.
   */
  radius: number;
  /** Extra gain applied to values already above threshold. Scales `strength`. */
  emissiveBoost: number;
  /*
   * NO `lensDirt`. `RA3_LOOK_BIBLE.md` §11 bans lens dirt by name, and the
   * field's only consumer was a `console.info` saying the bundled
   * `UnrealBloomPass` has no dirt uniform to feed. A banned effect configured
   * at 0.12 in two tables and bridged through a third is exactly the drift
   * `docs/SPEC_DRIFT_AUDIT.md` #53 catalogues.
   */
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
   * MSAA samples on the SCENE render target. 0 disables the path entirely.
   *
   * Read `src/render/post.ts`'s header before changing this. The name used to
   * say "the composer's HDR target", and handing the number to the composer is
   * precisely the bug described below — it is a dedicated target now, resolved
   * once, and nothing downstream of the scene pass is multisampled.
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
   *     samples 0, render scale 1.0    12.5%
   *     samples 4, render scale 1.0     8.2%
   *     samples 0, render scale 1.5     9.1%
   *     samples 0, render scale 2.0     6.4%
   *
   * SMAA was enabled for every one of those rows.
   *
   * ── AND WHY IT DEFAULTS TO 0 ANYWAY ──────────────────────────────────────
   * This shipped at 4 and cost a reporter on integrated Radeon graphics 7-8 fps
   * of ~22 at the `high` tier — a third of their frame rate. Two mistakes, both
   * mine, both worth naming because they are easy to repeat:
   *
   * 1. I MEASURED A VSYNC-LOCKED FRAME. The test machine sat at exactly
   *    16.66 ms before and after, and I read that as "MSAA is free". A frame
   *    pinned to the refresh interval cannot show an added cost until that cost
   *    exceeds the idle headroom — there was ~14 ms of it, in a 653x595 pane.
   *    The correct instrument is a frame already over budget, or a GPU timer
   *    query. "No change" on a vsync-locked frame measures nothing at all.
   *
   * 2. `EffectComposer` CLONES ITS TARGET for the ping-pong buffer, so setting
   *    `samples` there multisamples BOTH, and every pass in the chain — AO,
   *    bloom, grade, SMAA — then writes into a multisampled RGBA16F target and
   *    forces a resolve. Five resolves a frame where the geometry needed one.
   *    Full-screen quads have no coverage to sample; multisampling them is pure
   *    bandwidth. On an iGPU sharing system memory, at 32 bytes per pixel per
   *    sample, that is the whole regression.
   *
   * ── WHAT IS BUILT NOW ────────────────────────────────────────────────────
   * Mistake 2 is fixed: `post.ts` gives the composer a plain target and keeps
   * ONE multisampled target of its own for the scene pass, resolved once and
   * transferred into the composer's read buffer. Four of the five resolves are
   * gone, provably — the file header lays out the proof and, just as
   * importantly, what it does NOT prove.
   *
   * Mistake 1 has NOT been fixed, because it cannot be from here: nobody in
   * this repo has the reporter's hardware, and the regression was never
   * reproduced on a machine we do have. So the default stays 0 and no tier
   * turns it on. `graphics.msaa` in the settings store is the only switch, it
   * takes effect immediately, and the person flipping it is the only one in a
   * position to measure the result on the machine that matters.
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
    // Fallback only: `ArtBridge.artPatch` overwrites all four from
    // `DEFAULT_ART.bloom` at boot. Kept in step with it anyway, because a
    // fallback that disagrees with the shipped look is how you get a "why does
    // it flash on the first frame" report. `emissiveBoost` 1.6 is the identity
    // point of post.ts's multiplier, so strength here IS the effective figure.
    // 0.354 = the shipped `BLOOM_NOON.strength` 0.42 x its 0.84375 scaling, and
    // 1.20 is the shipped threshold — both restored after the bible's 1.05/0.55
    // pair was captured and cost 1.8 points of grade. See `BLOOM_NOON` in
    // core/config.ts for the measurement. `radius` 0.34 IS the bible value and
    // is kept: it was a mip-weight inversion, not an energy knob.
    bloom: {
      enabled: true,
      threshold: 1.20,
      strength: 0.354,
      radius: 0.34,
      emissiveBoost: 1.6,
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
    msaaSamples: 0,
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
   * NO TIER TURNS `msaaSamples` ON. See `PostConfig.msaaSamples` for the
   * measured regression — 7-8 fps of ~22 on integrated graphics — and for the
   * two measurement errors that let it ship. A tier is exactly the wrong place
   * to spend that budget by default, because tier is picked from a rough
   * capability guess and the cost here is dominated by MEMORY BANDWIDTH, which
   * that guess does not model at all: a discrete card at `high` and an iGPU at
   * `high` are not remotely the same machine for this one setting.
   *
   * It is a settings toggle instead (`graphics.msaa`), off by default, so the
   * cost is opted into by someone who can see their own frame counter.
   */
  low: {
    renderer: { resolutionScale: 0.75, maxPixelRatio: 1.0, shadows: { enabled: true, mapSize: 1024 } },
    // The `low` bloom radius is NOT a cost knob — `UnrealBloomPass` renders all
    // five mips whatever it is; radius only reweights them. It was 0.5, which
    // flattened the weighting toward the veily wide mip on exactly the machines
    // least able to hide it. Held at the bible's 0.34 with everyone else.
    post: { ao: { enabled: false }, bloom: { enabled: true, radius: 0.34 }, smaa: { enabled: false } },
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
  /**
   * THE SHIPPING WEBGL RENDERER, OR NULL ON THE NODE PATH.
   *
   * `renderer` used to be a bare `THREE.WebGLRenderer` and every consumer read
   * it. It is split in two because the two renderer families **share no base
   * type** — they come from different entry points and `WebGPURenderer` is not
   * a `WebGLRenderer` by any relation TypeScript can see — and because most of
   * what the consumers reach for is genuinely WebGL-only: `getContext()` for the
   * timer query, `capabilities.getMaxAnisotropy()`, `readRenderTargetPixels`
   * (async under WebGPU), `PMREMGenerator`'s constructor.
   *
   * A union would have made every one of those sites a cast. Two nullable fields
   * make each site say which renderer it needs and fail to compile if it did not
   * check. Anything that works on BOTH should read `frameInfo()`, `size`,
   * `capabilities` or `backend` instead of either field.
   */
  readonly webgl: THREE.WebGLRenderer | null;
  /**
   * The node renderer (`THREE.WebGPURenderer`), or null on the WebGL path.
   *
   * Typed structurally through `gpu-path.ts#NodeRendererLike` so this module —
   * which is in the main bundle — never imports `three/webgpu`.
   */
  readonly node: NodeRendererLike | null;
  readonly canvas: HTMLCanvasElement;
  readonly size: Readonly<RenderSize>;
  readonly capabilities: {
    webgl2: boolean;
    maxTextureSize: number;
    maxSamples: number;
    anisotropy: number;
    floatRenderTargets: boolean;
    /**
     * One line naming the GPU. On the WebGL path this is the unmasked
     * `WEBGL_debug_renderer_info` string; on the node path it is the WebGPU
     * adapter's own account of itself, falling back to that same probe.
     */
    gpu: string;
    /**
     * WHICH ADAPTER THE WEBGPU DEVICE ACTUALLY CAME FROM, or null on the WebGL
     * path and on a device that reported nothing.
     *
     * `powerPreference: 'high-performance'` is a HINT. Stage A asked for it and
     * measured on an integrated `amd`/`gcn-5` adapter, on a machine that also
     * holds an RTX 3080, because Windows routes the preference through the
     * driver's own application profile. A crash report that cannot name the GPU
     * cannot be acted on, and until now nothing in the product could.
     */
    adapter: AdapterIdentity | null;
  };
  /**
   * True between `webglcontextlost` and `webglcontextrestored` — and, on the
   * node path, from the moment a WebGPU device resolves its `lost` promise.
   * Every draw path must early-out while this is set: commands issued to a dead
   * context or device are dropped, and what the compositor then presents is an
   * undefined (in practice, black) drawing buffer. Skipping the frame leaves the
   * last good one on screen instead.
   *
   * THE WEBGPU HALF NEVER CLEARS. A lost WebGL context is restored by the
   * browser and `webglcontextrestored` says so; a lost WebGPU device is gone
   * with everything it held, and the route back is the panel `device-loss.ts`
   * puts on screen.
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
  /**
   * The backend that is ACTUALLY LIVE, read off the renderer rather than
   * inferred from what was requested. Today this is always `'webgl'`; it exists
   * so that every consumer of a frame statistic can name the renderer that
   * produced it, which is the one thing the WebGPU spike found nothing could do.
   * See `src/render/backend.ts`.
   */
  readonly backend: LiveBackend;
  /**
   * This frame's statistics, with the same MEANING whichever renderer produced
   * them. `renderer.info.render.calls` is per-frame draws under WebGL and a
   * monotonic count of `render()` calls under WebGPU, so reading the raw field
   * is only safe while there is exactly one renderer. Read this instead.
   */
  frameInfo(): NormalisedFrameInfo;
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

/* -------------------------------------------------------------------------- */
/* The node renderer's async door                                             */
/* -------------------------------------------------------------------------- */

/**
 * The prepared node renderer, or null.
 *
 * **`createRenderer` IS SYNCHRONOUS AND `WebGPURenderer` CANNOT BE.**
 * `Renderer.render()` throws outright — `.render() called before the backend is
 * initialized` — unless `await renderer.init()` has resolved, and `init()` is
 * where `requestDevice()` and therefore the WebGL2 fallback live. Meanwhile
 * `bootstrap()` is synchronous by design and `Shell.startMatch` documents the
 * one synchronous window between it and `applySetupToWorld` as load-bearing for
 * determinism.
 *
 * So the device is acquired BEFORE the engine exists, by `prepareRenderer()`,
 * and parked here. `createRenderer` adopts it.
 */
let preparedNode: { canvas: HTMLCanvasElement; renderer: NodeRendererLike } | null = null;

/**
 * The adapter the live WebGPU device actually came from, or null.
 *
 * Read once, off `backend.device.adapterInfo`, because three keeps the
 * `GPUAdapter` as a local inside `WebGPUBackend.init` and drops it. Published on
 * `RendererHandle.capabilities.adapter` and `__VM.gpuInfo()`.
 */
let preparedAdapter: AdapterIdentity | null = null;

/**
 * Set once a live device has been lost. Never cleared: a lost WebGPU device does
 * not come back, and everything it held — every texture, buffer and pipeline the
 * match built — went with it.
 */
let deviceLost: GpuFailure | null = null;

/* -------------------------------------------------------------------------- */
/* The poisoned canvas                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Canvases that have held (or attempted) a `webgpu` context.
 *
 * **EMPTY FOR THE ENTIRE LIFE OF A WEBGL PAGE.** Nothing poisons a canvas unless
 * `?gpu=webgpu` was typed AND the device failed, so `liveCanvas()` on the
 * shipping path is one `WeakSet.has` returning false and handing back the
 * argument. The WebGL construction below is untouched by this whole section.
 */
const canvasQuarantine = new CanvasQuarantine<HTMLCanvasElement>();

/**
 * A brand-new canvas in the old one's place, carrying its identity.
 *
 * The old element is DETACHED and stripped of its id, because two elements both
 * answering `#gl` — which is how `createRenderer` finds the canvas when no
 * option is passed — would be a coin flip between a live canvas and a dead one.
 *
 * `width`/`height` are copied so the replacement is not the 300x150 default for
 * the frame before `doResize` runs; `style.cssText` so it occupies the same box.
 * Nothing else is copied: event listeners are re-attached by whoever attaches
 * them, and a WebGL context is what the caller is about to create.
 */
function mintCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const doc = old.ownerDocument;
  const fresh = doc.createElement('canvas');
  fresh.className = old.className;
  fresh.style.cssText = old.style.cssText;
  fresh.width = old.width;
  fresh.height = old.height;
  const id = old.id;
  old.id = '';
  fresh.id = id;
  old.parentNode?.replaceChild(fresh, old);
  return fresh;
}

/**
 * The canvas a caller should actually draw into.
 *
 * IDENTITY ON EVERY PATH THAT HAS NOT LOST A DEVICE, which is every WebGL boot
 * and every healthy WebGPU boot. It exists for the one case where handing back
 * the argument is a crash: an element that has held a `webgpu` context can never
 * open a `webgl2` one — the browser has no release for that — so a WebGL
 * renderer built on it dereferences `null` inside `WebGLExtensions`. That is the
 * exact failure `docs/RENDER_FINDINGS.md` §7g records, produced by three's own
 * fallback; producing it ourselves instead would not be an improvement.
 *
 * Also follows the replacement chain, because callers hold stale references:
 * `Shell` keeps `options.canvas` for the life of the page and hands the same
 * field to `bootstrap()` on every match.
 */
function liveCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  return canvasQuarantine.resolve(canvas, mintCanvas);
}

/* -------------------------------------------------------------------------- */
/* THE POLICY — what `?gpu=webgpu` does when WebGPU is not there              */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * `?gpu=webgpu` REFUSES. IT DOES NOT QUIETLY BECOME SOMETHING ELSE, AND IT DOES
 * NOT LOUDLY BECOME SOMETHING ELSE EITHER — THE HUMAN DECIDES, IN ONE CLICK.
 * ============================================================================
 *
 * The question this answers: when the WebGPU device cannot be had, should the
 * flag fail, or should the page fall back to WebGL behind a visible notice?
 *
 * **IT FAILS**, and the argument has four parts.
 *
 * 1. IT IS THE SAME PRINCIPLE `assertBackend` ALREADY ENFORCES. That function
 *    throws on `webgl2-fallback` so a page can never report frames under a
 *    renderer nobody selected. A notice-plus-fallback is the same substitution
 *    with a banner on it — and a banner is dismissible, scrolls away, and does
 *    not travel. Everything downstream (the perf HUD, `stats()`,
 *    `shots/_report.json`, any benchmark) would keep being produced, correctly
 *    formatted, about WebGL, while the address bar said WebGPU. That is Stage
 *    A's defect exactly: an hour of measurement with one column mislabelled.
 *
 * 2. THE FALLBACK IS NOT FREE MID-MATCH ANYWAY. A lost device takes every
 *    texture, buffer, pipeline and bind group with it. "Recover onto WebGL" is
 *    not a swap; it is a full re-boot of the renderer and of every module that
 *    built a GPU resource. Since a re-boot is required either way, doing it as
 *    an explicit page reload is strictly simpler and strictly more honest than
 *    doing it as an in-place substitution that has to be got right in twenty
 *    modules.
 *
 * 3. REFUSING CANNOT LOOP. An automatic fallback that reloads is one bad
 *    condition away from a reload cycle; one that does not reload has to make
 *    the whole engine backend-agnostic at runtime. A button pressed by a person
 *    is neither.
 *
 * 4. NOTHING IS LOST BY REFUSING. At boot no frame has been drawn, so a reload
 *    costs a player nothing at all. The flag is opt-in, defaults to WebGL for
 *    every unrecognised value, and is removed by one click on the panel below.
 *
 * What is NOT acceptable, and what this replaces, is the previous behaviour: a
 * `TypeError` about `getSupportedExtensions` in a console the player was not
 * looking at, and a black page. The refusal is *visible* — a panel, in words,
 * naming the GPU, with the way out on it — which is the half that makes
 * refusing defensible rather than merely principled.
 *
 * The mechanism for a WebGL recovery is still fixed and still correct: a
 * poisoned canvas is never reused (see `liveCanvas` above), and three's own
 * fallback — which reuses it and crashes — is disabled in
 * `gpu-path-install.ts#disableThreeFallback`. The policy chooses not to take
 * that route automatically; it does not leave it broken.
 */
function raiseGpuFailure(failure: GpuFailure): void {
  console.error(gpuFailureConsoleLine(failure));
  if (typeof document === 'undefined' || document.body === null) return;
  const here = typeof location !== 'undefined' ? location.href : '';
  showGpuFailure(
    gpuFailureReport(failure),
    {
      body: document.body,
      createElement: (tag: string) => document.createElement(tag),
    },
    {
      onWebgl: () => {
        // `replace`, not `assign`: the WebGPU URL must not sit in the back
        // stack waiting for a stray Back press to reproduce the failure.
        location.replace(hrefWithoutGpuFlag(here));
      },
      onRetry: () => {
        location.replace(here);
      },
    },
  );
}

/**
 * Everything known about the GPU seam right now — for a bug report.
 *
 * Surfaced through `window.__VM.gpuInfo()`. ADDITIVE: nothing on that handle
 * changes shape, which `tools/shoot.mjs` and `tools/metrics.mjs` depend on.
 */
export interface GpuReport {
  /** What the URL asked for. */
  readonly requested: GpuBackend;
  /** What is live, read off the renderer. Null before one exists. */
  readonly live: LiveBackend | null;
  /** The WebGPU adapter's own account of itself, when it gave one. */
  readonly adapter: AdapterIdentity | null;
  /** One line naming the GPU, from either the adapter or the WebGL probe. */
  readonly gpu: string;
  /** Set only once a live device died. */
  readonly deviceLost: GpuFailure | null;
}

/** The current GPU seam state. Safe to call at any time, including pre-boot. */
export function gpuReport(live: LiveBackend | null = null): GpuReport {
  return {
    requested: requestedBackend(typeof location !== 'undefined' ? location.search : ''),
    live,
    adapter: preparedAdapter,
    gpu: describeAdapter(preparedAdapter) ?? probeGpuRenderer() ?? 'unknown',
    deviceLost,
  };
}

/**
 * TEST SEAM ONLY. Clears the module-level device state so a spec can drive
 * `prepareRenderer` more than once. Never called from product code.
 */
export function resetGpuStateForTests(): void {
  preparedNode = null;
  preparedAdapter = null;
  deviceLost = null;
}

/**
 * Acquire whatever the URL asked for. **Await this before `bootstrap()`.**
 *
 * On the WebGL path it is a no-op returning `'webgl'` — no import, no device, no
 * cost — which is what keeps `three/webgpu` out of the shipped bundle for every
 * player who did not type the flag.
 *
 * IT DOES NOT ASSERT THE LIVE BACKEND. `WebGPURenderer` resolves `init()` happily
 * under its WebGL2 fallback behind a single `warn()`, and `navigator.gpu` plus a
 * real adapter were both true throughout the failure `docs/RENDER_FINDINGS.md`
 * §7c records. The assert is `assertBackend`, in `createRenderer`, on the object
 * — the only reliable read is `renderer.backend.isWebGPUBackend`.
 *
 * IDEMPOTENT PER CANVAS, and the renderer is deliberately kept across matches:
 * `Shell` disposes the whole engine between skirmishes, and re-acquiring a GPU
 * device on every map change is a stall no player asked for.
 */
export async function prepareRenderer(
  canvas: HTMLCanvasElement,
  search: string = typeof location !== 'undefined' ? location.search : '',
): Promise<GpuBackend> {
  const want = await prepareGpuPath(search);
  /*
   * THE WEBGL PATH LEAVES HERE HAVING TOUCHED NOTHING. No quarantine lookup, no
   * device, no watch, no import — byte for byte the same boot it was before
   * device-loss handling existed.
   */
  if (want !== 'webgpu') return 'webgl';

  /*
   * A DEVICE THAT HAS ALREADY DIED MUST NOT BE ASKED FOR AGAIN IN THIS PAGE.
   * `Shell` re-enters this function on every match, and the second match after a
   * loss would otherwise mint a canvas, request a fresh device and quietly carry
   * on — leaving the player looking at a "device lost" panel over a game that
   * had restarted behind it.
   */
  if (deviceLost !== null) throw new GpuUnavailableError(deviceLost);

  const target = liveCanvas(canvas);
  if (preparedNode !== null && preparedNode.canvas === target) return 'webgpu';
  const path = nodePath();
  if (path === null) throw new Error('[render] node path requested but not installed');

  let renderer: NodeRendererLike;
  try {
    renderer = await path.createRenderer(target, RENDER_CONFIG.renderer.antialias);
  } catch (err) {
    /*
     * **THE REJECTION THAT USED TO KILL THE PAGE IS CAUGHT HERE.**
     *
     * Nothing wrapped this await before, so `requestAdapter()` returning null on
     * a recovering driver became an unhandled rejection — and, with three's
     * fallback still armed, not even the honest one: `WebGLBackend.init` ran
     * first and threw about `getSupportedExtensions` off a canvas that could no
     * longer open WebGL2. `disableThreeFallback` removes the second half;
     * this removes the first.
     *
     * The canvas is quarantined UNCONDITIONALLY rather than on a guess about how
     * far `init()` got. `WebGPUBackend.init` calls `getContext('webgpu')` from
     * `updateSize()` on its last line, and three's fallback may have opened one
     * too, so "did this element get poisoned" is not answerable from out here —
     * and being wrong in the cheap direction costs one detached DOM node, while
     * being wrong in the other direction is the crash.
     */
    canvasQuarantine.poison(target);
    const failure: GpuFailure = {
      phase: 'init',
      reason: null,
      message: err instanceof Error ? err.message : String(err),
      // `preparedAdapter` is normally null here — the adapter is read off a
      // device that was never created — but a SECOND failure after a good boot
      // still knows which GPU it was, and that is the report worth having.
      adapter: preparedAdapter,
    };
    raiseGpuFailure(failure);
    throw new GpuUnavailableError(failure, err);
  }

  /*
   * READ THE ADAPTER, AND WATCH THE DEVICE, BEFORE ANYONE CAN DRAW.
   *
   * This is the earliest moment a device exists and the latest moment at which
   * nothing has used it. The watch is deliberately NOT cancelled by
   * `handle.dispose()`: the renderer outlives the handle by design (see the
   * dispose block in `createRenderer`), so a device lost between two matches
   * would otherwise resolve into silence.
   */
  const device = renderer.backend.device;
  preparedAdapter = normaliseAdapterInfo(device?.adapterInfo);
  watchDeviceLoss(device, (info) => {
    deviceLost = {
      phase: 'lost',
      reason: info.reason ?? null,
      message: info.message ?? '',
      adapter: preparedAdapter,
    };
    // The canvas held a live `webgpu` context, so it can never open WebGL2.
    canvasQuarantine.poison(target);
    raiseGpuFailure(deviceLost);
  });

  preparedNode = { canvas: target, renderer };
  return 'webgpu';
}

export function createRenderer(options: CreateRendererOptions = {}): RendererHandle {
  const cfg = RENDER_CONFIG.renderer;

  /*
   * `?gpu=webgpu` IS A SWITCH NOW, AND IT IS STILL NOT A SILENT ONE.
   *
   * Until Stage F this threw: there was no WebGPU path, and a flag that appears
   * to work and does nothing is worse than one that says no. Stages B..E built
   * the path — post chain, terrain, structures/units/props, roads, water, shroud
   * and VFX, all as TSL node graphs — and this is the seam that selects it.
   *
   * TWO THINGS DID NOT CHANGE, and both are the reason the flag was a refusal.
   * The default is still WebGL for every input this parser does not recognise,
   * and the LIVE backend is still read off the object and compared rather than
   * inferred: `assertBackend` below throws on `webgl2-fallback`, which is what
   * `WebGPURenderer` silently becomes when `requestDevice()` fails.
   *
   * **THE MEASURED VERDICT ON SPEED HAS NOT BEEN OVERTURNED EITHER.** Stage A's
   * synthetic sweep found the two indistinguishable at our 54-76 colour draws
   * and WebGPU 1.7-2.1x slower above 1000, and the curves never cross. See
   * `docs/RENDER_FINDINGS.md` §7b and §9.
   */
  const wantBackend: GpuBackend = requestedBackend(
    typeof location !== 'undefined' ? location.search : '',
  );

  THREE.ColorManagement.enabled = true;

  let canvas = options.canvas ?? (document.getElementById('gl') as HTMLCanvasElement | null);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gl';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
    document.body.appendChild(canvas);
  }
  /*
   * NEVER BUILD A RENDERER ON A CANVAS THAT HAS HELD A `webgpu` CONTEXT.
   *
   * A no-op on every WebGL boot and on every healthy WebGPU boot — the
   * quarantine is empty unless a device actually failed — so the construction
   * below is reached with exactly the element it was reached with before. It
   * matters in one case and that case is a crash: `new WebGLRenderer({ canvas })`
   * on a poisoned element gets `getContext('webgl2') === null`, which is the
   * `getSupportedExtensions` TypeError from the bug report with our name on it
   * instead of three's. See `liveCanvas`.
   */
  canvas = liveCanvas(canvas);

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
  /*
   * ONE OF THESE IS NULL, ALWAYS. See `RendererHandle.webgl` for why the two are
   * not a union: they share no base type and almost everything the consumers
   * reach for is genuinely one renderer's own.
   */
  let webglRenderer: THREE.WebGLRenderer | null = null;
  let nodeRenderer: NodeRendererLike | null = null;

  if (wantBackend === 'webgpu') {
    if (preparedNode === null || preparedNode.canvas !== canvas) {
      throw new Error(
        '?gpu=webgpu: no prepared node renderer. `await prepareRenderer(canvas)` must run ' +
          'before bootstrap() — WebGPURenderer.render() throws until init() has resolved, and ' +
          'createRenderer is synchronous. See src/render/renderer.ts#prepareRenderer.',
      );
    }
    nodeRenderer = preparedNode.renderer;
  } else {
    webglRenderer = new THREE.WebGLRenderer({
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
  }

  /**
   * The members `createRenderer` drives that exist on BOTH, reached through one
   * name so the size/clear/shadow plumbing below is written once.
   *
   * Everything else in this function is explicitly one branch or the other,
   * because everything else genuinely differs: `getContext()`, `capabilities`,
   * `info.autoReset`, and the WebGL context-loss events have no node twin.
   */
  const gpuCommon: {
    setPixelRatio(v: number): void;
    setSize(w: number, h: number, updateStyle?: boolean): void;
    setRenderTarget(t: null): void;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
    dispose(): void;
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    shadowMap: { enabled: boolean; type: THREE.ShadowMapType; autoUpdate: boolean; needsUpdate: boolean };
    toneMapping: THREE.ToneMapping;
    toneMappingExposure: number;
  } = webglRenderer ?? nodeRenderer!;

  if (webglRenderer !== null) {
    webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
    webglRenderer.autoClear = true;
    webglRenderer.sortObjects = true;
    webglRenderer.info.autoReset = false; // we reset once per frame in beginFrame()
  } else if (nodeRenderer !== null) {
    nodeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    nodeRenderer.autoClear = true;
    nodeRenderer.sortObjects = true;
    /*
     * `info.autoReset` HAS A DIFFERENT MEANING HERE AND THE DIFFERENCE IS SILENT.
     * Under WebGL the reset happens inside `render()`; under the node renderer it
     * lives in `setAnimationLoop`'s callback only, so a custom loop — which this
     * project has — never resets at all unless we do it. `beginFrame()` does,
     * exactly as it does for WebGL. `docs/RENDER_FINDINGS.md` §7b.
     */
    nodeRenderer.info.autoReset = false;
  }

  gpuCommon.toneMapping = TONE_MAPPING_LOOKUP[cfg.toneMapping] ?? THREE.NoToneMapping;
  gpuCommon.toneMappingExposure = cfg.exposure;

  gpuCommon.shadowMap.enabled = cfg.shadows.enabled;
  gpuCommon.shadowMap.type = cfg.shadows.type;
  /* ONE SHADOW PASS PER FRAME, NOT TWO.
   *
   * With `autoUpdate = true` the shadow map is rebuilt on EVERY
   * `WebGLRenderer.render()` call — and the post chain makes more than one per
   * frame. `GTAOPass` renders the scene a second time for its normal prepass,
   * so the entire shadow pass ran twice: measured at 110 draw calls for the
   * pair, against 55 for the geometry that actually casts.
   *
   * `beginFrame()` is the single per-frame entry point (its only caller is
   * `Bootstrap.present`), so arming `needsUpdate` there gives exactly one
   * rebuild per frame, at the first render that needs it. `WebGLShadowMap`
   * clears the flag itself once it has run, and its early-out requires BOTH
   * `autoUpdate === false` and `needsUpdate === false` — which is why the two
   * existing `needsUpdate = true` writes in the settings handlers below keep
   * working unchanged.
   *
   * Pixel-identical by construction: the same pass runs, once instead of twice,
   * and nothing between the two renders moves a caster.
   */
  gpuCommon.shadowMap.autoUpdate = false;
  /*
   * THE FIRST OFFSCREEN WARM-UP IS STILL A FRAME THAT NEEDS A SHADOW MAP.
   *
   * `createPostChain()` renders once while the loading curtain is up, before
   * `RendererHandle.beginFrame()` has had a chance to arm the normal per-frame
   * update below. With `autoUpdate = false` and the default `needsUpdate =
   * false`, Three therefore supplies a null entry for
   * `directionalShadowMap[0]`. In r185 its ARRAY-uniform fallback binds a depth
   * texture with `TEXTURE_COMPARE_MODE = NONE` to a `sampler2DShadow`, producing
   * `GL_INVALID_OPERATION: Mismatch between texture format and sampler type`
   * on the warm-up's first indexed draw.
   *
   * Arming once here is the correct lifecycle invariant: the first render of a
   * shadow-enabled renderer builds a real comparison texture, whether that
   * render came from the post warm-up, a direct fallback or the game loop.
   * `WebGLShadowMap` clears the flag after the build; `beginFrame()` continues
   * to arm exactly one update on every later presented frame.
   */
  gpuCommon.shadowMap.needsUpdate = cfg.shadows.enabled;

  // Nice default background so frame zero is never a black void.
  gpuCommon.setClearColor(new THREE.Color(RENDER_CONFIG.sky.horizon), 1);

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
  gpuCommon.setRenderTarget(null);
  gpuCommon.clear(true, true, true);

  /*
   * THE GPU STRING STILL COMES FROM A WEBGL PROBE ON BOTH PATHS, and that is not
   * laziness. `WEBGL_debug_renderer_info` is the only interface that names the
   * adapter; WebGPU deliberately does not expose one (`GPUAdapterInfo` reports
   * vendor/architecture at best and is empty on many configurations). The probe
   * canvas is thrown away immediately and costs a few milliseconds once, and it
   * is the same string `detectQualityTier()` already picks the tier from.
   */
  let capabilities: RendererHandle['capabilities'];
  if (webglRenderer !== null) {
    const gl = webglRenderer.getContext();
    let gpu = 'unknown';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpu = String(gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL));
    } catch {
      /* blocked by privacy settings — fine */
    }
    capabilities = {
      webgl2: webglRenderer.capabilities.isWebGL2 !== false,
      maxTextureSize: webglRenderer.capabilities.maxTextureSize,
      maxSamples: (webglRenderer.capabilities as any).maxSamples ?? 0,
      anisotropy: webglRenderer.capabilities.getMaxAnisotropy(),
      floatRenderTargets:
        !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float'),
      gpu,
      // There is no WebGPU adapter on this path, and `null` says so. The field
      // is not optional because "absent" and "the adapter reported nothing" are
      // different facts and a bug report has to be able to tell them apart.
      adapter: null,
    };
  } else {
    /*
     * THE ADAPTER IS THE BETTER ANSWER HERE AND IT WAS NOT BEING ASKED.
     *
     * `probeGpuRenderer()` opens a throwaway WebGL context and reads
     * `WEBGL_debug_renderer_info`, which names whichever GPU the browser gives
     * *WebGL* — not necessarily the one the *WebGPU* device came from. On a
     * Windows hybrid laptop those are routinely different chips, and
     * `powerPreference: 'high-performance'` is a hint the driver profile can
     * overrule: Stage A asked for high-performance and got an integrated
     * `amd`/`gcn-5` on a box holding an RTX 3080.
     *
     * So the device's own `adapterInfo` leads, and the WebGL probe stays as the
     * fallback for the configurations that report nothing (`GPUAdapterInfo` is
     * allowed to be empty, and several are).
     */
    capabilities = {
      webgl2: true,
      // WebGPU guarantees 8192 in the default limits; three does not publish a
      // `maxTextureSize` on `Renderer`, and every generator in this project caps
      // well below it.
      maxTextureSize: 8192,
      maxSamples: 4,
      anisotropy: nodeRenderer!.getMaxAnisotropy(),
      floatRenderTargets: true,
      gpu: describeAdapter(preparedAdapter) ?? probeGpuRenderer() ?? 'unknown',
      adapter: preparedAdapter,
    };
  }

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
      gpuCommon.setPixelRatio(plan.pixelRatio);
      // updateStyle=false when we are driving a fixed-size offscreen render.
      gpuCommon.setSize(plan.cssWidth, plan.cssHeight, !fixed);

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
          gpuCommon.setRenderTarget(null);
          gpuCommon.clear(true, true, true);
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
      gpuCommon.setRenderTarget(null);
      gpuCommon.clear(true, true, true);
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
      gpuCommon.toneMappingExposure = cfg.exposure;
    }
    if (touched(changed, 'renderer.shadows.enabled')) {
      gpuCommon.shadowMap.enabled = cfg.shadows.enabled;
      gpuCommon.shadowMap.needsUpdate = true;
    }
    if (touched(changed, 'renderer.shadows.type')) {
      gpuCommon.shadowMap.type = cfg.shadows.type;
      gpuCommon.shadowMap.needsUpdate = true;
    }
  });

  /*
   * The tripwire runs on the SHIPPING PATH, not only under the flag.
   *
   * It was a tautology while there was one renderer — a `WebGLRenderer` cannot
   * report anything but `'webgl'` — and it was wired then precisely so it would
   * already be load-bearing on the day it stopped being one. THIS IS THAT DAY:
   * `WebGPURenderer` resolves `init()` under its WebGL2 fallback behind a single
   * `warn()`, and that fallback is a THIRD renderer (node materials over WebGL2)
   * which Stage A measured as the slowest of the three. It fails here rather
   * than reporting frames under a renderer nobody selected.
   */
  const liveBackend = liveBackendOf(webglRenderer ?? nodeRenderer);
  assertBackend(wantBackend, liveBackend);

  const handle: RendererHandle = {
    webgl: webglRenderer,
    node: nodeRenderer,
    canvas,
    size,
    capabilities,
    backend: liveBackend,

    frameInfo() {
      return normaliseInfo((webglRenderer ?? nodeRenderer!).info as unknown as RendererInfoLike);
    },

    get resolutionScale() { return cfg.resolutionScale; },
    get isFixedSize() { return fixedWidth !== null; },

    isContextLost() {
      /*
       * `deviceLost` is module state, not handle state, and that is deliberate:
       * the node renderer outlives the handle (see `dispose`), so the fact that
       * its device died has to outlive the handle too. A `webglcontextlost` on
       * the WebGL path is unaffected — that flag is per-handle, as it was.
       */
      return contextLost || (nodeRenderer !== null && deviceLost !== null);
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
      gpuCommon.toneMapping = TONE_MAPPING_LOOKUP[mode] ?? THREE.NoToneMapping;
      gpuCommon.toneMappingExposure = mode === 'none' ? 1.0 : cfg.exposure;
    },

    setExposure(v) {
      cfg.exposure = v;
      RENDER_CONFIG.post.grade.exposure = v;
      if (gpuCommon.toneMapping !== THREE.NoToneMapping) gpuCommon.toneMappingExposure = v;
    },

    setShadowsEnabled(v) {
      cfg.shadows.enabled = v;
      gpuCommon.shadowMap.enabled = v;
      gpuCommon.shadowMap.needsUpdate = true;
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
      (webglRenderer ?? nodeRenderer!).info.reset();
      // Arm the one shadow rebuild this frame is allowed. See the
      // `autoUpdate = false` block in `createRenderer` for why this is not the
      // default: with autoUpdate on, GTAO's normal prepass rendered the whole
      // shadow pass a second time.
      if (gpuCommon.shadowMap.enabled) gpuCommon.shadowMap.needsUpdate = true;
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
      /*
       * THE NODE RENDERER OUTLIVES THE HANDLE, DELIBERATELY.
       *
       * `Shell` disposes the whole engine between skirmishes and boots a fresh
       * one on the same canvas. Disposing a `WebGPURenderer` means the next boot
       * has to `requestAdapter`/`requestDevice` again — and `prepareRenderer` is
       * async while `bootstrap()` is not, so the cost would land as a stall in a
       * place that cannot await. It is parked in `preparedNode` and adopted by
       * the next `createRenderer`.
       *
       * Nothing leaks that a match owns: scenes, geometries, materials and
       * textures are disposed by their own modules' `dispose()`, exactly as they
       * are on the WebGL path.
       */
      webglRenderer?.dispose();
    },
  };

  if (DEV) {
    const label = liveBackend === 'webgl'
      ? `WebGL${capabilities.webgl2 ? '2' : '1'}`
      : liveBackend === 'webgpu' ? 'WebGPU' : 'WebGPU->WebGL2 FALLBACK';
    const probe = compositingProbe();
    console.info(
      `[render] ${label} · ${capabilities.gpu} · ` +
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

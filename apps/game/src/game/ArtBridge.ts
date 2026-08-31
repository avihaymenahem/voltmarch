/**
 * VOLTMARCH — ArtDirection -> RENDER_CONFIG bridge.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `src/core/config.ts` owns `DEFAULT_ART`: the values file a non-programmer
 * edits (hex strings, degrees, densities). `src/render/renderer.ts` owns
 * `RENDER_CONFIG`: the live, mutable object every render module subscribes to
 * (packed 0xRRGGBB ints, metres, three enums). The render layer deliberately
 * imports nothing outside `src/render/**` + `three`, so *somebody* has to
 * translate. That somebody is this file, and only this file.
 *
 * It is the only place in the program that knows both vocabularies. When
 * `ArtStore` lands it should call `pushArt()` on every diff instead of
 * re-implementing the mapping.
 *
 * RULES
 *   - Pure translation. No THREE objects, no allocation of GPU resources.
 *   - Everything routes through `configureRender()`, which diffs and dispatches
 *     — so a slider drag mutates uniforms, it never rebuilds anything.
 */

import type { ArtDirection, DeepPartial as CoreDeepPartial } from '../core/types';
import { CAMERA, DEFAULT_ART, MAP_SIZE, MOODS } from '../core/config';
import { clamp01, hexToInt, mixInt } from '../core/math';
import { configureRender, type RenderConfig, type DeepPartial, type ToneMappingMode } from '../render/renderer';

/* -------------------------------------------------------------------------- */
/* Mood resolution                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive structural clone of the plain-data art bible. */
function cloneArt<T>(src: T): T {
  if (Array.isArray(src)) return src.map((v) => cloneArt(v)) as unknown as T;
  if (isPlainObject(src)) {
    const out: Record<string, unknown> = {};
    for (const k in src) out[k] = cloneArt((src as Record<string, unknown>)[k]);
    return out as T;
  }
  return src;
}

/** In-place deep merge of a partial over a full art object. */
function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const k in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    const next = patch[k];
    if (next === undefined) continue;
    const cur = target[k];
    if (isPlainObject(next) && isPlainObject(cur)) mergeInto(cur, next);
    else target[k] = next;
  }
}

/**
 * Resolve `?art=<mood>` into a complete ArtDirection.
 * An unknown mood name falls back to the shipping look and warns — a typo in a
 * URL must never produce a black screen.
 */
export function resolveArt(mood?: string | null): ArtDirection {
  const art = cloneArt(DEFAULT_ART);
  if (!mood || mood === 'noon') return art;
  const patch = MOODS[mood] as CoreDeepPartial<ArtDirection> | undefined;
  if (!patch) {
    console.warn(`[art] unknown mood "${mood}" — known: ${Object.keys(MOODS).join(', ')}`);
    return art;
  }
  mergeInto(art as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  return art;
}

/* -------------------------------------------------------------------------- */
/* Translation                                                                */
/* -------------------------------------------------------------------------- */

/** `ToneLook.mode` is a free string in the art bible; the renderer wants a union. */
function toneMode(mode: string): ToneMappingMode {
  switch (mode) {
    case 'agx':
    case 'aces':
    case 'neutral':
    case 'linear':
    case 'none':
      return mode;
    // The bible documents 'reinhard' as a legal value but three has no such
    // tonemapper on the post path; AgX is the nearest rolloff.
    case 'reinhard':
      return 'agx';
    default:
      console.warn(`[art] unknown tone.mode "${mode}" — using agx`);
      return 'agx';
  }
}

/**
 * Height fog (`fogDensity`, per-metre) does not exist in three's linear
 * `Fog(near, far)`. Convert to the distance at which the exponential term has
 * decayed to ~5% (e^-3), which is where the eye reads "fully fogged".
 *
 * `density <= 0` means "no fog", and it is expressed as a fog end far beyond
 * the camera far plane rather than as a null, because `RenderConfig.fog` has no
 * enabled flag and the render layer must never import core. `scene.ts` reads
 * exactly this: a fog whose end sits past `camera.far` cannot tint anything, so
 * it drops `scene.fog` to null entirely and every material in the game loses
 * its fog chunk. That pair is what implements the bible's §1 standing ruling
 * banning aerial perspective on daylight maps (scorecard #12).
 *
 * Keep the sentinel comfortably larger than any plausible `camera.far` (900 m
 * today) or a mood that intends no fog will quietly get some.
 */
const FOG_DISABLED_END = 4000;

function fogEndFromDensity(start: number, density: number): number {
  if (!(density > 0)) return FOG_DISABLED_END;
  return start + 3 / density;
}

/** Camera constants live in core; the rig reads RENDER_CONFIG.camera. */
export function cameraPatch(): DeepPartial<RenderConfig> {
  return {
    camera: {
      fov: CAMERA.fovDeg,
      pitch: CAMERA.pitchDeg,
      near: CAMERA.near,
      far: CAMERA.far,
      distance: CAMERA.defaultDistance,
      minDistance: CAMERA.minDistance,
      gameplayMinDistance: CAMERA.gameplayMinDistance,
      maxDistance: CAMERA.maxDistance,
      panSpeed: CAMERA.panSpeed,
      edgePanPixels: CAMERA.edgePanPixels,
      edgePanSpeed: CAMERA.panSpeed * CAMERA.edgePanScale,
      zoomStep: CAMERA.zoomStep,
      yawSpeed: CAMERA.yawSpeed,
      bounds: {
        minX: -CAMERA.panMargin,
        minZ: -CAMERA.panMargin,
        maxX: MAP_SIZE + CAMERA.panMargin,
        maxZ: MAP_SIZE + CAMERA.panMargin,
      },
    },
  };
}

/** Full translation of an ArtDirection into a RENDER_CONFIG patch. */
export function artPatch(art: ArtDirection): DeepPartial<RenderConfig> {
  const { sun, atmosphere: atm, tone, bloom, ao } = art;

  return {
    renderer: {
      // The renderer stays at NoToneMapping while the post chain is alive —
      // GradePass does the tonemap after bloom. This is the fallback value.
      exposure: tone.exposure,
      shadows: {
        mapSize: sun.cascadeResolution,
        bias: sun.shadowBias,
        normalBias: sun.shadowNormalBias,
        farExtent: sun.cascadeFar,
        intensity: sun.shadowIntensity,
        radius: sun.shadowSoftness,
      },
    },
    sun: {
      azimuth: sun.azimuthDeg,
      elevation: sun.elevationDeg,
      color: hexToInt(sun.color),
      intensity: sun.intensity,
    },
    sky: {
      zenith: hexToInt(atm.skyZenith),
      horizon: hexToInt(atm.skyHorizon),
      ground: hexToInt(atm.skyGround),
      sunDiskSize: atm.sunDiskDeg,
      hazeWidth: atm.hazeWidthDeg,
      hemiSky: hexToInt(atm.hemiSky),
      hemiSkyIntensity: atm.hemiSkyIntensity,
      hemiGround: hexToInt(atm.hemiGround),
      hemiGroundIntensity: atm.hemiGroundIntensity,
      envIntensity: atm.envIntensity,
    },
    fog: {
      color: hexToInt(atm.fogColor),
      start: atm.fogStart,
      end: fogEndFromDensity(atm.fogStart, atm.fogDensity),
      aerialPerspective: atm.aerialPerspective,
    },
    post: {
      ao: {
        enabled: ao.enabled,
        radius: ao.radius,
        intensity: ao.intensity,
        power: ao.power,
        samples: ao.samples,
        halfRes: ao.halfRes,
      },
      // `strength` is the AUTHORED figure; `post.ts#syncConfig` multiplies it
      // by `max(0.25, emissiveBoost / 1.6)` before it reaches the pass. This
      // bridge deliberately does not pre-multiply — a critic mutating
      // `emissiveBoost` at runtime must see the glow move.
      bloom: {
        threshold: bloom.threshold,
        strength: bloom.strength,
        radius: bloom.radius,
        emissiveBoost: bloom.emissiveBoost,
      },
      grade: {
        mode: toneMode(tone.mode),
        exposure: tone.exposure,
        contrast: tone.contrast,
        saturation: tone.saturation,
        shadowSaturation: tone.shadowSaturation,
        shadowTint: hexToInt(tone.shadowTint),
        midTint: hexToInt(tone.midTint),
        highlightTint: hexToInt(tone.highlightTint),
        lift: hexToInt(tone.lift),
        gain: hexToInt(tone.gain),
        vignette: tone.vignette,
        vignetteSoftness: tone.vignetteSoftness,
        grain: tone.grain,
        grainSize: tone.grainSize,
        chromaticAberration: tone.chromaticAberration,
        sharpen: tone.sharpen,
      },
    },
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compass interpolation across the short arc, so north never causes a spin. */
function lerpDegrees(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function lerpHex(a: string, b: string, t: number): number {
  return mixInt(hexToInt(a), hexToInt(b), t);
}

/**
 * Uniform-only subset of `artPatch`, interpolated for the live time-of-day
 * clock. Terrain, faction identity and gameplay silhouettes never move.
 */
export function blendedArtPatch(
  from: ArtDirection, to: ArtDirection, amount: number,
): DeepPartial<RenderConfig> {
  const t = clamp01(amount);
  const sunA = from.sun, sunB = to.sun;
  const atmA = from.atmosphere, atmB = to.atmosphere;
  const toneA = from.tone, toneB = to.tone;
  const bloomA = from.bloom, bloomB = to.bloom;
  const fogStart = lerp(atmA.fogStart, atmB.fogStart, t);
  const fogDensity = lerp(atmA.fogDensity, atmB.fogDensity, t);
  const nearestTone = t < 0.5 ? toneA : toneB;

  return {
    renderer: {
      exposure: lerp(toneA.exposure, toneB.exposure, t),
      shadows: {
        mapSize: t < 0.5 ? sunA.cascadeResolution : sunB.cascadeResolution,
        bias: lerp(sunA.shadowBias, sunB.shadowBias, t),
        normalBias: lerp(sunA.shadowNormalBias, sunB.shadowNormalBias, t),
        farExtent: lerp(sunA.cascadeFar, sunB.cascadeFar, t),
        intensity: lerp(sunA.shadowIntensity, sunB.shadowIntensity, t),
        radius: lerp(sunA.shadowSoftness, sunB.shadowSoftness, t),
      },
    },
    sun: {
      azimuth: lerpDegrees(sunA.azimuthDeg, sunB.azimuthDeg, t),
      elevation: lerp(sunA.elevationDeg, sunB.elevationDeg, t),
      color: lerpHex(sunA.color, sunB.color, t),
      intensity: lerp(sunA.intensity, sunB.intensity, t),
    },
    sky: {
      zenith: lerpHex(atmA.skyZenith, atmB.skyZenith, t),
      horizon: lerpHex(atmA.skyHorizon, atmB.skyHorizon, t),
      ground: lerpHex(atmA.skyGround, atmB.skyGround, t),
      sunDiskSize: lerp(atmA.sunDiskDeg, atmB.sunDiskDeg, t),
      hazeWidth: lerp(atmA.hazeWidthDeg, atmB.hazeWidthDeg, t),
      hemiSky: lerpHex(atmA.hemiSky, atmB.hemiSky, t),
      hemiSkyIntensity: lerp(atmA.hemiSkyIntensity, atmB.hemiSkyIntensity, t),
      hemiGround: lerpHex(atmA.hemiGround, atmB.hemiGround, t),
      hemiGroundIntensity: lerp(atmA.hemiGroundIntensity, atmB.hemiGroundIntensity, t),
      envIntensity: lerp(atmA.envIntensity, atmB.envIntensity, t),
    },
    fog: {
      color: lerpHex(atmA.fogColor, atmB.fogColor, t),
      start: fogStart,
      end: fogEndFromDensity(fogStart, fogDensity),
      aerialPerspective: lerp(atmA.aerialPerspective, atmB.aerialPerspective, t),
    },
    post: {
      bloom: {
        threshold: lerp(bloomA.threshold, bloomB.threshold, t),
        strength: lerp(bloomA.strength, bloomB.strength, t),
        radius: lerp(bloomA.radius, bloomB.radius, t),
        emissiveBoost: lerp(bloomA.emissiveBoost, bloomB.emissiveBoost, t),
      },
      grade: {
        mode: toneMode(nearestTone.mode),
        exposure: lerp(toneA.exposure, toneB.exposure, t),
        contrast: lerp(toneA.contrast, toneB.contrast, t),
        saturation: lerp(toneA.saturation, toneB.saturation, t),
        shadowSaturation: lerp(toneA.shadowSaturation, toneB.shadowSaturation, t),
        shadowTint: lerpHex(toneA.shadowTint, toneB.shadowTint, t),
        midTint: lerpHex(toneA.midTint, toneB.midTint, t),
        highlightTint: lerpHex(toneA.highlightTint, toneB.highlightTint, t),
        lift: lerpHex(toneA.lift, toneB.lift, t),
        gain: lerpHex(toneA.gain, toneB.gain, t),
        vignette: lerp(toneA.vignette, toneB.vignette, t),
        vignetteSoftness: lerp(toneA.vignetteSoftness, toneB.vignetteSoftness, t),
        grain: lerp(toneA.grain, toneB.grain, t),
        grainSize: lerp(toneA.grainSize, toneB.grainSize, t),
        chromaticAberration: lerp(
          toneA.chromaticAberration, toneB.chromaticAberration, t,
        ),
        sharpen: lerp(toneA.sharpen, toneB.sharpen, t),
      },
    },
  };
}

/**
 * Push an art bible into the live render config.
 * Returns the dotted paths that actually changed (empty on a no-op).
 */
export function pushArt(art: ArtDirection): ReadonlyArray<string> {
  return configureRender(artPatch(art));
}

/** Push a time-of-day interpolation without permitting texture/pipeline work. */
export function pushArtBlend(
  from: ArtDirection, to: ArtDirection, amount: number,
): ReadonlyArray<string> {
  return configureRender(blendedArtPatch(from, to, amount), { transient: true });
}

/** Push the core camera constants. Call once, before `createCameraRig`. */
export function pushCamera(): ReadonlyArray<string> {
  return configureRender(cameraPatch());
}

/**
 * ============================================================================
 * VOLTMARCH — src/world/water-uniforms.ts
 * ============================================================================
 * THE WATER UNIFORM BLOCK, AND THE ONE PLACE A PALETTE IS TURNED INTO NUMBERS.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There are now TWO water materials: `WaterMaterial.ts` (the shipping
 * `THREE.ShaderMaterial` with hand-written GLSL) and `WaterNodeMaterial.ts`
 * (the TSL `NodeMaterial` for the WebGPU / WebGL2-fallback node path). They draw
 * the same sea and must agree, to the last decimal, about what a palette and a
 * basin depth mean — otherwise the migration ships two seas and nobody can tell
 * which one is the regression.
 *
 * This is `terrain-uniforms.ts` for the water, written for the same reason and
 * with the same rules. It is the shared VOCABULARY, not either implementation:
 * **nothing in here may import TSL or emit GLSL.**
 *
 * RULING #7 IS ENFORCED HERE NOW, ONCE
 * ------------------------------------
 * `WaterMaterial.ts`'s header says the grazing term is "hard-clamped to
 * `WATER_SSR.mixMax` in `createWaterMaterial` — not merely documented, clamped".
 * That clamp was one `Math.min` inside one factory. A second factory that forgot
 * it would ship a mirror, and the file that forbids mirrors would still read as
 * true. `WATER_CONSTANTS.ssrMix` is that clamp, applied once, and both materials
 * take the number from here rather than from `WATER_SSR.mix`.
 *
 * THE SINK IS `{ value }` BECAUSE BOTH PATHS ALREADY ARE
 * ------------------------------------------------------
 * A `THREE.IUniform` is `{ value }`. A TSL `uniform( x )` node is ALSO
 * `{ value }` — `UniformNode extends InputNode` and `.value` is the live slot.
 * So one interface covers both without an adapter, and `applyWaterPalette`
 * mutates the vectors in place exactly as the old code did: a palette swap
 * never rebuilds a program.
 *
 * THE RAMP IS THE ONE PLACE THE TWO PATHS DIFFER, and it differs the same way
 * the terrain's layer arrays do. GLSL's `uniform vec3 uRamp[8]` is
 * `{ value: Vector3[] }`; TSL's `uniformArray( [...], 'vec3' )` keeps the JS
 * array on `.array` and leaves `.value` null. So the sink takes the bare
 * `Vector3[]` and each material hands over whichever field holds it. Both are
 * mutated in place; neither is replaced.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  MAP_SIZE, WATER_FIELD, WATER_FOAM, WATER_GLINT, WATER_LOOK, WATER_SHORE,
  WATER_SSR, WATER_WAKE, WATER_WAVES,
  type WaterPalette,
} from '../core/config';
import { DEG2RAD, TAU, clamp, clamp01, hexToLinearRgb } from '../core/math';
import { LACE_SIGMA, probit } from './water-texture-gen';

/* ==========================================================================
 * 1. THE SLOT SHAPES
 * ========================================================================== */

/** A live scalar uniform. Satisfied by `THREE.IUniform` and by a TSL `uniform()`. */
export interface NumberSlot { value: number }
/** A live vec3 uniform. The Vector3 is mutated in place, never replaced. */
export interface Vec3Slot { value: THREE.Vector3 }

/**
 * Every uniform a PALETTE writes.
 *
 * Deliberately not every uniform the material has: the wave bands, the foam
 * thresholds, the shoreline geometry and the light rig are properties of the
 * SEA rather than of the colour scheme, so they are the same under every
 * palette and are set once from `WATER_CONSTANTS` below.
 */
export interface WaterPaletteSink {
  /** `WATER_LOOK.rampStops` even stops, mutated in place. */
  readonly ramp: THREE.Vector3[];
  readonly uRampDepth: NumberSlot;
  readonly uAbsorb: Vec3Slot;
  readonly uSeabed: Vec3Slot;
  /** x = seabed fade metres (depends on the basin), y = contrast, z = refraction. */
  readonly uBed: Vec3Slot;
  readonly uFoamColor: Vec3Slot;
  readonly uShoreFoam: Vec3Slot;
  readonly uShoreMid: Vec3Slot;
  readonly uShoreWater: Vec3Slot;
  readonly uReflect: Vec3Slot;
}

/* ==========================================================================
 * 2. COLOUR HELPERS
 * ========================================================================== */

const _rgb = new Float32Array(3);

/**
 * Hex to LINEAR rgb, into an optional destination.
 *
 * Every colour the water shader consumes is scene-linear: the surface is drawn
 * into the half-float post target and graded downstream, so an sRGB value here
 * would be tone-mapped twice.
 */
export function waterLinearVec(hex: string, out?: THREE.Vector3): THREE.Vector3 {
  hexToLinearRgb(hex, _rgb as unknown as number[]);
  const v = out ?? new THREE.Vector3();
  return v.set(_rgb[0], _rgb[1], _rgb[2]);
}

/**
 * Resample an authored, unevenly spaced ramp onto N even stops.
 *
 * The shader wants even spacing so its lookup is a branchless chain of mixes.
 * Eight stops over `rampDepth` is one stop per ~1 m on a 2.4 TL basin, which
 * is finer than the 8-bit depth field can resolve anyway.
 */
export function resampleRamp(palette: WaterPalette, stops: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const src = palette.ramp;
  const last = src.length - 1;
  for (let i = 0; i < stops; i++) {
    const t = stops === 1 ? 0 : i / (stops - 1);
    let k = 0;
    while (k < last - 1 && t > src[k + 1].t) k++;
    const a = src[k];
    const b = src[k + 1] ?? a;
    const span = b.t - a.t;
    const f = span > 1e-6 ? clamp01((t - a.t) / span) : 0;
    out.push(waterLinearVec(a.hex).lerp(waterLinearVec(b.hex), f));
  }
  return out;
}

/* ==========================================================================
 * 3. THE DERIVED SCALARS
 *
 * Three numbers that are neither a config literal nor a palette entry, and each
 * of which was a bare expression inside `createWaterMaterial`. A second factory
 * re-deriving any of them by hand is the drift this file exists to prevent.
 * ========================================================================== */

/**
 * The lace threshold that yields `WATER_SHORE.coverage` inside the band.
 *
 * Inside the band the shader adds `bandMask * 0.30` (bandMask ~ 1) to a lace
 * value distributed N(0.5, LACE_SIGMA), then runs it through a 0.14-wide
 * smoothstep. Solving for the threshold rather than eyeballing it is what
 * makes scorecard #27's "~45% coverage" a property of the code.
 */
export function shoreChurnThreshold(): number {
  const push = 0.30;
  const rampWidth = 0.14;
  const level = 0.5 + LACE_SIGMA * probit(1 - clamp(WATER_SHORE.coverage, 0.02, 0.98));
  return level + push - rampWidth * 0.5;
}

/**
 * `1 / sqrt(m^2 + (1-m)^2)` — mixing two independent gaussians of equal sigma
 * with weight m narrows the result by exactly that factor. Undoing it keeps
 * the foam coverage where the probe measured it.
 */
export function laceRenormaliser(mix: number): number {
  return 1 / Math.sqrt(mix * mix + (1 - mix) * (1 - mix));
}

/**
 * The absorption coefficients and the seabed fade for a given basin.
 *
 * Absorption is scaled by the same factor the ramp depth is. A procedural
 * basin is often only 2 m deep; at the bible's literal coefficients the water
 * would be almost perfectly clear and the whole absorption identity would be
 * invisible. Scaling both together preserves the LOOK at any basin depth —
 * the seabed still vanishes at the same FRACTION of the way down.
 */
export function waterAbsorbFor(
  palette: WaterPalette, rampDepth: number,
): { r: number; g: number; b: number; fadeMetres: number } {
  const k = WATER_LOOK.rampDepthMetres / Math.max(rampDepth, 0.25);
  return {
    r: palette.absorb[0] * k,
    g: palette.absorb[1] * k,
    b: palette.absorb[2] * k,
    fadeMetres: WATER_LOOK.seabedFadeMetres / k,
  };
}

/**
 * The value `lightBody` takes for flat calm water under this rig. Dividing by
 * it means the authored ramp hexes render as themselves at noon (they were
 * sampled off graded frames, so they ARE the target pixel values) while a
 * night or overcast preset still darkens and tints the water correctly.
 */
export interface WaterLightRigLike {
  readonly sunDir: THREE.Vector3;
  readonly sunColor: THREE.Vector3;
  readonly hemiSky: THREE.Vector3;
}

const _norm = new THREE.Vector3();

export function waterLightNorm(rig: WaterLightRigLike): number {
  const ndl = Math.max(rig.sunDir.y, 0);
  _norm.copy(rig.sunColor).multiplyScalar(WATER_LOOK.sunDiffuse * ndl)
    .addScaledVector(rig.hemiSky, WATER_LOOK.fillDiffuse);
  const l = 0.2126 * _norm.x + 0.7152 * _norm.y + 0.0722 * _norm.z;
  return l > 1e-4 ? l : 1e-4;
}

/* ==========================================================================
 * 4. THE PALETTE-INDEPENDENT CONSTANTS
 *
 * One table, read by both factories. Every entry was a literal expression
 * inside `createWaterMaterial`'s uniform block; `tests/water-node-material.spec.ts`
 * transcribes the pre-move values so a shared table cannot hide a drift.
 * ========================================================================== */

const rotDeg = WATER_WAVES.rotationDeg;
const heading1 = WATER_WAVES.swellHeadingDeg * DEG2RAD;
const heading2 = WATER_WAVES.swellHeadingDeg2 * DEG2RAD;

export const WATER_CONSTANTS = {
  uInvMapSize: 1 / MAP_SIZE,
  uEncodeMetres: WATER_FIELD.encodeMetres,
  uShoreEncode: WATER_SHORE.encodeMetres,

  /** x,y = swell wavelengths, z = amplitude, w = speed. */
  waveA: [
    WATER_WAVES.swellMetres, WATER_WAVES.swellMetres2,
    WATER_WAVES.swellAmplitude, WATER_WAVES.swellSpeed,
  ] as const,
  /** x = chop tile, y = chop speed, z = chop strength, w = crest sharpness. */
  waveB: [
    WATER_WAVES.chopTileMetres, WATER_WAVES.chopSpeed,
    WATER_WAVES.chopStrength, WATER_WAVES.swellSharpness,
  ] as const,
  /** x = micro tile, y = micro speed, z = micro strength, w = sea state. */
  waveC: [
    WATER_WAVES.microTileMetres, WATER_WAVES.microSpeed,
    WATER_WAVES.microStrength, WATER_WAVES.seaState,
  ] as const,
  swellDir: [
    Math.cos(heading1), Math.sin(heading1), Math.cos(heading2), Math.sin(heading2),
  ] as const,
  rot47: [Math.cos(rotDeg[1] * DEG2RAD), Math.sin(rotDeg[1] * DEG2RAD)] as const,
  rot113: [Math.cos(rotDeg[2] * DEG2RAD), Math.sin(rotDeg[2] * DEG2RAD)] as const,

  /** x = lo, y = hi, z = crest gain, w = scroll m/s. */
  foam: [
    WATER_FOAM.thresholdLo, WATER_FOAM.thresholdHi,
    WATER_FOAM.crestGain, WATER_FOAM.scrollSpeed,
  ] as const,
  /** x = lace tile, y = detail tile, z = detail mix, w = mix renormaliser. */
  laceParams: [
    WATER_FOAM.laceTileMetres, WATER_FOAM.laceDetailMetres, WATER_FOAM.laceDetailMix,
    laceRenormaliser(WATER_FOAM.laceDetailMix),
  ] as const,
  /** x = choppy threshold bias, y = distance (mip) compensation, z = wake gain. */
  foamMisc: [
    WATER_FOAM.choppyBias, WATER_FOAM.distanceBias, WATER_WAKE.foamGain,
  ] as const,

  /** x = band metres, y = pulse rad/s, z = pulse amount, w = scroll m/s. */
  shore: [
    WATER_SHORE.bandMetres, WATER_SHORE.pulseHz * TAU,
    WATER_SHORE.pulseAmount, WATER_SHORE.scrollSpeed,
  ] as const,
  /** x = lighten depth, y = churn threshold, z = churn tile. */
  shoreMisc: [
    WATER_SHORE.lightenDepthMetres, shoreChurnThreshold(), WATER_FOAM.laceTileMetres * 0.5,
  ] as const,

  /** x = sun diffuse, y = fill diffuse, z = output gain. */
  grade: [
    WATER_LOOK.sunDiffuse, WATER_LOOK.fillDiffuse, WATER_LOOK.outputGain,
  ] as const,
  /** x = roughness, y = anisotropy, z = intensity, w = distance widening. */
  glint: [
    WATER_GLINT.roughness, WATER_GLINT.anisotropy, WATER_GLINT.intensity, 0.9,
  ] as const,

  /**
   * RULING #7, AS ARITHMETIC. `WATER_SSR.mix` is what the art direction asks
   * for; this is what the shader is allowed to have. Both materials read the
   * clamped number and neither reads `WATER_SSR.mix`.
   */
  ssrMix: Math.min(WATER_SSR.mix, WATER_SSR.mixMax),
  ssrFresnelPower: WATER_SSR.fresnelPower,
  /**
   * The shore channel saturates at its encode range, so a falloff past that
   * would leave the grazing term at a permanent floor offshore.
   */
  ssrShoreFalloff: Math.min(WATER_SSR.shoreFalloffMetres, WATER_SHORE.encodeMetres * 0.92),

  /** Foam is lit its own way — a 0.80 sun coefficient against the body's 0.30. */
  foamSunDiffuse: WATER_LOOK.foamSunDiffuse,
  foamFillDiffuse: WATER_LOOK.foamFillDiffuse,

  /** Constant halves of `uBed`; x is per-basin and comes from `waterAbsorbFor`. */
  seabedContrast: WATER_LOOK.seabedContrast,
  refractionMetres: WATER_LOOK.refractionMetres,

  rampStops: WATER_LOOK.rampStops,

  /** Default light rig, replaced by `applyLighting` on the first frame. */
  sunDir: [0.4, 0.6, 0.7] as const,
  sunColor: [3.1, 2.8, 2.3] as const,
  hemiSky: [0.2, 0.35, 0.7] as const,
  hemiGround: [0.25, 0.2, 0.12] as const,
} as const;

/* ==========================================================================
 * 5. THE ONE PLACE A PALETTE BECOMES UNIFORMS
 * ========================================================================== */

/**
 * Write `palette` and `rampDepth` into whichever material's slots were handed
 * over. Mutates in place and allocates only the resampled ramp, exactly as
 * `createWaterMaterial`'s `applyPalette` always has.
 */
export function applyWaterPalette(
  palette: WaterPalette, rampDepth: number, sink: WaterPaletteSink,
): void {
  const stops = resampleRamp(palette, WATER_CONSTANTS.rampStops);
  for (let i = 0; i < stops.length && i < sink.ramp.length; i++) sink.ramp[i].copy(stops[i]);
  sink.uRampDepth.value = rampDepth;

  waterLinearVec(palette.seabed, sink.uSeabed.value);
  waterLinearVec(palette.foam, sink.uFoamColor.value);
  waterLinearVec(palette.shoreFoam, sink.uShoreFoam.value);
  waterLinearVec(palette.shoreMid, sink.uShoreMid.value);
  waterLinearVec(palette.shoreWater, sink.uShoreWater.value);
  waterLinearVec(palette.reflect, sink.uReflect.value);

  const a = waterAbsorbFor(palette, rampDepth);
  sink.uAbsorb.value.set(a.r, a.g, a.b);
  sink.uBed.value.set(a.fadeMetres, WATER_CONSTANTS.seabedContrast, WATER_CONSTANTS.refractionMetres);
}

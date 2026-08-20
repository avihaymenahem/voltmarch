/**
 * ============================================================================
 * VOLTMARCH — src/world/terrain-uniforms.ts
 * ============================================================================
 * THE TERRAIN UNIFORM BLOCK, AND THE ONE PLACE A BIOME IS TURNED INTO NUMBERS.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There are now TWO terrain materials: `TerrainMaterial.ts` (the shipping
 * `MeshStandardMaterial` + `onBeforeCompile` GLSL) and `TerrainNodeMaterial.ts`
 * (the TSL `MeshStandardNodeMaterial` for the WebGPU/WebGL2 node path). They
 * draw the same ground and must agree, to the last decimal, about what a biome
 * means — otherwise the migration ships two grades and nobody can tell which
 * one is the regression.
 *
 * The obvious implementation is two copies of `applyBiome`. That is precisely
 * the drift CLAUDE.md catalogues: two tables that agree today, one edited
 * tomorrow, and a divergence nobody is looking for. So the defaults and the
 * biome application live HERE, once, and both materials call them.
 *
 * THE SINK IS `{ value }` BECAUSE BOTH PATHS ALREADY ARE
 * ------------------------------------------------------
 * A `THREE.IUniform` is `{ value }`. A TSL `uniform( x )` node is ALSO
 * `{ value }` — `UniformNode extends InputNode` and `.value` is the live slot.
 * So one interface covers both without an adapter, and `applyTerrainBiome`
 * mutates in place exactly as the old code did: a biome swap never allocates a
 * texture or rebuilds a program.
 *
 * THE ARRAYS ARE THE ONE PLACE THE TWO PATHS DIFFER. GLSL's
 * `uniform float uLayerScale[6]` is `{ value: number[] }`; TSL's
 * `uniformArray( [...], 'float' )` keeps the JS array on `.array` and leaves
 * `.value` null. So the sink takes the bare `number[]` and each material hands
 * over whichever field holds it. Both are mutated in place; neither is
 * replaced.
 *
 * NOTHING IN HERE MAY IMPORT TSL OR EMIT GLSL. This file is the shared
 * vocabulary, not either implementation.
 * ============================================================================
 */

import * as THREE from 'three';
import { hexToLinearRgb } from '../core/math';
import { CELL, CLIFF_SLOPE, MAP_SIZE } from '../core/config';
import { SURFACE_COUNT, SurfaceId, type BiomeDef } from './Biomes';

/* ==========================================================================
 * 1. THE SLOT SHAPES
 * ========================================================================== */

/** A live scalar uniform. Satisfied by `THREE.IUniform` and by a TSL `uniform()`. */
export interface NumberSlot { value: number }

/** A live vec3 uniform. The Vector3 is mutated in place, never replaced. */
export interface Vec3Slot { value: THREE.Vector3 }

/**
 * Every uniform a biome writes.
 *
 * Deliberately NOT every uniform the material has: `uInvMapSize`, `uCellSize`,
 * `uSplatSharpen` and `uCliffNy` are properties of the terrain GRID and of the
 * control texture's resolution, not of the art, so they are the same in every
 * biome and are set once from the defaults below.
 */
export interface TerrainBiomeSink {
  /** Six tile sizes in metres, mutated in place. */
  readonly layerScale: number[];
  /** Six per-layer roughnesses, mutated in place. */
  readonly layerRough: number[];

  readonly uMacroScale: NumberSlot;
  readonly uMacroStrength: NumberSlot;
  readonly uMacroTint: Vec3Slot;
  readonly uWarpScale: NumberSlot;
  readonly uWarpAmp: NumberSlot;
  readonly uCellJitter: NumberSlot;

  readonly uCliffBase: Vec3Slot;
  readonly uCliffShade: Vec3Slot;
  readonly uCliffHi: Vec3Slot;
  readonly uCliffCap: Vec3Slot;
  readonly uCliffCapM: NumberSlot;
  readonly uCliffSkirtM: NumberSlot;
  readonly uStriationM: NumberSlot;
  readonly uCourseM: NumberSlot;
  readonly uCourseOn: NumberSlot;
  readonly uCliffRelief: NumberSlot;
  readonly uCliffRough: NumberSlot;
  readonly uCliffGrainMean: NumberSlot;
  readonly uStepHeight: NumberSlot;
}

/* ==========================================================================
 * 2. DEFAULTS
 * ========================================================================== */

/**
 * Splat-weight exponent. Not per-biome: the control texture's resolution is a
 * property of the terrain grid, not of the art, so the correct sharpening is
 * the same everywhere. Above ~4 the boundary starts to show the control
 * texture's own 4 m stair-stepping through the warp.
 */
export const SPLAT_SHARPEN = 2.8;

/**
 * The scalar defaults, in one table both materials read.
 *
 * These are the values the shipping GLSL material has always been constructed
 * with. A biome overwrites most of them immediately; the ones it does not
 * (`uInvMapSize`, `uCellSize`, `uSplatSharpen`, `uCliffNy`, `uFaceMix`) are the
 * grid- and camera-derived constants, and this is their only definition.
 */
export const TERRAIN_SCALAR_DEFAULTS = {
  uInvMapSize: 1 / MAP_SIZE,
  uMacroScale: 34,
  uMacroStrength: 0.13,
  /**
   * Ground-space repeat of the packed material-detail channel in `uMacro.a`.
   * The tile itself is band-limited to features >= 28 texels, so at 5.6 m the
   * shortest relief is about 0.61 m: broad enough to read as soil structure,
   * never per-pixel sandpaper.
   */
  uDetailScale: 5.6,
  /** Metres of apparent height used to perturb the flat-ground normal. */
  uDetailNormal: 0.075,
  /** Peak-to-peak roughness travel driven by the same material-detail field. */
  uDetailRoughness: 0.16,
  uWarpScale: 11,
  uWarpAmp: 0.55,
  uCellSize: CELL,
  uCellJitter: 0.038,
  uSplatSharpen: SPLAT_SHARPEN,

  uCliffNy: Math.cos(CLIFF_SLOPE),
  uCliffCapM: 0.75,
  uCliffSkirtM: 1.3,
  uStriationM: 0.46,
  uCourseM: 0.22,
  uCourseOn: 0,
  uCliffRelief: 0.55,
  uCliffRough: 0.85,
  uCliffGrainMean: 0.17,
  uStepHeight: 6,
  uFaceMix: 0.78,
} as const;

/** The vec3 defaults, in LINEAR space, as the shader consumes them. */
export const TERRAIN_VEC3_DEFAULTS = {
  uMacroTint: [0.088, 0.068, 0.019],
  uCliffBase: [0.19, 0.17, 0.1],
  uCliffShade: [0.06, 0.05, 0.03],
  uCliffHi: [0.32, 0.29, 0.18],
  uCliffCap: [0.1, 0.12, 0.01],
} as const;

/** Six layer tile sizes in metres, before any biome is applied. */
export const TERRAIN_LAYER_SCALE_DEFAULT: readonly number[] = [8, 5.5, 6.5, 7, 4.8, 3.2];
/** Six per-layer roughnesses, before any biome is applied. */
export const TERRAIN_LAYER_ROUGH_DEFAULT: readonly number[] = [0.95, 0.92, 0.9, 0.85, 0.7, 0.68];

/* ==========================================================================
 * 3. COLOUR HELPERS
 * ========================================================================== */

const SCRATCH_RGB = new Float32Array(3);

/** Write a hex colour into a Vector3 as LINEAR rgb. Mutates; never allocates. */
export function setLinearVec3(v: THREE.Vector3, hex: string): void {
  hexToLinearRgb(hex, SCRATCH_RGB);
  v.set(SCRATCH_RGB[0], SCRATCH_RGB[1], SCRATCH_RGB[2]);
}

/** Relative luminance of a hex colour in LINEAR space. */
export function linearLuma(hex: string): number {
  hexToLinearRgb(hex, SCRATCH_RGB);
  return SCRATCH_RGB[0] * 0.2126 + SCRATCH_RGB[1] * 0.7152 + SCRATCH_RGB[2] * 0.0722;
}

/* ==========================================================================
 * 4. THE BIOME APPLICATION
 * ========================================================================== */

/**
 * Re-tint a terrain material for a biome. Uniform values only — no texture is
 * allocated here and no program is rebuilt, which is what keeps a live `?biome=`
 * swap instant instead of a two-second hitch.
 *
 * The LAYER ARRAY is the one thing a biome swap must genuinely rebuild, and it
 * is not this function's business: each material owns its own
 * `DataArrayTexture` lifetime and calls this for the numbers.
 */
export function applyTerrainBiome(biome: BiomeDef, sink: TerrainBiomeSink): void {
  for (let i = 0; i < SURFACE_COUNT; i++) {
    sink.layerScale[i] = biome.layers[i].tileMetres;
    sink.layerRough[i] = biome.layers[i].roughness;
  }

  sink.uMacroScale.value = biome.macroMetres;
  sink.uMacroStrength.value = biome.macroStrength;
  setLinearVec3(sink.uMacroTint.value, biome.macroTint);
  sink.uWarpScale.value = biome.warpMetres;
  sink.uWarpAmp.value = biome.warpAmplitude;
  sink.uCellJitter.value = biome.cellJitter;

  const c = biome.cliff;
  setLinearVec3(sink.uCliffBase.value, c.base);
  setLinearVec3(sink.uCliffShade.value, c.shade);
  setLinearVec3(sink.uCliffHi.value, c.highlight);
  setLinearVec3(sink.uCliffCap.value, c.capColor);
  sink.uCliffCapM.value = c.capMetres;
  sink.uCliffSkirtM.value = c.skirtMetres;
  sink.uStriationM.value = c.striationMetres;
  sink.uCourseM.value = c.courseMetres > 0 ? c.courseMetres : 0.22;
  sink.uCourseOn.value = c.courseMetres > 0 ? 1 : 0;
  sink.uCliffRelief.value = c.relief;
  sink.uCliffRough.value = c.roughness;
  sink.uCliffGrainMean.value = Math.max(1e-3, linearLuma(biome.layers[SurfaceId.Rock].albedo));
  sink.uStepHeight.value = biome.stepHeight;
}

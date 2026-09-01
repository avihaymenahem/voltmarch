/**
 * ============================================================================
 * VOLTMARCH — src/world/irradiance-field.ts
 * ============================================================================
 * A SMALL, MAP-ALIGNED LOW-FREQUENCY BOUNCE FIELD.
 *
 * This module contains no THREE and no DOM so the existing world-warm worker
 * can run it immediately after terrain generation, while that worker still
 * owns the height/surface arrays.  Keeping it in the SAME job matters: posting
 * a second job would structured-clone several megabytes of live terrain input
 * back into a worker just to produce 64 KiB of presentation data.
 *
 * The output is presentation-only.  It never enters TerrainFields, pathing,
 * checksums, saves, replays or simulation state.  RGBA is laid out from
 * min-z/min-x to max-z/max-x, one Float32 texel per 8 m square on the current
 * 512 m map:
 *
 *   RGB  linear, post-ready low-frequency ground bounce radiance.  It is
 *        already surface-colour weighted because the post buffer has no
 *        base-colour channel.  Typical values are 0.01..0.12.
 *   A    local sky visibility / broad terrain occlusion, 0.30..1.00.  RGB is
 *        already visibility-weighted; alpha is published for contact shaping,
 *        not for multiplying RGB a second time.
 *
 * WHY JAVASCRIPT IN A WORKER, NOT WASM.  VOLTMARCH's only compiled Wasm seam is
 * Meshopt's decoder, which is not a general compute runtime.  This pass is just
 * 4096 probes over arrays the worker already owns and produces one 64 KiB
 * transferable.  Introducing a second Wasm binary would add fetch/compile/
 * instantiation work to every boot and still need a JS/Wasm memory copy.  The
 * existing worker is the cheaper parallel boundary; a Wasm port only becomes
 * honest if this pass grows enough to dominate the terrain worker profile.
 * ============================================================================
 */

import { MAP_SIZE } from '../core/config';
import {
  IRRADIANCE_FIELD_CHANNELS,
  IRRADIANCE_FIELD_FLOATS,
  IRRADIANCE_FIELD_SIZE,
  type IrradianceFieldUpdate,
} from '../core/irradiance-field';
import { getBiome } from './Biomes';

export const IRRADIANCE_FIELD_WIDTH = IRRADIANCE_FIELD_SIZE;
export const IRRADIANCE_FIELD_HEIGHT = IRRADIANCE_FIELD_SIZE;
const IRRADIANCE_FIELD_VERSION = 1;

/** Renderer-facing shape. Extra key/timing fields are prewarm bookkeeping. */
export interface IrradianceFieldData extends IrradianceFieldUpdate {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Float32Array;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** Worker CPU time, never a render or simulation input. */
  readonly generateMs: number;
}

/** The terrain-owned arrays read while they are still resident in the worker. */
export interface IrradianceFieldInput {
  readonly terrainKey: string;
  readonly biome: string;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly surface: Uint8Array;
}

export function irradianceFieldKey(terrainKey: string): string {
  return `${terrainKey}|irradiance:${IRRADIANCE_FIELD_VERSION}`;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function parseLinearHex(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

function bilinear(field: Float32Array, stride: number, x: number, z: number): number {
  const last = stride - 1;
  const sx = x < 0 ? 0 : x > last ? last : x;
  const sz = z < 0 ? 0 : z > last ? last : z;
  const x0 = Math.min(last - 1, sx | 0);
  const z0 = Math.min(last - 1, sz | 0);
  const fx = sx - x0;
  const fz = sz - z0;
  const row0 = z0 * stride + x0;
  const row1 = row0 + stride;
  const top = field[row0] + (field[row0 + 1] - field[row0]) * fx;
  const bottom = field[row1] + (field[row1 + 1] - field[row1]) * fx;
  return top + (bottom - top) * fz;
}

/**
 * Generate the field synchronously. `runTerrainJob` is its production caller;
 * direct access exists so Node tests can gate determinism and fallback cost.
 */
export function generateIrradianceField(input: IrradianceFieldInput): IrradianceFieldData {
  const started = Date.now();
  const gridStride = Math.round(Math.sqrt(input.height.length));
  const surfaceStride = Math.round(Math.sqrt(input.surface.length));
  if (gridStride * gridStride !== input.height.length || input.slope.length !== input.height.length) {
    throw new Error('irradiance input height/slope grids are not matching squares');
  }
  if (surfaceStride * surfaceStride !== input.surface.length) {
    throw new Error('irradiance input surface grid is not square');
  }

  const palette = getBiome(input.biome).layers.map((layer) => parseLinearHex(layer.albedo));
  const rgba = new Float32Array(IRRADIANCE_FIELD_FLOATS);
  const gridLast = gridStride - 1;
  const texelMetres = MAP_SIZE / IRRADIANCE_FIELD_WIDTH;
  const samplesPerTexel = gridLast / IRRADIANCE_FIELD_WIDTH;
  const horizonRadii = [1, 2, 4, 8];
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
  ] as const;

  for (let z = 0; z < IRRADIANCE_FIELD_HEIGHT; z++) {
    for (let x = 0; x < IRRADIANCE_FIELD_WIDTH; x++) {
      // Probe centres, so border texels describe their whole 8 m footprint.
      const gx = (x + 0.5) * samplesPerTexel;
      const gz = (z + 0.5) * samplesPerTexel;
      const centre = bilinear(input.height, gridStride, gx, gz);

      let maxRise = 0;
      let surrounding = 0;
      let surroundingCount = 0;
      for (const [dx, dz] of directions) {
        for (const radius of horizonRadii) {
          const sample = bilinear(
            input.height, gridStride,
            gx + dx * radius * samplesPerTexel,
            gz + dz * radius * samplesPerTexel,
          );
          const rise = (sample - centre) / (radius * texelMetres);
          if (rise > maxRise) maxRise = rise;
          // The inner two rings carry broad cavity information without making
          // a distant mountain blacken a whole valley.
          if (radius <= 2) {
            surrounding += sample;
            surroundingCount++;
          }
        }
      }

      const horizon = Math.atan(maxRise);
      const broadCavity = Math.max(0, surrounding / surroundingCount - centre);
      const slopeAtProbe = bilinear(input.slope, gridStride, gx, gz);
      let visibility = 1 - clamp01(horizon / (Math.PI * 0.5)) * 0.72;
      visibility *= 1 - clamp01(broadCavity / 9) * 0.22;
      visibility *= 1 - clamp01(slopeAtProbe / 1.15) * 0.10;
      visibility = Math.max(0.30, Math.min(1, visibility));

      const sx = Math.min(surfaceStride - 1, ((x + 0.5) * surfaceStride
        / IRRADIANCE_FIELD_WIDTH) | 0);
      const sz = Math.min(surfaceStride - 1, ((z + 0.5) * surfaceStride
        / IRRADIANCE_FIELD_HEIGHT) | 0);
      const surfaceId = input.surface[sz * surfaceStride + sx];
      const ground = palette[surfaceId] ?? palette[0];

      // A restrained scene-linear lift.  Snow remains below 0.12 while dark
      // temperate grass still contributes a visible warm/olive bounce.
      const bounce = (0.14 + visibility * 0.075) * visibility;
      const skySpill = 0.006 * visibility;
      const o = (z * IRRADIANCE_FIELD_WIDTH + x) * 4;
      rgba[o] = Math.min(0.12, ground[0] * bounce + skySpill * 0.90);
      rgba[o + 1] = Math.min(0.12, ground[1] * bounce + skySpill);
      rgba[o + 2] = Math.min(0.12, ground[2] * bounce + skySpill * 1.18);
      rgba[o + 3] = visibility;
    }
  }

  return {
    key: irradianceFieldKey(input.terrainKey),
    width: IRRADIANCE_FIELD_WIDTH,
    height: IRRADIANCE_FIELD_HEIGHT,
    rgba,
    minX: 0,
    minZ: 0,
    maxX: MAP_SIZE,
    maxZ: MAP_SIZE,
    generateMs: Date.now() - started,
  };
}

export function irradianceFieldTransfers(data: IrradianceFieldData): ArrayBuffer[] {
  return data.rgba.buffer instanceof ArrayBuffer ? [data.rgba.buffer] : [];
}

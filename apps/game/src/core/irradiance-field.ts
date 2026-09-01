/** Renderer-neutral handoff for the map-aligned indirect-light field. */

export const IRRADIANCE_FIELD_SIZE = 64;
export const IRRADIANCE_FIELD_CHANNELS = 4;
export const IRRADIANCE_CONTEXT_ALPHA_BASE = 1;
export const IRRADIANCE_CONTEXT_ALPHA_MAX = 2;
export const IRRADIANCE_FIELD_FLOATS = (
  IRRADIANCE_FIELD_SIZE * IRRADIANCE_FIELD_SIZE * IRRADIANCE_FIELD_CHANNELS
);

/**
 * RGB is scene-linear, surface/biome-weighted outgoing diffuse radiance.
 * Alpha 0..1 is local sky visibility / broad occlusion metadata; RGB already
 * contains that attenuation and must not be multiplied by alpha again. The
 * retained WebGPU field may later encode a bounded semantic-emissive mask as
 * `1 + mask` in alpha without changing this shape or allocating a texture.
 */
export interface IrradianceFieldUpdate {
  readonly width: number;
  readonly height: number;
  readonly rgba: Float32Array;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * Fixed dimensions let the GPU owner allocate once before reveal and reject a
 * malformed worker reply instead of reallocating a texture during gameplay.
 */
export function validIrradianceField(field: IrradianceFieldUpdate): boolean {
  return field.width === IRRADIANCE_FIELD_SIZE
    && field.height === IRRADIANCE_FIELD_SIZE
    && field.rgba.length === IRRADIANCE_FIELD_FLOATS
    && Number.isFinite(field.minX)
    && Number.isFinite(field.minZ)
    && Number.isFinite(field.maxX)
    && Number.isFinite(field.maxZ)
    && field.maxX > field.minX
    && field.maxZ > field.minZ;
}

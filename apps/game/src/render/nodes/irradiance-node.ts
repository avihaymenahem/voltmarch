/**
 * World-space low-frequency indirect light for the WebGPU post graph.
 *
 * This is intentionally one fused expression, not another full-screen target.
 * The graph and 64x64 RGBA16F texture exist before the first presented frame;
 * worker results only copy into the retained backing store and mark it dirty.
 * That keeps field arrival from compiling a pipeline or reallocating a GPU
 * resource after reveal.
 *
 * The field's RGB is already outgoing diffuse radiance, not raw irradiance.
 * That distinction is what makes a post composite honest at the current seam:
 * the scene pass exposes lit beauty/depth/normals but no base-colour or
 * metalness G-buffer. Alpha is retained for future diagnostics and broad
 * occlusion work. Values above 1 encode a bounded local-emissive mask composed
 * into the same retained field after semantic structures exist; that component
 * is lifted at dusk/night without another texture sample, pass or draw.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NoColorSpace,
  RGBAFormat,
  Vector3,
  Vector4,
} from 'three/webgpu';
import type { Camera, Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  clamp,
  dot,
  float,
  getViewPosition,
  max,
  min,
  screenUV,
  smoothstep,
  step,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

import {
  IRRADIANCE_CONTEXT_ALPHA_MAX,
  IRRADIANCE_FIELD_FLOATS,
  IRRADIANCE_FIELD_SIZE,
  validIrradianceField,
  type IrradianceFieldUpdate,
} from '../../core/irradiance-field';

type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;
type Flt = Node<'float'>;

/** Worker output is clamped before conversion so malformed data cannot poison HDR. */
export const IRRADIANCE_MAX_RADIANCE = 0.16;
/** Alpha 0..1 remains visibility; 1..2 packs the local-emissive mask. */
export const IRRADIANCE_MAX_PACKED_ALPHA = IRRADIANCE_CONTEXT_ALPHA_MAX;

export interface IrradianceNodeUniforms {
  /** minX, minZ, reciprocal width, reciprocal depth. */
  readonly worldToUv: UniformNode<'vec4', Vector4>;
  /** Zero until the first valid field is adopted; no branch or graph rebuild. */
  readonly active: UniformNode<'float', number>;
  /** Live time-of-day response. Mutated without rebuilding the graph. */
  readonly moodGain: UniformNode<'float', number>;
  readonly moodTint: UniformNode<'vec3', Vector3>;
}

export interface IrradianceNodes {
  /** HDR composite, fused into the next existing post materialisation. */
  readonly node: Vec4;
  readonly texture: DataTexture;
  readonly uniforms: IrradianceNodeUniforms;
  /** Retained half-float upload storage; exposed read-only for lifecycle tests. */
  readonly uploadData: Uint16Array;
  /** True when a valid field was adopted. Invalid updates leave the last good field intact. */
  setField(field: IrradianceFieldUpdate | null): boolean;
  /** Mood the static field without rebaking it or allocating a replacement. */
  setMood(gain: number, red: number, green: number, blue: number): void;
  dispose(): void;
}

export interface CreateIrradianceNodesOptions {
  /** Scene-linear lit beauty. */
  input: Node<'vec4'>;
  /** Depth written by the scene pass (or the AO single-sample depth pass). */
  depthNode: TextureNode;
  camera: Camera;
  /** Existing reconstructed view normal, normally `AoNodes.normals`. */
  normalNode?: TextureNode | null;
}

function finiteClamp(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : lo;
}

/**
 * Convert the worker's Float32 contract into the filterable RGBA16F texture.
 *
 * WebGPU does not guarantee `float32-filterable`; using a Float32 DataTexture
 * would either need an optional device feature or four manual taps per pixel.
 * The field is low-frequency and bounded to 0.16, so half float is ample while
 * remaining linearly filterable on the required WebGPU baseline.
 */
export function copyIrradianceToHalf(
  source: Float32Array,
  destination: Uint16Array,
): void {
  if (source.length !== IRRADIANCE_FIELD_FLOATS || destination.length !== IRRADIANCE_FIELD_FLOATS) {
    throw new Error('irradiance upload buffers must be exactly 64x64 RGBA');
  }
  for (let i = 0; i < source.length; i += 4) {
    destination[i] = DataUtils.toHalfFloat(finiteClamp(source[i], 0, IRRADIANCE_MAX_RADIANCE));
    destination[i + 1] = DataUtils.toHalfFloat(finiteClamp(source[i + 1], 0, IRRADIANCE_MAX_RADIANCE));
    destination[i + 2] = DataUtils.toHalfFloat(finiteClamp(source[i + 2], 0, IRRADIANCE_MAX_RADIANCE));
    destination[i + 3] = DataUtils.toHalfFloat(
      finiteClamp(source[i + 3], 0, IRRADIANCE_MAX_PACKED_ALPHA),
    );
  }
}

function createFieldTexture(uploadData: Uint16Array): DataTexture {
  const field = new DataTexture(
    uploadData,
    IRRADIANCE_FIELD_SIZE,
    IRRADIANCE_FIELD_SIZE,
    RGBAFormat,
    HalfFloatType,
  );
  field.name = 'WorldIrradiance64';
  field.wrapS = ClampToEdgeWrapping;
  field.wrapT = ClampToEdgeWrapping;
  field.minFilter = LinearFilter;
  field.magFilter = LinearFilter;
  field.generateMipmaps = false;
  field.colorSpace = NoColorSpace;
  field.needsUpdate = true;
  return field;
}

export function createIrradianceNodes(options: CreateIrradianceNodesOptions): IrradianceNodes {
  const { input, depthNode, camera } = options;
  const uploadData = new Uint16Array(IRRADIANCE_FIELD_FLOATS);
  const neutralAlpha = DataUtils.toHalfFloat(1);
  for (let i = 3; i < uploadData.length; i += 4) uploadData[i] = neutralAlpha;
  const field = createFieldTexture(uploadData);
  const fieldSample = texture(field);
  const uniforms: IrradianceNodeUniforms = {
    worldToUv: uniform(new Vector4(0, 0, 1, 1)) as UniformNode<'vec4', Vector4>,
    active: uniform(0) as UniformNode<'float', number>,
    moodGain: uniform(1) as UniformNode<'float', number>,
    moodTint: uniform(new Vector3(1, 1, 1)) as UniformNode<'vec3', Vector3>,
  };

  // Three mutates these Matrix4 objects in place as the camera moves. Binding
  // the objects once avoids per-frame matrix copies and keeps camera pans from
  // invalidating or rebuilding anything in the field.
  const projectionInverse = uniform(camera.projectionMatrixInverse as Matrix4);
  const cameraWorld = uniform(camera.matrixWorld as Matrix4);
  const normalTexture = options.normalNode ?? null;

  const composite = Fn(() => {
    const uv = screenUV.toVar('irradianceScreenUv');
    const depth = depthNode.sample(uv).r.toVar('irradianceDepth');
    const geometry = float(1).sub(smoothstep(0.9992, 1.0, depth)).toVar('irradianceGeometry');
    /*
     * A cleared depth texel is exactly 1.0. Reconstructing that value through
     * an infinite-far perspective inverse can produce a zero homogeneous W,
     * and the resulting Inf/NaN survives multiplication by the zero geometry
     * mask (`NaN * 0` is still NaN). Keep the background finite before any
     * world-space arithmetic; `geometry` still makes it an exact visual no-op.
     */
    const reconstructionDepth = min(depth, 0.999999).toVar('irradianceSafeDepth');
    const view = getViewPosition(uv, reconstructionDepth, projectionInverse)
      .toVar('irradianceView');
    const world = cameraWorld.mul(vec4(view, 1.0)).xyz.toVar('irradianceWorld');
    const fieldUv = world.xz.sub(uniforms.worldToUv.xy)
      .mul(uniforms.worldToUv.zw)
      .toVar('irradianceFieldUv');
    const inside = step(0.0, fieldUv.x)
      .mul(step(fieldUv.x, 1.0))
      .mul(step(0.0, fieldUv.y))
      .mul(step(fieldUv.y, 1.0))
      .toVar('irradianceInside');
    const sample = fieldSample.sample(clamp(fieldUv, 0.0, 1.0)).toVar('irradianceSample');
    const localMask = clamp(sample.a.sub(1.0), 0.0, 1.0).toVar('irradianceLocalMask');

    /*
     * The cache represents radiance leaving nearby ground/context surfaces.
     * A downward face receives most of that hemisphere, a vertical wall still
     * receives useful bounce, and an upward terrain face receives only the
     * restrained wrapped tail. Reuse AO's normal reconstruction when it exists;
     * when AO is disabled the neutral 0.48 fallback keeps the field available
     * without paying for a replacement normal pass.
     */
    let facing: Flt = float(0.48);
    if (normalTexture !== null) {
      /*
       * Normal reconstruction legitimately clears to (0,0,0) outside scene
       * geometry. WGSL normalize(0) is undefined and can become NaN. Bloom
       * then spreads one poisoned texel through its mip chain until the whole
       * world is black. An epsilon-bounded reciprocal length maps that clear
       * value to zero and leaves real unit normals unchanged. cameraWorld's
       * w=0 transform is rotational, so a second normalize is unnecessary.
       */
      const rawViewNormal = normalTexture.sample(uv).rgb.toVar('irradianceRawViewNormal');
      const safeInvLength = max(dot(rawViewNormal, rawViewNormal), 1e-8)
        .inverseSqrt()
        .toVar('irradianceSafeNormalInvLength');
      const viewNormal = rawViewNormal.mul(safeInvLength).toVar('irradianceViewNormal');
      const worldNormal = cameraWorld.mul(vec4(viewNormal, 0.0)).xyz
        .toVar('irradianceWorldNormal');
      facing = clamp(float(0.54).sub(worldNormal.y.mul(0.40)), 0.14, 0.94);
    }

    const peak = max(input.r, max(input.g, input.b)).toVar('irradiancePeak');
    // Existing shroud black stays black, while HDR gameplay emissive keeps its
    // authored colour and bloom reach instead of receiving a pastel bounce.
    const shroudGuard = smoothstep(0.004, 0.028, peak);
    const emissiveGuard = float(1).sub(smoothstep(1.15, 2.65, peak));
    const weight = uniforms.active
      .mul(geometry)
      .mul(inside)
      .mul(facing)
      .mul(shroudGuard)
      .mul(emissiveGuard)
      .toVar('irradianceWeight');
    const fieldRadiance = min(sample.rgb, vec3(IRRADIANCE_MAX_RADIANCE))
      .toVar('irradianceFieldRadiance');
    const ambientBounce = fieldRadiance
      .mul(uniforms.moodTint)
      .mul(uniforms.moodGain)
      .toVar('irradianceAmbientBounce');
    // The existing mood gain is already the authoritative live day/night
    // scalar. Inverting it produces a restrained daytime floor and a strong
    // dusk/night lift without another public setter or per-frame allocation.
    const localGain = clamp(float(1.45).sub(uniforms.moodGain.mul(1.25)), 0.16, 1.25)
      .toVar('irradianceLocalGain');
    const localBounce = fieldRadiance.mul(localMask).mul(localGain)
      .toVar('irradianceLocalBounce');
    const bounced: Vec3 = ambientBounce.add(localBounce)
      .mul(weight)
      .toVar('irradianceBounce');
    return vec4(input.rgb.add(bounced), input.a);
  });

  return {
    node: composite() as unknown as Vec4,
    texture: field,
    uniforms,
    uploadData,
    setField(next: IrradianceFieldUpdate | null): boolean {
      if (next === null) {
        uniforms.active.value = 0;
        return true;
      }
      if (!validIrradianceField(next)) return false;
      copyIrradianceToHalf(next.rgba, uploadData);
      uniforms.worldToUv.value.set(
        next.minX,
        next.minZ,
        1 / (next.maxX - next.minX),
        1 / (next.maxZ - next.minZ),
      );
      uniforms.active.value = 1;
      // `Source` retains `uploadData`; needsUpdate uploads the mutated bytes and
      // increments the version without replacing Texture, Source or graph node.
      field.needsUpdate = true;
      return true;
    },
    setMood(gain: number, red: number, green: number, blue: number): void {
      uniforms.moodGain.value = finiteClamp(gain, 0, 1.25);
      uniforms.moodTint.value.set(
        finiteClamp(red, 0, 1.25),
        finiteClamp(green, 0, 1.25),
        finiteClamp(blue, 0, 1.25),
      );
    },
    dispose(): void {
      field.dispose();
    },
  };
}

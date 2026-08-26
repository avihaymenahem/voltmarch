/**
 * VOLTMARCH — experimental WebGPU screen-space global illumination.
 *
 * This is deliberately an opt-in experiment, not a quality-tier default. The
 * official Three SSGINode is expensive at the drawing-buffer resolution and
 * requires an optional WebGPU render-target feature. `post-nodes.ts` enables
 * it only for `?gi=ssgi` on a capable WebGPU device and otherwise keeps GTAO.
 *
 * The cost shape is kept close to the shipped GTAO path:
 *
 *   depth normals -> half-res SSGI march -> half-res GI denoise -> composite
 *
 * SSGI's AO attachment replaces GTAO; the two effects are never stacked. The
 * AO is spatially stable because temporal sampling is disabled, and the GI is
 * denoised with the same deterministic rotation texture used by GTAO.
 */

import { HalfFloatType, RGBAFormat } from 'three/webgpu';
import type { DepthTexture, Node, PerspectiveCamera, TextureNode } from 'three/webgpu';
import { float, mix, rtt, texture, uniform } from 'three/tsl';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

import type { AoConfig } from '../renderer';
import {
  normalFromDepthTexture,
  seedDenoiseNoise,
} from './ao-node';

type Flt = Node<'float'>;
type Vec3 = Node<'vec3'>;

type RttNode = TextureNode & {
  setResolutionScale(scale: number): void;
  readonly renderTarget: { texture: { name: string }; dispose(): void };
};

export type SsgiQuality = 'low' | 'medium' | 'high';

export interface SsgiPreset {
  readonly quality: SsgiQuality;
  readonly resolutionScale: number;
  readonly sliceCount: number;
  readonly stepCount: number;
  readonly radius: number;
  readonly thickness: number;
  readonly giIntensity: number;
}

const SSGI_PRESETS: Readonly<Record<SsgiQuality, SsgiPreset>> = {
  low: {
    quality: 'low',
    resolutionScale: 0.5,
    sliceCount: 2,
    stepCount: 6,
    radius: 12,
    thickness: 1.4,
    giIntensity: 4.0,
  },
  medium: {
    quality: 'medium',
    resolutionScale: 0.5,
    sliceCount: 3,
    stepCount: 8,
    radius: 14,
    thickness: 1.5,
    giIntensity: 5.0,
  },
  high: {
    quality: 'high',
    resolutionScale: 0.75,
    sliceCount: 4,
    stepCount: 12,
    radius: 16,
    thickness: 1.6,
    giIntensity: 6.0,
  },
};

/**
 * Read the development switch. `?gi=ssgi` deliberately means the conservative
 * low preset; the explicit values make A/B captures and timings reproducible.
 */
export function requestedSsgiPreset(search: string): SsgiPreset | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    .get('gi')
    ?.toLowerCase();
  if (raw === null || raw === undefined || raw === '' || raw === 'off') return null;
  if (raw === 'ssgi' || raw === 'low') return SSGI_PRESETS.low;
  if (raw === 'medium') return SSGI_PRESETS.medium;
  if (raw === 'high') return SSGI_PRESETS.high;
  return null;
}

/** Pure capability policy, kept outside the renderer so the refusal paths run in CI. */
export function capabilityGatedSsgiPreset(
  search: string,
  perspectiveCamera: boolean,
  rg11b10Renderable: boolean,
): SsgiPreset | null {
  if (!perspectiveCamera || !rg11b10Renderable) return null;
  return requestedSsgiPreset(search);
}

interface SsgiMarchNode {
  sliceCount: { value: number };
  stepCount: { value: number };
  aoIntensity: { value: number };
  giIntensity: { value: number };
  radius: { value: number };
  thickness: { value: number };
  useScreenSpaceSampling: { value: boolean };
  useLinearThickness: { value: boolean };
  backfaceLighting: { value: number };
  useTemporalFiltering: boolean;
  getAONode(): TextureNode;
  getGINode(): TextureNode;
  setSize(width: number, height: number): void;
  dispose(): void;
}

interface DenoiseNodeLike {
  lumaPhi: { value: number };
  depthPhi: { value: number };
  normalPhi: { value: number };
  radius: { value: number };
  noiseNode: unknown;
}

export interface CreateSsgiOptions {
  beautyNode: TextureNode;
  depthNode: Node;
  depthTexture: DepthTexture;
  camera: PerspectiveCamera;
  ao: AoConfig;
  preset: SsgiPreset;
}

export interface SsgiNodes {
  readonly preset: SsgiPreset;
  readonly normals: RttNode;
  readonly march: SsgiMarchNode;
  readonly denoisedGi: RttNode;
  occlusion(): Flt;
  indirect(): Vec3;
  applyAoConfig(cfg: AoConfig): void;
  dispose(): void;
}

export function createSsgiNodes(options: CreateSsgiOptions): SsgiNodes {
  const { beautyNode, depthNode, depthTexture, camera, preset } = options;
  const scale = preset.resolutionScale;

  const normals = normalFromDepthTexture(depthTexture, camera, scale);
  normals.renderTarget.texture.name = 'SsgiNormalFromDepth';

  const march = ssgi(beautyNode, depthNode, normals, camera) as unknown as SsgiMarchNode;
  march.useTemporalFiltering = false;
  march.sliceCount.value = preset.sliceCount;
  march.stepCount.value = preset.stepCount;
  march.radius.value = preset.radius;
  march.thickness.value = preset.thickness;
  march.giIntensity.value = preset.giIntensity;
  march.useScreenSpaceSampling.value = false;
  march.useLinearThickness.value = true;
  march.backfaceLighting.value = 0.08;

  /*
   * SSGINode is full-resolution by default and exposes a public setSize(), but
   * no resolutionScale. Its updateBefore() asks for the drawing-buffer size and
   * then calls that method. Scaling at this public seam keeps its projection
   * constants and both MRT attachments internally consistent without forking
   * the 700-line upstream shader.
   */
  const nativeSetSize = march.setSize.bind(march);
  march.setSize = (width: number, height: number): void => {
    nativeSetSize(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
  };

  /*
   * Denoise bounced RGB only. SSGI's AO is already a 32-bit horizon field
   * averaged over each slice; with temporal rotation disabled it is stable and
   * receives linear half-res upsampling. A second 16-tap denoise solely for AO
   * would make the experiment materially dearer than the GTAO it replaces.
   */
  const denoiseNode = denoise(march.getGINode(), depthNode, normals, camera);
  const denoiseLike = denoiseNode as unknown as DenoiseNodeLike;
  const noise = seedDenoiseNoise(denoiseLike);
  noise.name = 'SsgiDenoiseNoise';
  denoiseLike.noiseNode = texture(noise);
  denoiseLike.lumaPhi.value = 2.5;
  denoiseLike.depthPhi.value = 2.0;
  denoiseLike.normalPhi.value = 6.0;
  denoiseLike.radius.value = preset.quality === 'high' ? 4 : 5;

  const denoisedGi = rtt(denoiseNode, null, null, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  }) as unknown as RttNode;
  denoisedGi.setResolutionScale(scale);
  denoisedGi.renderTarget.texture.name = 'SsgiDenoisedGI';

  // The horizon field reaches farther than the shipped 1.6 m GTAO. Keep its
  // contact darkening subordinate to the new bounced-light information.
  const aoMix = uniform(options.ao.intensity * 0.72);

  const nodes: SsgiNodes = {
    preset,
    normals,
    march,
    denoisedGi,
    occlusion(): Flt {
      const raw = (march.getAONode() as unknown as { r: Flt }).r;
      return mix(float(1), raw, aoMix);
    },
    indirect(): Vec3 {
      return (denoisedGi as unknown as { rgb: Vec3 }).rgb;
    },
    applyAoConfig(cfg: AoConfig): void {
      aoMix.value = cfg.intensity * 0.72;
      march.aoIntensity.value = Math.max(0.45, cfg.power * 0.6);
    },
    dispose(): void {
      march.dispose();
      normals.renderTarget.dispose();
      denoisedGi.renderTarget.dispose();
    },
  };

  nodes.applyAoConfig(options.ao);
  return nodes;
}

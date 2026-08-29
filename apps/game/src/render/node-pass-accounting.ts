/** Exhaustive buckets for one node-renderer frame. */
export type NodeRenderPassBucket = 'shadow' | 'colour' | 'ao' | 'post';

const SHADOW_TARGET_NAMES = new Set([
  'ShadowMap',
  'PointShadowMap',
  'VSMVertical',
  'VSMHorizontal',
]);

const AO_TARGET_NAMES = new Set([
  'AoDepthPrepass',
  'AoNormalFromDepth',
  'GTAONode.AO',
  'AoDenoised',
]);

export interface NodeRenderTargetLike {
  texture?: { name?: string } | null;
}

/**
 * Classify a WebGPU render-object callback without depending on three/webgpu.
 *
 * Shadow geometry advertises itself through ClippingContext; VSM's two blur
 * quads are identified by three's named shadow targets. The node AO chain uses
 * four deliberately named targets, including the optional live-scene depth
 * prepass. Full-screen graph work uses an internal scene; the remaining
 * live-scene submission is the colour pass.
 */
export function classifyNodeRenderPass(
  object: { parent?: unknown },
  scene: { overrideMaterial?: unknown },
  liveScene: object,
  clippingContext: { shadowPass?: boolean } | null,
  renderTarget: NodeRenderTargetLike | null = null,
): NodeRenderPassBucket {
  const targetName = renderTarget?.texture?.name ?? '';
  const override = scene.overrideMaterial as { isShadowPassMaterial?: boolean } | null | undefined;
  if (
    clippingContext?.shadowPass === true
    || override?.isShadowPassMaterial === true
    || SHADOW_TARGET_NAMES.has(targetName)
  ) return 'shadow';
  if (AO_TARGET_NAMES.has(targetName)) return 'ao';
  // PassNode supplies reference wrappers for scene and camera, so neither has
  // stable identity. Render objects keep their real parent chain: gameplay
  // meshes end at liveScene, while graph-owned fullscreen triangles do not.
  let parent: unknown = object;
  while (parent !== null && typeof parent === 'object') {
    if (parent === liveScene) break;
    parent = (parent as { parent?: unknown }).parent ?? null;
  }
  if (parent !== liveScene) return 'post';
  if (scene.overrideMaterial != null) return 'ao';
  return 'colour';
}

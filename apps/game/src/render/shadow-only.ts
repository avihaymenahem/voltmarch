/**
 * Marks geometry that exists only to cast a cheaper shadow silhouette.
 *
 * It must remain visible to Three's scene traversal so the shadow renderer can
 * discover it, but submitting it to colour, AO or post passes is pure waste.
 * Both renderer backends consume this same tag at their last per-object seam.
 */
export const SHADOW_ONLY_TAG = 'vmShadowOnly';

/** Benchmark escape hatch; normal game sessions always keep the optimisation. */
const FILTER_ENABLED = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('shadowproxy') !== 'legacy';

export function isShadowOnlyObject(object: { userData?: Record<string, unknown> }): boolean {
  return object.userData?.[SHADOW_ONLY_TAG] === true;
}

export function shouldSkipShadowOnlyObject(
  object: { userData?: Record<string, unknown> },
  shadowPass: boolean,
): boolean {
  return FILTER_ENABLED && !shadowPass && isShadowOnlyObject(object);
}

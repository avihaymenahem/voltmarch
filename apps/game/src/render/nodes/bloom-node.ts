/**
 * VOLTMARCH — src/render/nodes/bloom-node.ts
 * =============================================================================
 * BLOOM AS A TSL NODE. Thin, because three's `BloomNode` is a faithful port of
 * `UnrealBloomPass` and the interesting part is what we hand it.
 *
 * VERIFIED FIELD BY FIELD against `UnrealBloomPass.js` in the same build of
 * three, because "it is the same effect" is exactly the kind of claim this
 * repository has learned not to take on trust:
 *
 *     nMips              5              5
 *     kernel sizes       6 10 14 18 22  6 10 14 18 22
 *     bloomFactors       1 .8 .6 .4 .2  1 .8 .6 .4 .2
 *     tint colours       white x5       white x5
 *     lerpBloomFactor    mix(f, 1.2-f, radius)         same
 *     first mip          half res       half res
 *     high pass          luminosityHighPass, smoothWidth 0.01   same
 *
 * `tests/post-nodes.spec.ts` pins the ones that are readable off the node.
 *
 * ── THE ONE STRUCTURAL DIFFERENCE: THE COMPOSITE IS OURS NOW ─────────────────
 * `UnrealBloomPass` ends by blending its mip composite ADDITIVELY over the read
 * buffer (`blending: AdditiveBlending`, `needsSwap = false`), so the pass emits
 * "scene + bloom". `BloomNode` returns the BLOOM ALONE as a texture node, and
 * the caller writes the `.add()`. `post-nodes.ts` does exactly that and nothing
 * else, so the arithmetic is identical — but a port that forgot the `.add()`
 * would show the bloom on black rather than failing, which is why it is called
 * out here and asserted there.
 *
 * ── THE ENERGY PAIR IS SETTLED. DO NOT RETUNE IT ─────────────────────────────
 * `threshold` 1.20 with an authored `strength` 0.42 was measured; the bible's
 * 1.05/0.55 pair was captured and cost **1.8 points of grade**. `radius` 0.34 is
 * the bible value and is kept for a different reason — it was a mip-weight
 * inversion, not an energy knob. See `BLOOM_NOON` in `core/config.ts`.
 *
 * The number the pass is actually handed is NOT `BloomConfig.strength`: it is
 * `effectiveBloomStrength(strength, emissiveBoost)`, shared with `post.ts`
 * through `grade-curve.ts` so the two chains cannot be given different energy
 * from the same config. `emissiveBoost` 1.6 is the identity point.
 */

import type { Node } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import type { BloomConfig } from '../renderer';
import { effectiveBloomStrength } from '../grade-curve';

/** The subset of `BloomNode` this module drives. All three are `UniformNode`s. */
export interface BloomNodeHandle {
  strength: { value: number };
  radius: { value: number };
  threshold: { value: number };
  dispose(): void;
}

export interface BloomNodes {
  readonly node: Node<'vec4'>;
  readonly handle: BloomNodeHandle;
  applyConfig(cfg: BloomConfig): void;
  dispose(): void;
}

/**
 * Build the bloom node over `input`.
 *
 * `input` is the AO-multiplied scene, NOT the raw scene: in the WebGL chain
 * bloom runs after AO and reads the buffer AO has already darkened, and
 * `PASS_ORDER` says why — an occluded crevice must not bloom. Passing the raw
 * scene here would be a silent order change.
 */
export function createBloomNodes(input: Node<'vec4'>, cfg: BloomConfig): BloomNodes {
  const node = bloom(
    input,
    effectiveBloomStrength(cfg.strength, cfg.emissiveBoost),
    cfg.radius,
    cfg.threshold,
  );
  const handle = node as unknown as BloomNodeHandle;

  const nodes: BloomNodes = {
    node: node as unknown as Node<'vec4'>,
    handle,
    applyConfig(next: BloomConfig): void {
      handle.threshold.value = next.threshold;
      handle.strength.value = effectiveBloomStrength(next.strength, next.emissiveBoost);
      handle.radius.value = next.radius;
      /*
       * NO `lensDirt`. `RA3_LOOK_BIBLE.md` §11 bans it by name, the field is
       * deleted from `BloomConfig`, and `tests/banned-effects.spec.ts` scans for
       * it so it cannot come back as a configured no-op. `BloomNode` has no dirt
       * uniform either, which is the same reason it never did anything on the
       * WebGL side.
       */
    },
    dispose(): void {
      handle.dispose();
    },
  };

  nodes.applyConfig(cfg);
  return nodes;
}

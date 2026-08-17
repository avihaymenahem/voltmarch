/**
 * ============================================================================
 * VOLTMARCH — src/render/dither-nodes.ts
 * ============================================================================
 * `material.dithering`, RE-IMPLEMENTED FOR THE NODE PATH.
 *
 * THE GAP, STATED ONCE. three implements dithering in its WebGL chunk system
 * and nowhere else: `dithering_pars_fragment.glsl.js` is its ONLY implementation
 * in the whole library, and no node in `src/nodes/` reads the flag. Set
 * `dithering: true` on a node material and it silently does nothing — no
 * warning, no error, an 8-bit-banded gradient where the WebGL build has a clean
 * one.
 *
 * WHY IT LIVES HERE RATHER THAN IN THE MATERIAL THAT FIRST NEEDED IT
 * -----------------------------------------------------------------
 * Stage C wrote this for `TerrainNodeMaterial` because the ground is 60-75% of
 * the frame and is where banding shows worst. Stage D found the SECOND material
 * that means the flag — `createUnitMaterial`, whose hulls are large, smooth,
 * single-hue and lit by one directional key, which is the other place a gradient
 * bands. A second transcription of three's algorithm is exactly the drift
 * `terrain-uniforms.ts` exists to prevent, so the algorithm was moved here and
 * both materials call it.
 *
 * It is three's own code, node for node: same `rand( vec2 )` from
 * `common.glsl.js`, same `+/-0.25/255` per-channel shift, same `mix` over the
 * grid position. The one substitution is `gl_FragCoord.xy` -> `screenCoordinate`,
 * which is the same quantity on both backends of the node path.
 *
 * WHERE TO CALL IT. From `setupOutput`, with `super` called FIRST — the GLSL
 * chunk order runs `<dithering_fragment>` after `<fog_fragment>` and after
 * `<premultiplied_alpha_fragment>`, and `super.setupOutput` is precisely those
 * two. Anything that must land BEFORE tone mapping (the shroud self-tint) goes
 * on the other side of the `super` call.
 * ============================================================================
 */

import type { Node } from 'three/webgpu';
import { Fn, dot, fract, mix, mod, screenCoordinate, vec2, vec3, vec4 } from 'three/tsl';

type Vec2N = Node<'vec2'>;
type Vec4N = Node<'vec4'>;

/**
 * three's `rand( vec2 )` from `common.glsl.js`.
 *
 * Deliberately NOT given a `.setLayout()`. It has exactly ONE call site in the
 * whole project, and `TSL_GAPS` #2 is about `Fn` inlining at EVERY call site —
 * which for one call site is what a function call would have cost anyway, minus
 * the call.
 */
const ditherRand = Fn(([uv]: [Vec2N]) => {
  const a = 12.9898;
  const b = 78.233;
  const c = 43758.5453;
  const dt = dot(uv.xy, vec2(a, b));
  const sn = mod(dt, 3.14);
  return fract(sn.sin().mul(c));
});

/**
 * Apply three's ordered output dither to a composed fragment colour.
 *
 * The `0.25 / 255` constant is the marker every spec in this repo greps for:
 * nothing else in any graph produces `0.0009803921568627451`, so its presence
 * or absence is a reliable answer to "did this material keep its dither".
 */
export function ditherOutput(out: Vec4N): Vec4N {
  const gridPosition = ditherRand(screenCoordinate.xy);
  const shift = vec3(0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0);
  const ditherShift = mix(shift.mul(2.0), shift.mul(-2.0), gridPosition);
  return vec4(out.rgb.add(ditherShift), out.a);
}

/** The literal the specs look for. Exported so nobody re-types it. */
export const DITHER_SHIFT_LITERAL = 0.25 / 255.0;

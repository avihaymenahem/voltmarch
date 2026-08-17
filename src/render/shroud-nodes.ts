/**
 * ============================================================================
 * VOLTMARCH — src/render/shroud-nodes.ts
 * ============================================================================
 * THE SHROUD SELF-TINT, AS A TSL NODE GRAPH. Stage D of
 * `docs/WEBGPU_MIGRATION_PLAN.md`.
 *
 * `./FogOfWar.ts`'s `applyShroudTint` is the shipping WebGL injection: five
 * uniforms, one `vShroudUv` varying derived from world XZ, and a tint applied to
 * `gl_FragColor.rgb` immediately before `<tonemapping_fragment>`. It is the most
 * REUSED injection in the project — six of the eleven surviving
 * `onBeforeCompile` sites are nothing but a call to it — so it is ported once,
 * here, rather than six times inside the materials that need it.
 *
 * WHY THIS FILE IS NOT "STAGE E, SHROUD"
 * --------------------------------------
 * Stage E owns the fog CARPET: `FogOfWar`'s own `ShaderMaterial`, the mesh
 * draped on the seabed, the warp and the ordered dither. None of that is here.
 * What is here is the per-material SELF-TINT that structures, units and props
 * each apply to themselves — a hard dependency of every Stage D material, and
 * unportable separately from them.
 *
 * ONE SOURCE OF TRUTH, PULLED RATHER THAN PUSHED
 * ----------------------------------------------
 * `shroudUniforms` in `FogOfWar.ts` is a module-level singleton of five
 * `{ value }` slots, written by `FogOfWar` and shared BY REFERENCE with every
 * GLSL material that opts in. Duplicating those five values for the node path
 * would be the drift `terrain-uniforms.ts` was created to prevent, so the TSL
 * uniforms MIRROR that singleton instead: each one carries an `onRenderUpdate`
 * that copies the live value across before the frame is drawn.
 *
 * That direction matters. A push (FogOfWar writing both) would need FogOfWar to
 * import `three/webgpu`, which would drag the whole node system into the WebGL
 * bundle — see the note at the foot of `TerrainNodeMaterial.ts`. A pull costs
 * five assignments a frame and leaves the shipping renderer untouched.
 *
 * THE ORDERING GUARANTEE, AND WHY THE UV IS NOT `positionWorld`
 * ------------------------------------------------------------
 * The GLSL derives `vShroudUv` from `transformed` at `<project_vertex>`, i.e.
 * AFTER the walk cycle and the wind sway have moved the vertex — a swaying tree
 * samples the fog where it actually is. TSL's `positionWorld` is the same
 * quantity, but it is a varying three inserts wherever it first sees a
 * reference, and this graph needs it to be read strictly after
 * `setupPosition` has finished moving `positionLocal`.
 *
 * So `shroudVertexUv` is called explicitly from each material's
 * `setupPosition`, after `super`, and writes a `varyingProperty` of its own.
 * That is the injection point spelled out rather than inferred, which is what
 * the GLSL comment on `applyShroudTint` asks for in the first place.
 * ============================================================================
 */

import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn, mix, modelWorldMatrix, positionLocal, smoothstep, texture, uniform, varyingProperty, vec4,
} from 'three/tsl';
import { SHROUD_UV_SCALE, shroudUniforms } from './FogOfWar';

type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE MIRRORED UNIFORMS
 * ========================================================================== */

/**
 * The five shroud uniforms as TSL nodes, each pulling from `shroudUniforms`.
 *
 * MODULE SCOPE AND SHARED BY EVERY NODE MATERIAL, exactly as the GLSL singleton
 * is shared by every GLSL material. Two copies would mean two `onRenderUpdate`
 * callbacks doing identical work and — far worse — a mask texture swap that
 * reached one material and not the other.
 *
 * `uFogMask` is constructed with the 1x1 clear mask that `FogOfWar.ts` builds at
 * module load, NOT with null: a `texture()` node reads its sampler type off the
 * value it was constructed with (see `TerrainNodeMaterial.TSL_GAPS` #4), and the
 * real 128x128 R8 `DataTexture` that replaces it later has the same shape.
 */
function mirroredUniforms() {
  const uFogMask = texture(shroudUniforms.uFogMask.value);
  const uFogTint = uniform(new THREE.Vector4().copy(shroudUniforms.uFogTint.value));
  const uFogDark = uniform(new THREE.Vector4().copy(shroudUniforms.uFogDark.value));
  const uFogParams = uniform(new THREE.Vector2().copy(shroudUniforms.uFogParams.value));
  const uFogAmount = uniform(0);

  /*
   * `onUpdate` REPLACES the node's `update` method and binds it to the node, so
   * the callback must ASSIGN rather than return. three's own accessors
   * (`Camera.js`) return a value instead, which works only because their
   * uniforms are read through a different path; assigning is unambiguous and
   * costs nothing.
   *
   * RENDER cadence, not FRAME: the shroud is drawn in the colour pass and in the
   * post chain's inputs, and a mask swapped mid-frame would tint one and not the
   * other. `NodeUpdateType.RENDER` fires once per render call, which is the
   * granularity the GLSL path gets for free from sharing the object.
   */
  uFogMask.onRenderUpdate(() => { uFogMask.value = shroudUniforms.uFogMask.value; });
  uFogTint.onRenderUpdate(() => { uFogTint.value.copy(shroudUniforms.uFogTint.value); });
  uFogDark.onRenderUpdate(() => { uFogDark.value.copy(shroudUniforms.uFogDark.value); });
  uFogParams.onRenderUpdate(() => { uFogParams.value.copy(shroudUniforms.uFogParams.value); });
  uFogAmount.onRenderUpdate(() => { uFogAmount.value = shroudUniforms.uFogAmount.value; });

  return { uFogMask, uFogTint, uFogDark, uFogParams, uFogAmount };
}

/** The one mirrored block. Read by every Stage D node material. */
export const shroudNodeUniforms = mirroredUniforms();

/* ==========================================================================
 * 2. THE VARYING
 * ========================================================================== */

/**
 * The interpolated shroud lookup, named to match the GLSL's `vShroudUv` so the
 * two shaders read side by side.
 */
export const shroudUv = varyingProperty('vec2', 'vShroudUv');

/**
 * Publish the shroud UV for this vertex. Call from `setupPosition`, AFTER
 * `super.setupPosition( builder )`.
 *
 * `positionLocal` at that point is post-morph, post-displacement and
 * post-instancing — the same thing `transformed` is at `<project_vertex>` once
 * three's own `instanceMatrix` multiply has run. `modelWorldMatrix` then lifts
 * it, which is redundant for the batched meshes (they are pinned at the origin)
 * and required for the non-instanced ones, exactly as the GLSL comment says.
 */
export function shroudVertexUv(): void {
  shroudUv.assign(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xz.mul(SHROUD_UV_SCALE));
}

/* ==========================================================================
 * 3. THE TINT
 * ========================================================================== */

/**
 * `SHROUD_TINT_FRAG`, node for node.
 *
 * Every `smoothstep` here is ASCENDING. The GLSL was already written as
 * `1.0 - smoothstep(lo, hi, v)` rather than as a reversed-edge smoothstep,
 * because GLSL leaves `edge0 >= edge1` undefined — and WGSL goes further and
 * makes it undefined behaviour outright (`TSL_GAPS` #3). So the shipping form
 * translates directly with nothing to rewrite, which is worth recording: the
 * defensive style paid for itself the first time anyone ported it.
 */
const shroudTintRgb = Fn(([rgb]: [Vec3N]) => {
  const U = shroudNodeUniforms;
  const v = U.uFogMask.sample(shroudUv).r.toVar('vmV');
  const remembered = smoothstep(0.0, U.uFogParams.y, v).oneMinus().toVar('vmRem');
  const fogged = smoothstep(U.uFogParams.y, 1.0, v).oneMinus().toVar('vmFog');
  const a = mix(U.uFogTint.w.mul(fogged), U.uFogDark.w, remembered).mul(U.uFogAmount);
  return mix(rgb, mix(U.uFogTint.xyz, U.uFogDark.xyz, remembered), a);
});

/*
 * NO `.setLayout()` — AND THAT IS NOT AN OVERSIGHT. It had one, and the WGSL it
 * generated would not link:
 *
 *     unresolved value 'nodeUniform1'
 *     nodeVar1 = textureDimensions( nodeUniform1, u32( 0 ) );
 *
 * A layout turns a TSL `Fn` into a REAL WGSL FUNCTION, and a WGSL function may
 * only see its declared parameters. This body reads five module-scope uniforms
 * and a varying, none of which is a parameter, so the emitted function referred
 * to names that do not exist in its scope. Without a layout the body is INLINED
 * at the call site, where all of them are in scope — which is exactly what the
 * GLSL injection did.
 *
 * `TSL_GAPS` #2 says to declare a layout on anything called more than once. That
 * advice is right and INCOMPLETE, and the missing half is this: a layout is only
 * available to a function whose inputs are ALL parameters. Terrain's `raHash21`
 * qualifies; nothing in Stage D does.
 *
 * The GLSL backend inlines either way, so this compiles on the WebGL2 fallback
 * regardless — which is why it survived the offline gate and had to be found in
 * a browser. See `StructureNodeMaterial.STAGE_D_TSL_GAPS` #6.
 */

/**
 * Apply the shroud self-tint to a composed fragment output.
 *
 * Call from `setupOutput` BEFORE `super.setupOutput`, which is where the GLSL
 * puts it: `<tonemapping_fragment>` — and therefore this, immediately above it —
 * runs before `<fog_fragment>` and `<premultiplied_alpha_fragment>`, and
 * `super.setupOutput` is exactly those two. Tone mapping itself is the
 * renderer's business on the node path and happens downstream of the material
 * either way, so the tint lands in the same scene-linear space the carpet
 * blends in.
 */
export function shroudTint(out: Vec4N): Vec4N {
  return vec4(shroudTintRgb(out.rgb), out.a);
}

/* ==========================================================================
 * 4. THE MIXIN
 *
 * Every Stage D material needs the same two calls at the same two points, and
 * three of them would otherwise copy the pair. TypeScript has no multiple
 * inheritance and `MeshPhysicalNodeMaterial` / `MeshStandardNodeMaterial` are
 * different bases, so this is written as the two functions above plus this
 * documented contract rather than as a class:
 *
 *   setupPosition( builder ) { const p = super.setupPosition( builder );
 *                              shroudVertexUv(); return p; }
 *   setupOutput( builder, out ) { return super.setupOutput( builder,
 *                                        shroudTint( out ) ); }
 *
 * A material that forgets the first and keeps the second compiles and renders
 * with an unwritten varying, which is a black or garbage tint rather than an
 * error — so `tests/stage-d-node-materials.spec.ts` asserts both markers are
 * present in the generated source of every material that claims the tint.
 * ========================================================================== */

/** Marker the spec greps for. Not read at runtime. */
export const SHROUD_NODE_VARYING = 'vShroudUv';

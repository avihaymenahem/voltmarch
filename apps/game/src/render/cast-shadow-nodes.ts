/**
 * ============================================================================
 * VOLTMARCH — src/render/cast-shadow-nodes.ts
 * ============================================================================
 * THE NODE PATH'S REPLACEMENT FOR `object.customDepthMaterial`.
 *
 * `StructureNodeMaterial.STAGE_D_TSL_GAPS` #1 is the entry and
 * `docs/RENDER_FINDINGS.md` §7e is the measurement. The short version:
 * `customDepthMaterial` is read in exactly one file in three 0.185 —
 * `WebGLShadowMap.js` — and the node renderer does not read it at all. It sets
 * `scene.overrideMaterial` to a shared depth material and harvests four fields
 * off the caster's own material (`Renderer._getShadowNodes`):
 *
 *     castShadowPositionNode ?? positionNode
 *     colorNode
 *     depthNode
 *     maskShadowNode ?? maskNode
 *
 * `setupPosition` is not one of them. Every model-space vertex displacement in
 * this project — the construction sink, the bay door, the radar spin, the walk
 * cycle, the wind sway — lives in a `setupPosition` override, so the shadow pass
 * never ran any of it and **a half-built structure cast its finished
 * silhouette**.
 *
 * ROUTE (b) IS CLOSED AND IT WAS CLOSED ON CORRECTNESS. `material.allowOverride
 * = false` draws the caster into the shadow map with its own material — and its
 * own material SAMPLES the shadow map that pass is writing, which WebGPU refuses
 * inside one synchronization scope. The device raises a `GPUValidationError`,
 * the command buffer is invalidated and the frame draws NOTHING. Measured, with
 * a fifth arm that removes the sampler to prove the diagnosis. Every caster in
 * this game receives shadows, so the flag is unusable. Do not retry it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES, AND WHY IT COSTS NOTHING ON THE CPU
 * ---------------------------------------------------------------------------
 * `NodeMaterial.setupPosition` runs, in this order:
 *
 *     morph -> skinning -> displacementMap -> batch( object )
 *          -> instancedMesh( object )            <- rewrites positionLocal
 *          -> positionLocal.assign( positionNode )
 *
 * So `castShadowPositionNode` is evaluated AFTER instancing and its value
 * REPLACES `positionLocal` outright. That last property is the whole trick: a
 * node that ignores the instanced value, resets `positionLocal` to
 * `positionGeometry`, runs the SAME model-space edit the colour pass runs, and
 * then re-applies three's own `instancedMesh( object )`, produces exactly the
 * position the colour pass produces. One expression, no new attribute, no new
 * uniform, **not one byte added to `InstanceBatcher` or `Scatter`**, and
 * therefore nothing at all added to the per-frame upload path or to the frame
 * loop's allocation budget.
 *
 * `builder.object` is how the second instancing reaches the right matrices.
 * A bare `Fn` receives the live `NodeBuilder`, and a `NodeBuilder` exists per
 * render object — `RenderObjects` keys its chain map on the object — so the
 * body below runs once per caster with that caster's mesh in hand. This is
 * precisely the mechanism three's own `setupPosition` uses two lines earlier.
 *
 * WHAT IT COSTS, STATED PLAINLY. The shadow pass evaluates the instance matrix
 * TWICE: once in three's `setupPosition` (whose result we discard) and once in
 * ours. That is one extra `mat4 * vec4` per shadow vertex and one extra binding
 * of a buffer that is already resident — the same `instanceMatrix` array, bound
 * a second time, never copied and never re-packed on the CPU. The alternative
 * measured against it was uploading a per-instance 3x3 basis so the displacement
 * could be rotated post-instancing, which costs 36 bytes an instance a frame
 * through the two hottest writers in the renderer. This costs zero there.
 *
 * THE ORDER OF THE THREE STATEMENTS IS LOAD-BEARING:
 *
 *  1. `positionLocal` and `normalLocal` are reset to the raw attributes. The
 *     edits below READ them, and at this point they hold the INSTANCED values —
 *     rotating an already-instanced position about the model X axis is the
 *     "soldier swings his legs sideways" failure `gait-nodes.ts` describes,
 *     arriving through the back door.
 *  2. The model-space edit runs. It is the same function the colour pass calls,
 *     never a transcription of it, which is what stops the two passes drifting —
 *     the exact defect `createStructureDepthMaterial` and `PropLibrary`'s
 *     `depthMaterial` have to be kept in step against by hand on the GLSL path.
 *  3. `instancedMesh( object )` re-applies the instance transform on top,
 *     exactly as `<project_vertex>` does for the colour pass.
 *
 * AND THE VARYINGS COME FOR FREE, which is not a side effect but half the fix.
 * `vRaClip` — the construction ground cut — is written by step 2 and read by
 * `maskNode`, which `_getShadowNodes` DOES harvest. Without step 2 that varying
 * is never assigned in the shadow vertex stage, the mask reads `0 >= 0`, nothing
 * discards, and the sunk structure's shadow is its finished silhouette even
 * though the colour pass got the cut right. Same for `vRaState`, which the
 * harvested `colorNode`'s alpha reads through the soot factor.
 * ============================================================================
 */

import type { InstancedMesh, Object3D } from 'three';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Fn, instancedMesh, normalGeometry, normalLocal, positionGeometry, positionLocal,
} from 'three/tsl';

type Vec3N = Node<'vec3'>;

/**
 * `NodeMaterial.setupPosition`'s OWN test for "did instancing run", made again.
 *
 * TRANSCRIBED RATHER THAN APPROXIMATED, and `instanceof` is deliberately not
 * used: three asks
 * `object.isInstancedMesh && object.instanceMatrix && object.instanceMatrix.isInstancedBufferAttribute`,
 * and the two predicates have to agree exactly. If ours ever said no where
 * three's said yes, the caster would be drawn in MODEL space — at the map origin,
 * in the shadow map only, with nothing thrown and nothing logged. `instanceof`
 * would also answer no if `three` and `three/webgpu` ever resolved to two copies
 * of the class, which is a bundler decision rather than a fact about the object.
 *
 * It has to be asked at all because one material is shared by every mesh that
 * uses it, and nothing promises they are all instanced.
 */
function instancedCaster(object: Object3D): InstancedMesh | null {
  const probe = object as Object3D & Partial<InstancedMesh>;
  if (probe.isInstancedMesh !== true) return null;
  if (probe.instanceMatrix?.isInstancedBufferAttribute !== true) return null;
  return probe as InstancedMesh;
}

/**
 * Build the `castShadowPositionNode` for a material whose colour pass does
 * `applyModelSpace()` inside `setupPosition` before calling `super`.
 *
 * PASS THE SAME FUNCTION THE COLOUR PASS CALLS. Handing this a copy of the edit
 * would reintroduce the two-copies-of-one-rule problem the node path is supposed
 * to have deleted; the point of the parameter is that there is exactly one
 * declaration of the displacement and both passes reach it.
 *
 * NO `.setLayout()`, and it could not have one: the bodies this is handed read
 * module-scope attributes, varyings and uniforms, and a real WGSL function may
 * see nothing but its declared parameters. That is `STAGE_D_TSL_GAPS` #6 and it
 * is the reason `tests/stage-d-node-materials.spec.ts` greps the generated WGSL
 * for a declared `fn` that names something outside its own parameter list.
 */
export function castShadowPosition(applyModelSpace: () => void): Vec3N {
  return Fn((builder: NodeBuilder) => {
    positionLocal.assign(positionGeometry);
    normalLocal.assign(normalGeometry);

    applyModelSpace();

    // A plain `Mesh` caster comes out of here in model space, which is exactly
    // where `modelViewProjection` expects it.
    const caster = instancedCaster(builder.object);
    if (caster !== null) instancedMesh(caster);

    return positionLocal;
  })();
}

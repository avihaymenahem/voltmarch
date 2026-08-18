/**
 * ============================================================================
 * VOLTMARCH — src/world/PropNodeMaterial.ts
 * ============================================================================
 * THE PROP MATERIAL, AS A TSL NODE GRAPH. Stage D of
 * the WebGPU migration.
 *
 * `PropLibrary.createPropMaterial` is the shipping WebGL pair — one
 * `MeshPhysicalMaterial` for the whole roster with four `onBeforeCompile`
 * injections, plus a `MeshDepthMaterial` carrying the identical wind so a
 * swaying canopy never casts a frozen shadow. This file is the node-path twin of
 * BOTH, and the second one is `castShadowPositionNode` rather than a second
 * material.
 *
 * This header said "there is no twin for the second and there cannot be one",
 * which was true of `customDepthMaterial` and false of the shadow pass. See
 * `render/cast-shadow-nodes.ts`; `StructureNodeMaterial.STAGE_D_TSL_GAPS` #1 is
 * the entry that was closed.
 *
 * THE FOUR INJECTIONS, AND WHERE EACH ONE LANDS HERE
 * --------------------------------------------------
 *   aSway  -> wind displacement            `setupPosition`, before `super`
 *   aGloss -> per-vertex ROUGHNESS ONLY    `roughnessNode`
 *   aEmit  -> additive emissive            `emissiveNode`
 *   shroud -> self-tint                    `setupPosition` + `setupOutput`
 *
 * `aGloss` is the whole surface-variation budget for props and it is worth
 * restating why it is roughness and nothing else: RA3 splits a parked car from
 * the hedge beside it with a specular highlight over flat paint, and a roughness
 * lerp is the entire cost of reproducing that out of ONE material and therefore
 * ONE draw call. Nothing here touches albedo or normals, so no amount of it can
 * become the per-pixel noise the texture rule bans.
 *
 * NO `customProgramCacheKey`, for the reason given in `UnitNodeMaterial.ts`.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Fn, attribute, cos, materialEmissive, materialRoughness, mix, positionLocal, sin, uniform,
  varyingProperty, vec3, vertexColor,
} from 'three/tsl';
import { PROP_EMISSIVE_GAIN, PROP_MATERIAL } from '../core/config';
import { PROP_GLOSS_ROUGHNESS } from './PropLibrary';
import { castShadowPosition } from '../render/cast-shadow-nodes';
import { ditherOutput } from '../render/dither-nodes';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from './prop-wind';

type FloatN = Node<'float'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE PHASE ATTRIBUTE, AND THE ONE THING THIS PORT COULD NOT CARRY OVER
 * ========================================================================== */

/**
 * THE HOLE STAGE D LEFT HERE IS CLOSED, AND THIS IS WHERE IT WAS.
 *
 * The GLSL reads the sway phase straight off the instance transform, and
 * `instanceMatrix` is not reachable from a shared node material — three builds
 * it inside `createInstanceMatrixNode` from the mesh it is given and never
 * surfaces it as an accessor, while ONE prop material is shared by every type in
 * the game and the mesh is not known until the draw. Stage D therefore shipped
 * this port reading an attribute nothing published: every prop took phase 0, the
 * whole forest swayed as one, and `attribute()` warned by name.
 *
 * It was left LOUD rather than papered over with `instanceIndex`, because a
 * plausible-looking phase from a different source would have rendered a forest
 * that looks fine and matches nothing — the kind of quiet falsehood
 * `docs/SPEC_DRIFT_AUDIT.md` exists to catalogue.
 *
 * `Scatter` publishes it now: one `InstancedBufferAttribute`, read back out of
 * the matrix it just composed so the two paths cannot disagree, repacked on the
 * same chunk flip as the matrix and the colour. The name and the full argument
 * live in `./prop-wind.ts` beside the coefficients, because `Scatter` is in the
 * main bundle and must never import `three/webgpu`.
 */
export { PROP_WIND_PHASE_ATTRIBUTE } from './prop-wind';

const aSwayPhase = attribute<'float'>(PROP_WIND_PHASE_ATTRIBUTE, 'float');
/** Per-vertex wind amplitude in metres. Zero on a trunk, largest at the tip. */
const aSway = attribute<'float'>('aSway', 'float');
/** Per-vertex additive emissive mask: lamp heads, signal lenses. */
const aEmit = attribute<'float'>('aEmit', 'float');
/** Per-vertex roughness lerp: 0 is the matte default, 1 is wet lacquer. */
const aGloss = attribute<'float'>('aGloss', 'float');

const vEmit = varyingProperty('float', 'vEmit');
const vGloss = varyingProperty('float', 'vGloss');

/* ==========================================================================
 * 2. THE UNIFORMS
 * ========================================================================== */

/** The wind clock. Advanced once per frame by the scatter system, via `setTime`. */
function createUniforms() {
  return {
    uWindTime: uniform(0),
    uWindFreq: uniform(PROP_WIND.radiansPerSecond),
    uEmitGain: uniform(PROP_EMISSIVE_GAIN),
    uGlossRough: uniform(PROP_GLOSS_ROUGHNESS),
  };
}

export type PropNodeUniforms = ReturnType<typeof createUniforms>;

/* ==========================================================================
 * 3. THE WIND
 * ========================================================================== */

/**
 * `WIND_BODY`, node for node.
 *
 * MODEL SPACE, BEFORE INSTANCING, exactly as the GLSL's `<begin_vertex>` edit
 * is. That matters more here than anywhere else in Stage D: props are placed
 * with a random yaw, so the offset the GLSL adds is rotated per tree by the
 * instance matrix afterwards. Applied post-instancing instead — which is where
 * `material.positionNode` would land it — every tree in the forest would lean
 * the same way, and it would look deliberate.
 */
const windOffset = Fn(([time, freq]: [FloatN, FloatN]) => {
  const W = PROP_WIND;
  const phase = aSwayPhase.toVar('swayPhase');
  const w = time.mul(freq).add(phase).toVar('w');
  // Two harmonics so the motion never reads as one clean sine.
  const sx = sin(w).mul(W.harmonicA)
    .add(sin(w.mul(W.xRateB).add(phase.mul(W.xPhaseB))).mul(W.harmonicB));
  const sz = cos(w.mul(W.zRateA).add(phase.mul(W.zPhaseA))).mul(W.harmonicA)
    .add(cos(w.mul(W.zRateB)).mul(W.harmonicB));
  return vec3(sx.mul(aSway), 0.0, sz.mul(aSway).mul(W.zAmplitude));
});
/* NO LAYOUT: the body reads `aSwayPhase` and `aSway`, both attributes, and a
 * WGSL function may only see its parameters — the emitted function failed to
 * link with `unresolved value 'aSwayPhase'`. `render/shroud-nodes.ts` carries
 * the finding; `STAGE_D_TSL_GAPS` #6 is the entry. */

/**
 * THE MODEL-SPACE HALF OF THE VERTEX STAGE, AS ONE FUNCTION WITH TWO CALLERS.
 *
 * Split out of `setupPosition` so the shadow pass can run the identical edit —
 * `render/cast-shadow-nodes.ts` is handed this function, never a copy of it. The
 * GLSL path needs the same rule expressed twice (once in `createPropMaterial`'s
 * `onBeforeCompile`, once in the `MeshDepthMaterial` beside it) and keeping the
 * two in step is a manual obligation; here there is one declaration.
 *
 * `vEmit` and `vGloss` ride along because they are assigned in the same place on
 * the colour path. Neither is read by the shadow pass, and assigning an unread
 * varying costs a dead store the backend removes.
 */
function applyPropVertex(uniforms: PropNodeUniforms): void {
  positionLocal.addAssign(windOffset(uniforms.uWindTime, uniforms.uWindFreq));
  vEmit.assign(aEmit);
  vGloss.assign(aGloss);
}

/* ==========================================================================
 * 4. THE MATERIAL
 * ========================================================================== */

class PropStandardNodeMaterial extends MeshPhysicalNodeMaterial {
  constructor(readonly uniforms: PropNodeUniforms) {
    super();
  }

  override setupPosition(builder: NodeBuilder): Vec3N {
    applyPropVertex(this.uniforms);
    const position = super.setupPosition(builder) as Vec3N;
    /*
     * Scatter instances these as TALL, depth-writing meshes standing on the
     * terrain, and the shroud carpet is depth tested — without the self-tint a
     * forest inside never-explored black would stay fully lit. The UV is taken
     * AFTER the wind, so a swaying tree samples the fog where it actually is.
     */
    shroudVertexUv();
    return position;
  }

  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    const out = super.setupOutput(builder, shroudTint(outputNode)) as Vec4N;
    return this.dithering === true ? ditherOutput(out) : out;
  }
}

export interface PropNodeMaterialSet {
  readonly material: MeshPhysicalNodeMaterial;
  readonly uniforms: PropNodeUniforms;
  /** Advance the wind clock. Called once per frame by the scatter system. */
  setTime(t: number): void;
  dispose(): void;
}

/**
 * THE NODE-PATH TWIN OF `createPropMaterial`.
 *
 * Foliage gets only a whisper of clearcoat: bible §5.4 reserves the 0.30 coat
 * for painted armour, and a waxy leaf reads as plastic. `envMapIntensity` is
 * never 0 — zeroing it kills the silhouette rim that scorecard #23 checks. Both
 * numbers come from `PROP_MATERIAL` in `config.ts`, which is also what the GLSL
 * material reads, so neither can move on one renderer alone.
 */
export function createPropNodeMaterials(): PropNodeMaterialSet {
  const uniforms = createUniforms();
  const material = new PropStandardNodeMaterial(uniforms);
  material.name = 'PropNodeMaterial';
  material.color = new THREE.Color(0xffffff);
  material.vertexColors = true;
  material.roughness = PROP_MATERIAL.roughness;
  material.metalness = PROP_MATERIAL.metalness;
  material.clearcoat = PROP_MATERIAL.clearcoat;
  material.clearcoatRoughness = PROP_MATERIAL.clearcoatRoughness;
  material.envMapIntensity = PROP_MATERIAL.envMapIntensity;
  material.emissive = new THREE.Color(0x000000);

  /*
   * A LERP, so `vGloss = 0` leaves the matte default bit-for-bit untouched. The
   * GLSL injects this straight after `<roughnessmap_fragment>` and before the
   * value reaches the BRDF; `roughnessNode` is the same point expressed the node
   * way. `materialRoughness` is the scalar-times-map three would otherwise have
   * used, so the starting value is identical.
   */
  material.roughnessNode = mix(materialRoughness, uniforms.uGlossRough, vGloss);

  /*
   * ADDITIVE, and tinted by the prop's own vertex colour — so a lamp head and a
   * signal lens glow without a second material and therefore without a second
   * draw call. `materialEmissive` is zero here (the material's emissive is
   * black and there is no emissive map), which is exactly the GLSL's
   * `totalEmissiveRadiance` at the point the injection lands.
   */
  material.emissiveNode = materialEmissive
    .add(vertexColor().rgb.mul(vEmit).mul(uniforms.uEmitGain));

  /*
   * THE NODE-PATH TWIN OF `createPropMaterial`'s SECOND MATERIAL, which this
   * file's header said could not exist. It can: `castShadowPositionNode` is
   * harvested onto the shadow pass's override material and is applied AFTER
   * `instancedMesh( object )`, so an expression that resets `positionLocal`,
   * runs the wind and re-instances lands the swaying tip in the shadow map with
   * no `customDepthMaterial` and no extra upload. `render/cast-shadow-nodes.ts`
   * carries the whole mechanism.
   */
  material.castShadowPositionNode = castShadowPosition(() => applyPropVertex(uniforms));

  return {
    material,
    uniforms,
    setTime(t: number): void { uniforms.uWindTime.value = t; },
    dispose(): void { material.dispose(); },
  };
}

/** Convenience for the spec and for anything that only wants the material. */
export function createPropNodeMaterial(): MeshPhysicalNodeMaterial {
  return createPropNodeMaterials().material;
}

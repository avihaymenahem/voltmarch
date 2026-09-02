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
 *   aSurface.y -> per-vertex ROUGHNESS ONLY `roughnessNode`
 *   aSurface.x -> additive emissive         `emissiveNode`
 *   shroud -> self-tint                    `setupPosition` + `setupOutput`
 *
 * `aSurface.y` is the whole surface-variation budget for props and it is worth
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
  Fn, attribute, batch, clamp, cos, float, fract, instancedMesh, materialColor, materialEmissive,
  materialRoughness, min, mix, normalGeometry, normalLocal, normalWorld, positionGeometry,
  positionLocal, sin, smoothstep, step, texture, uniform, varyingProperty, vec3, vec4, vertexColor,
} from 'three/tsl';
import { PROP_EMISSIVE_GAIN, PROP_LIGHT_ANIM, PROP_MATERIAL } from '../core/config';
import { PROP_GLOSS_ROUGHNESS } from './PropLibrary';
import { ditherOutput } from '../render/dither-nodes';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from './prop-wind';
import { surfaceClimateNode } from './surface-environment-nodes';

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
/** Packed per-vertex masks: x emissive, y roughness/gloss. */
const aSurface = attribute<'vec2'>('aSurface', 'vec2');

const vEmit = varyingProperty('float', 'vEmit');
const vGloss = varyingProperty('float', 'vGloss');
/** Shared per-instance clock phase for faulty lamps and traffic signals. */
const vLifePhase = varyingProperty('float', 'vLifePhase');
/** Three's BatchedMesh vertex setup publishes its RGBA instance colour here. */
const vBatchColor = varyingProperty('vec4', 'vBatchColor');

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
const windOffset = Fn(([time, freq, phaseIn]: [FloatN, FloatN, FloatN]) => {
  const W = PROP_WIND;
  const phase = phaseIn.toVar('swayPhase');
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
function applyPropVertex(uniforms: PropNodeUniforms, phase: FloatN = aSwayPhase): void {
  positionLocal.addAssign(windOffset(uniforms.uWindTime, uniforms.uWindFreq, phase));
  vEmit.assign(aSurface.x);
  vGloss.assign(aSurface.y);
  vLifePhase.assign(phase);
}

/**
 * Decode the sparse animated fixture bands carried above the old 0..1 mask.
 * Regular emissives are bit-for-bit unchanged; only codes 2..5 enter here.
 */
const propLifeGain = Fn(([time, phase, code]: [FloatN, FloatN, FloatN]) => {
  const A = PROP_LIGHT_ANIM;
  const band = (value: number): FloatN => step(value - 0.5, code).mul(step(code, value + 0.5));

  const faultRoll = fract(sin(phase.mul(A.faultHashFrequency)).mul(A.faultHashScale));
  const faulty = band(A.faultCapableCode).mul(step(1 - A.faultyFraction, faultRoll));
  const fast = step(A.flickerFastThreshold,
    sin(time.mul(A.flickerFastRadians).add(phase.mul(A.flickerFastPhase))));
  const slow = step(A.flickerSlowThreshold,
    sin(time.mul(A.flickerSlowRadians).add(phase.mul(A.flickerSlowPhase))));
  const brokenGain = fast.mul(slow).mul(1 - A.faultyFloor).add(A.faultyFloor);
  const lampGain = mix(1.0, brokenGain, faulty);

  const cycle = fract(time.div(A.signalCycleSeconds).add(fract(phase.mul(0.0795775))));
  const redOn = step(cycle, A.signalRedEnd);
  const amberOn = step(A.signalRedEnd, cycle).mul(step(cycle, A.signalAmberEnd))
    .add(step(A.signalGreenEnd, cycle));
  const greenOn = step(A.signalAmberEnd, cycle).mul(step(cycle, A.signalGreenEnd));
  const redBand = band(A.signalRedCode);
  const amberBand = band(A.signalAmberCode);
  const greenBand = band(A.signalGreenCode);
  const isSignal = clamp(redBand.add(amberBand).add(greenBand), 0.0, 1.0);
  const signalOn = clamp(redBand.mul(redOn).add(amberBand.mul(amberOn))
    .add(greenBand.mul(greenOn)), 0.0, 1.0);
  const signalGain = mix(1.0, mix(A.signalIdleGain, 1.0, signalOn), isSignal);

  return min(code, 1.0).mul(lampGain).mul(signalGain);
});

function isBatched(builder: NodeBuilder): builder is NodeBuilder & { object: THREE.BatchedMesh } {
  return (builder.object as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh === true;
}

/**
 * Shadow twin for both scatter layouts.
 *
 * InstancedMesh keeps the original model-space path. BatchedMesh has already
 * packed each prop's transform and RGB jitter into textures, so its wind phase
 * rides in the otherwise-unused alpha channel and the displacement is applied
 * after Three's batch transform in both colour and shadow passes.
 */
function propShadowPosition(uniforms: PropNodeUniforms): Vec3N {
  return Fn((builder: NodeBuilder) => {
    positionLocal.assign(positionGeometry);
    normalLocal.assign(normalGeometry);

    if (isBatched(builder)) {
      batch(builder.object);
      applyPropVertex(uniforms, vBatchColor.a);
    } else {
      applyPropVertex(uniforms);
      const object = builder.object as THREE.Object3D & Partial<THREE.InstancedMesh>;
      if (object.isInstancedMesh === true &&
          object.instanceMatrix?.isInstancedBufferAttribute === true) {
        instancedMesh(object as THREE.InstancedMesh);
      }
    }

    return positionLocal;
  })();
}

/* ==========================================================================
 * 4. THE MATERIAL
 * ========================================================================== */

class PropStandardNodeMaterial extends MeshPhysicalNodeMaterial {
  constructor(readonly uniforms: PropNodeUniforms) {
    super();
  }

  override setupPosition(builder: NodeBuilder): Vec3N {
    if (isBatched(builder)) {
      const position = super.setupPosition(builder) as Vec3N;
      applyPropVertex(this.uniforms, vBatchColor.a);
      shroudVertexUv();
      return position;
    }

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

/** Shared zero-allocation climate layer for procedural and authored props. */
function applyPropSurfaceEnvironment(
  material: MeshPhysicalNodeMaterial,
  authoredRoughness: FloatN,
  porous: FloatN,
  authoredAlpha: FloatN = float(1.0),
): void {
  const up = clamp(normalWorld.y, 0.0, 1.0).toVar('raPropSurfaceUp');
  const wet = clamp(surfaceClimateNode.x, 0.0, 1.0).toVar('raPropWet');
  const dust = clamp(surfaceClimateNode.y, 0.0, 1.0)
    .mul(up.mul(up))
    .mul(porous)
    .mul(wet.mul(0.86).oneMinus())
    .toVar('raPropDust');
  const snow = clamp(surfaceClimateNode.z, 0.0, 1.0)
    .mul(smoothstep(0.52, 0.9, up))
    .toVar('raPropSnow');
  // `materialColor` is the authored RGB map multiplied by the material colour.
  // Its public TSL type is vec3, so alpha-tested families pass their coverage
  // separately below instead of relying on a vec4 widening to preserve it.
  const authoredColor = vec4(materialColor as unknown as Vec4N)
    .toVar('raPropAuthoredColor');
  const dusty = mix(authoredColor.rgb, vec3(0.43, 0.37, 0.27), dust.mul(0.16));
  const snowed = mix(dusty, vec3(0.80, 0.84, 0.86), snow.mul(0.24));
  // Climate owns RGB only. Authored foliage keeps coverage in the base-map
  // alpha channel; replacing it with 1.0 turns every crossed leaf card into an
  // opaque black rectangle even though alphaTest itself is still configured.
  material.colorNode = vec4(
    snowed.mul(wet.mul(0.055).oneMinus()),
    authoredAlpha,
  );
  material.roughnessNode = clamp(
    authoredRoughness
      .sub(wet.mul(porous.mul(0.07).add(0.14)))
      .add(dust.mul(0.12))
      .add(snow.mul(0.14)),
    0.16,
    1.0,
  );
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
  const authoredRoughness = mix(materialRoughness, uniforms.uGlossRough, vGloss);

  /*
   * One climate response covers the procedural and authored environment
   * catalogue. It stays broad and low-frequency: upward orientation is the
   * accumulation mask, rain mostly changes the BRDF, and no noise or unique
   * material is introduced per prop. Gloss-painted street props retain more
   * of their authored colour than porous vegetation and debris.
   */
  const porous = vGloss.mul(0.72).oneMinus().toVar('raPropPorous');
  applyPropSurfaceEnvironment(material, authoredRoughness, porous);

  /*
   * ADDITIVE, and tinted by the prop's own vertex colour — so a lamp head and a
   * signal lens glow without a second material and therefore without a second
   * draw call. `materialEmissive` is zero here (the material's emissive is
   * black and there is no emissive map), which is exactly the GLSL's
   * `totalEmissiveRadiance` at the point the injection lands.
   */
  material.emissiveNode = materialEmissive
    .add(vertexColor().rgb
      .mul(propLifeGain(uniforms.uWindTime, vLifePhase, vEmit))
      .mul(uniforms.uEmitGain));

  /*
   * THE NODE-PATH TWIN OF `createPropMaterial`'s SECOND MATERIAL, which this
   * file's header said could not exist. It can: `castShadowPositionNode` is
   * harvested onto the shadow pass's override material and is applied AFTER
   * `instancedMesh( object )`, so an expression that resets `positionLocal`,
   * runs the wind and re-instances lands the swaying tip in the shadow map with
   * no `customDepthMaterial` and no extra upload. `render/cast-shadow-nodes.ts`
   * carries the whole mechanism.
   */
  material.castShadowPositionNode = propShadowPosition(uniforms);

  return {
    material,
    uniforms,
    setTime(t: number): void { uniforms.uWindTime.value = t; },
    dispose(): void { material.dispose(); },
  };
}

/** Authored PBR surface with the same model-space wind and shroud contract. */
export function createEnvironmentPropNodeMaterials(
  params: THREE.MeshStandardMaterialParameters,
): PropNodeMaterialSet {
  const uniforms = createUniforms();
  const material = new PropStandardNodeMaterial(uniforms);
  material.setValues(params);
  // Authored PBR maps remain the starting point. Unlike the procedural packed
  // gloss channel, imported aSurface.y is a runtime-layout placeholder and is
  // not a material classifier, so use the stock mapped roughness directly.
  // `materialColor` is deliberately RGB-only in Three's TSL API. Alpha-tested
  // foliage stores its cutout in the base map's A channel, so feed that channel
  // explicitly into the colour node; otherwise WebGPU renders each crossed
  // branch card's transparent atlas padding as an opaque rectangle.
  const authoredAlpha = params.alphaTest !== undefined && params.alphaTest > 0
    && params.map?.isTexture === true
    ? texture(params.map).a
    : float(1.0);
  applyPropSurfaceEnvironment(material, materialRoughness, float(0.72), authoredAlpha);
  material.castShadowPositionNode = propShadowPosition(uniforms);
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

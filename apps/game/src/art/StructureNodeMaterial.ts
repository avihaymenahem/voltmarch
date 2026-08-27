/**
 * ============================================================================
 * VOLTMARCH — src/art/StructureNodeMaterial.ts
 * ============================================================================
 * THE STRUCTURE ANIMATION SHADER, AS A TSL NODE GRAPH. Stage D of
 * the WebGPU migration.
 *
 * `BuildingFactory.applyStructureShader` is the shipping WebGL injection —
 * construction rise, bay doors, radar sweep, damage soot, interior fire, build
 * band, selection pulse, all off per-instance `aState` and per-vertex
 * `aFeature`, so an animated base is still one draw call per part and zero CPU.
 * This file is that same shader for the node path, block for block, and the two
 * are meant to be read side by side.
 *
 * A STRUCTURE MATERIAL IS A UNIT MATERIAL. That is true on the GLSL path
 * literally — `createStructureMaterial` calls `createUnitMaterial` and overrides
 * three coat properties — and it is true here through `configureUnitNodeBase`.
 * What it cannot share is the CLASS: structures have no walk cycle and units
 * have no radar dish, and both edits land in `setupPosition`.
 *
 * EVERY NUMBER COMES FROM `./structure-anim.ts`, which both shaders read. None
 * is typed out twice.
 *
 * ---------------------------------------------------------------------------
 * READ `STAGE_D_TSL_GAPS` AT THE FOOT OF THIS FILE BEFORE WIRING ANY OF THIS UP.
 * Its first entry was migration-blocking — **the node path has no
 * `customDepthMaterial`**, so `createStructureDepthMaterial` and `PropLibrary`'s
 * `depthMaterial` have no twin and the shadow pass could not see a vertex
 * displacement that has to happen before instancing. It is CLOSED:
 * `mat.castShadowPositionNode` below, `render/cast-shadow-nodes.ts` for the
 * mechanism. The entry is kept in full because the route that does not work is
 * one line and looks obviously right.
 * ---------------------------------------------------------------------------
 */

import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Fn, attribute, clamp, float, materialClearcoat, materialColor, materialEmissive,
  max, mix, normalLocal, positionLocal, select, sin, smoothstep, step, texture,
  uniform, uv, varyingProperty, vec3, vec4,
} from 'three/tsl';
import { castShadowPosition } from '../render/cast-shadow-nodes';
import { ditherOutput } from '../render/dither-nodes';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import { STRUCTURE_ANIM, STRUCTURE_ANIM_LINEAR, STRUCTURE_FEATURE } from './structure-anim';
import { STRUCTURE_COATS, buildingTime, defaultCoat, type StructureCoat } from './BuildingFactory';
import { configureUnitNodeBase } from './UnitNodeMaterial';
import { assertUnitMaterialRuling } from './UnitFactory';
import type { GreebleAtlas } from './Greeble';
import { structureRim } from './structure-rim-nodes';

type FloatN = Node<'float'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE CLOCK
 * ========================================================================== */

/**
 * `uTime`, mirroring `BuildingFactory.buildingTime`.
 *
 * Pull, not push, for the reason spelled out in `render/shroud-nodes.ts`:
 * `BuildingFactory` is in the main bundle and must never import `three/webgpu`,
 * or every WebGL player downloads the whole node system for a renderer they
 * will not run. `buildings.system.ts` goes on writing the one clock it always
 * has and this node reads across.
 *
 * FRAME cadence rather than RENDER: the door phase and the burn flicker must be
 * the same number in the colour pass and the shadow pass, or a bay door casts a
 * shadow from a different moment than the one it is drawn at.
 */
const uTime = uniform(0);
uTime.onFrameUpdate(() => { uTime.value = buildingTime.value; });

/* ==========================================================================
 * 2. THE ATTRIBUTES AND THE VARYINGS
 * ========================================================================== */

/** Per instance, from `InstanceBatcher`: (hpFrac, buildProgress, selected, seed). */
const aState = attribute<'vec4'>('aState', 'vec4');
/** Per vertex, from `MeshAcc.toGeometry`: (code, riseHeight, animParam, phase). */
const aFeature = attribute<'vec4'>('aFeature', 'vec4');
/** Per instance, LINEAR rgb. */
const aTeamColor = attribute<'vec3'>('aTeamColor', 'vec3');

/**
 * The ground cut, published from the vertex stage. Named to match the GLSL.
 *
 * Model-space Y after the sink and the door, EXCEPT for a pad, which is pinned
 * at 1.0 because its skirt sits below the origin on purpose and clipping it
 * would delete the thing every other structure is standing on.
 */
const vRaClip = varyingProperty('float', 'vRaClip');
/** `aState`, interpolated. Flat in practice — it is a per-instance channel. */
const vRaState = varyingProperty('vec4', 'vRaState');
/** `aTeamColor`, interpolated. Same. */
const vRaTeam = varyingProperty('vec3', 'vRaTeam');

/* ==========================================================================
 * 3. THE VERTEX SOLVE — `STRUCTURE_ANIM_SOLVE` + `STRUCTURE_ANIM_APPLY`
 * ========================================================================== */

interface Solved {
  spinC: FloatN;
  spinS: FloatN;
  /** Sink plus door, in metres of model space, both downward. */
  drop: FloatN;
  /** Healthy mechanical travel, in metres of model space, upward-positive. */
  lift: FloatN;
}

/**
 * Solve sink / door / spin for this vertex.
 *
 * `step( lo, code ) * step( code, hi )` is the GLSL's way of asking "is the code
 * in this band", and it is kept rather than rewritten as a comparison: the two
 * are identical in value, and a band test written twice in two different idioms
 * is a diff nobody can read.
 *
 * THE DOOR'S CLOSING EDGE IS THE ONE LINE THAT COULD NOT BE TRANSCRIBED. The
 * GLSL is `smoothstep( 0.4400, 0.3000, ph )` — a DESCENDING smoothstep, which
 * GLSL leaves unspecified and WGSL makes undefined outright. It is written here
 * as the ascending form inverted, which is exactly equal because
 * S(1-t) === 1-S(t) for 3t^2-2t^3. That is `TerrainNodeMaterial.TSL_GAPS` #3,
 * hit for the second time in the second shader anyone ported.
 */
function solve(): Solved {
  const S = STRUCTURE_ANIM;
  const code = aFeature.x.toVar('code');
  const bp = clamp(aState.y, 0.0, 1.0).toVar('bp');

  // A pad never rises; everything else sinks by its own model height.
  const rises = float(1.0).sub(
    step(STRUCTURE_FEATURE.pad - 0.5, code).mul(step(code, STRUCTURE_FEATURE.pad + 0.5)),
  );
  const sink = bp.oneMinus().mul(aFeature.y).mul(rises);

  // Bay door: retracts DOWNWARD into the floor, where the same ground cut that
  // hides an unbuilt structure hides the leaf for free.
  const isDoor = step(STRUCTURE_FEATURE.door - 0.5, code)
    .mul(step(code, STRUCTURE_FEATURE.door + 0.5));
  const ph = uTime.div(S.doorPeriodSeconds).add(aState.w).fract().toVar('ph');
  const open = smoothstep(0.0, S.doorRampFraction, ph)
    .mul(smoothstep(S.doorOpenFraction, S.doorCloseFraction, ph).oneMinus());
  const door = isDoor.mul(aFeature.z).mul(open);

  // Radar sweep: about the model Y axis, so a dish is authored on the centre
  // line. RA3's dome is a dish on a central tower; this is that.
  const isSpin = step(STRUCTURE_FEATURE.spin - 0.5, code)
    .mul(step(code, STRUCTURE_FEATURE.spin + 0.5));
  const ang = uTime.mul(aFeature.z).mul(isSpin).toVar('ang');

  const isPiston = step(STRUCTURE_FEATURE.piston - 0.5, code)
    .mul(step(code, STRUCTURE_FEATURE.piston + 0.5));
  const lift = sin(uTime.mul(S.pistonRadians).add(aFeature.w.mul(6.28318)))
    .mul(aFeature.z).mul(isPiston);

  return {
    spinC: ang.cos().toVar('raSpinC'),
    spinS: ang.sin().toVar('raSpinS'),
    drop: sink.add(door).toVar('raDrop'),
    lift: lift.toVar('raLift'),
  };
}

/**
 * Move `positionLocal` and `normalLocal`, and publish the ground cut.
 *
 * CALL FROM `setupPosition`, BEFORE `super`. The GLSL edits `transformed` at
 * `<begin_vertex>` and `objectNormal` at `<beginnormal_vertex>`, both of which
 * are MODEL space — three does not apply `instanceMatrix` until
 * `<project_vertex>`. `material.positionNode` runs after `instancedMesh( object )`
 * and would spin the dish about a world axis through the world origin, which is
 * not a subtle difference. `render/gait-nodes.ts` carries the full argument.
 *
 * The GLSL's `mat2( c, s, -s, c )` is COLUMN-major: its columns are `(c, s)` and
 * `(-s, c)`, so the map is `(x, z) -> (c*x - s*z, s*x + c*z)`. Written out here
 * because a transposed rotation spins the dish backwards and nothing catches it.
 */
function applyStructureVertex(): void {
  const { spinC, spinS, drop, lift } = solve();

  const x = positionLocal.x.toVar('raPx');
  const z = positionLocal.z.toVar('raPz');
  positionLocal.assign(vec3(
    spinC.mul(x).sub(spinS.mul(z)),
    positionLocal.y.add(lift).sub(drop),
    spinS.mul(x).add(spinC.mul(z)),
  ));

  const nx = normalLocal.x.toVar('raNx');
  const nz = normalLocal.z.toVar('raNz');
  normalLocal.assign(vec3(
    spinC.mul(nx).sub(spinS.mul(nz)),
    normalLocal.y,
    spinS.mul(nx).add(spinC.mul(nz)),
  ));

  // A static pad is never clipped; everything else is cut at the ground plane.
  const isPad = aFeature.x.sub(STRUCTURE_FEATURE.pad).abs().lessThan(0.5);
  vRaClip.assign(select(isPad, float(1.0), positionLocal.y));
  vRaState.assign(aState);
  vRaTeam.assign(aTeamColor);
}

/* ==========================================================================
 * 4. THE FRAGMENT — `<map_fragment>` and `<emissivemap_fragment>`
 * ========================================================================== */

/**
 * DAMAGE. Bible 8.8: a hurt structure soots, it does not recolour.
 *
 * The GLSL injects this immediately after `<map_fragment>`, i.e. after the atlas
 * multiply and BEFORE `<color_fragment>` folds in the vertex colours. `colorNode`
 * is applied before the vertex-colour multiply instead — which is the same
 * result, because the soot is `mix( c, c * k, d )` and therefore a scalar
 * multiply, and scalar multiplies commute. Said out loud because "it is a lerp,
 * so the order does not matter" is only true while it stays a lerp.
 */
const sootFactor = Fn(() => {
  const S = STRUCTURE_ANIM;
  const hp = clamp(vRaState.x, 0.0, 1.0);
  const dmg = smoothstep(S.damageOnsetLo, S.damageOnset, hp).oneMinus();
  return mix(float(1.0), float(S.sootMultiplier), dmg);
});
/* NO LAYOUT: the body reads `vRaState`, a module-scope varying, and a WGSL
 * function may only see its parameters. `render/shroud-nodes.ts` carries the
 * full finding; `STAGE_D_TSL_GAPS` #6 is the entry. */

/**
 * INTERIOR FIRE, THE BUILD BAND AND THE SELECTION PULSE.
 *
 * `base` is `materialEmissive` — `emissive * emissiveIntensity * emissiveMap`,
 * which is exactly what `totalEmissiveRadiance` holds at `<emissivemap_fragment>`
 * on the GLSL path. The emissive map is already zero everywhere except the
 * window plates, so it doubles as the window mask and no extra UV varying is
 * needed; that is the trick this block rests on and it survives the port intact.
 */
const structureEmissive = Fn(([base]: [Vec3N]) => {
  const S = STRUCTURE_ANIM;
  const hp = clamp(vRaState.x, 0.0, 1.0);
  const bp = clamp(vRaState.y, 0.0, 1.0);

  const win = clamp(max(base.r, max(base.g, base.b)).mul(S.burnMaskGain), 0.0, 1.0);
  const burn = smoothstep(S.burnOnsetLo, S.burnOnset, hp).oneMinus().mul(win);
  const flick = float(S.burnFlickerBase).add(
    sin(uTime.mul(S.burnFlickerRadians).add(vRaState.w.mul(S.burnFlickerSeedScale)))
      .mul(S.burnFlickerAmp),
  );
  const burnColor = vec3(...STRUCTURE_ANIM_LINEAR.burnColor);
  const out = mix(base, burnColor.mul(flick.mul(S.burnEmissiveGain)), burn).toVar('raEmissive');

  // THE BUILD BAND. A bright scan line riding the ground cut while the
  // structure rises, so construction reads at a glance.
  const band = smoothstep(0.0, S.riseBandMeters, vRaClip).oneMinus().mul(bp.oneMinus());
  out.addAssign(vec3(...STRUCTURE_ANIM_LINEAR.riseBandColor).mul(band).mul(S.riseBandGain));

  // SELECTION. Team colour, pulsed. Readability comes from accents, never from
  // raising the exposure (bible R5).
  const pulse = float(S.selectPulseBase)
    .add(sin(uTime.mul(S.selectPulseRadians)).mul(S.selectPulseAmp));
  out.addAssign(vRaTeam.mul(clamp(vRaState.z, 0.0, 1.0)).mul(S.selectEmissive).mul(pulse));

  return out;
});
/* NO LAYOUT: reads `vRaState`, `vRaTeam`, `vRaClip` and `uTime`, none of which
 * is a parameter. See `STAGE_D_TSL_GAPS` #6. */

/* ==========================================================================
 * 5. THE MATERIAL
 * ========================================================================== */

class StructureStandardNodeMaterial extends MeshPhysicalNodeMaterial {
  constructor(private readonly silhouetteRim: boolean) { super(); }

  override setupPosition(builder: NodeBuilder): Vec3N {
    applyStructureVertex();
    const position = super.setupPosition(builder) as Vec3N;
    shroudVertexUv();
    return position;
  }

  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    const lit = this.silhouetteRim ? structureRim(outputNode) : outputNode;
    const out = super.setupOutput(builder, shroudTint(lit)) as Vec4N;
    return this.dithering === true ? ditherOutput(out) : out;
  }
}

/**
 * THE NODE-PATH TWIN OF `createStructureMaterial`.
 *
 * THE GROUND CUT IS A `maskNode`, AND THAT IS THE ONE PLACE THIS PORT IS BETTER
 * THAN WHAT IT REPLACES. On the GLSL path the `if ( vRaClip < 0.0 ) discard;` is
 * injected at `<clipping_planes_fragment>` in the colour program AND, separately,
 * in `createStructureDepthMaterial`'s depth program, because three substitutes
 * its own material for the shadow map and the colour material's injection never
 * runs there. Two copies of one rule.
 *
 * `NodeMaterial.setupDiffuseColor` applies `maskNode` at the top of the fragment
 * program, which is the same place; and `Renderer._getShadowNodes` harvests
 * `maskShadowNode || maskNode` onto the shadow pass's override material. So the
 * discard reaches both passes from one declaration and cannot drift.
 *
 * THE MASK ALONE WAS NOT ENOUGH, and that is worth knowing before reading the line that fixes it as
 * redundant. `vRaClip` is WRITTEN by `applyStructureVertex`, which the shadow pass never ran, so the
 * mask compared a varying nothing had assigned: `0 >= 0`, nothing discarded, finished silhouette.
 * The RULE reached both passes from one declaration; the VALUE it tests did not.
 * `castShadowPositionNode` carries both — see `STAGE_D_TSL_GAPS` #1.
 */
export function createStructureNodeMaterial(
  atlas: GreebleAtlas, name: string, coat?: StructureCoat, silhouetteRim = true,
): MeshPhysicalNodeMaterial {
  const mat = new StructureStandardNodeMaterial(silhouetteRim);
  mat.name = name;
  configureUnitNodeBase(mat, atlas);

  const c = STRUCTURE_COATS[coat ?? defaultCoat(atlas)];
  mat.clearcoat = c.clearcoat;
  mat.clearcoatRoughness = c.clearcoatRoughness;
  mat.envMapIntensity = c.envMapIntensity;
  // GLSL multiplies the same ORM alpha into PhysicalMaterial.clearcoat after
  // the stock material setup. `materialClearcoat` is that stock scalar on the
  // node path; overriding the node preserves one procedural class mask across
  // both backends without another atlas texture.
  mat.clearcoatNode = materialClearcoat.mul(texture(atlas.ormMap, uv()).a);

  /*
   * `materialColor` is `color * map` — exactly what `diffuseColor` holds when
   * the GLSL's soot injection runs, immediately after `<map_fragment>`.
   */
  /*
   * A SCALAR, NOT A COLOUR MIX, AND THE TYPES ARE THE REASON.
   *
   * The GLSL soots with `mix( c, c * 0.44, dmg )`, which is `c * mix( 1, 0.44,
   * dmg )` — a scalar multiply wearing a lerp's clothes. Writing it as the
   * scalar is not a tidy-up: `materialColor` is `color * map` and is therefore a
   * **vec4** at runtime while `@types/three` declares it vec3, so a
   * vec3-in/vec3-out helper wrapped back up as `vec4( ..., 1.0 )` handed
   * `vec4()` five components and three said so at runtime and nowhere else:
   *
   *     THREE.TSL: Length of parameters exceeds maximum length of function 'vec4()'
   *
   * Multiplying by a float is correct for three or four components alike, and it
   * also settles the ordering question the GLSL raises — the injection lands
   * after `<map_fragment>` and before `<color_fragment>` folds in the vertex
   * colours, whereas `colorNode` is applied before both. Scalar multiplies
  * commute, so the two agree. That is only true while it stays a scalar.
  */
  mat.colorNode = materialColor.mul(sootFactor());
  mat.emissiveNode = structureEmissive(materialEmissive);
  mat.maskNode = vRaClip.greaterThanEqual(0.0);
  /*
   * AND THE OTHER HALF OF THE GROUND CUT, WHICH THE MASK ALONE NEVER GAVE US.
   * `maskNode` reaches the shadow pass; the varying it tests did not, because
   * `vRaClip` is written by `applyStructureVertex` and the shadow pass never
   * calls our `setupPosition`. So the mask compared an unassigned varying, no
   * fragment discarded, and a structure at `buildProgress` 0.3 cast the
   * silhouette of a finished one. `render/cast-shadow-nodes.ts` carries the
  * mechanism; it runs the SAME function, so the sink, the door, the spin and
  * the cut cannot drift between the two passes.
  */
  mat.castShadowPositionNode = castShadowPosition(applyStructureVertex);

  assertUnitMaterialRuling(mat, 'node');
  return mat;
}

/**
 * Foundation pads. Bible 5.4's "Terrain / ground" class: roughness 0.88, env
 * 0.35, NO clearcoat. The ORM map still drives per-pixel roughness, so the
 * scalar stays 1.0.
 *
 * `assertUnitMaterialRuling` is deliberately NOT called: a pad's clearcoat is 0
 * by design and RULING #3 is a statement about ARMOUR. The GLSL twin
 * (`createPadMaterial`) gets away with it only because it runs the assertions
 * inside `createUnitMaterial`, before it zeroes the coat — which is an accident
 * of ordering rather than a decision, and is worth not reproducing.
 */
export function createPadNodeMaterial(
  atlas: GreebleAtlas, name: string,
): MeshPhysicalNodeMaterial {
  const mat = createStructureNodeMaterial(atlas, name, undefined, false);
  mat.clearcoat = 0;
  mat.clearcoatRoughness = 1;
  mat.envMapIntensity = 0.35;
  return mat;
}

/* ==========================================================================
 * 6. WHAT TSL COULD NOT EXPRESS IN STAGE D, AND WHAT IT COSTS
 *
 * Written down here rather than discovered again by whoever does Stage E or the
 * Stage F cutover. `TerrainNodeMaterial.TSL_GAPS` is the Stage C list and every
 * entry on it held; these are the ones terrain could not have found, because
 * terrain is a single non-instanced mesh that casts no shadow.
 *
 * **ENTRY 1 WAS MIGRATION-BLOCKING AND IS NOW CLOSED**, by a material and
 * nothing else. It is kept in full because the route that does NOT work is one
 * line, looks obviously right, and would be re-tried within an afternoon of
 * anyone rediscovering the gap.
 * ========================================================================== */

export const STAGE_D_TSL_GAPS: readonly string[] = [
  /*
   * 1. THERE IS NO `customDepthMaterial` ON THE NODE PATH. THAT WAS
   *    MIGRATION-BLOCKING; `castShadowPositionNode` CLOSES IT, AND UPLOADS
   *    NOTHING TO DO SO.
   *
   *    `object.customDepthMaterial` is read in exactly one file in three 0.185:
   *    `src/renderers/webgl/WebGLShadowMap.js`. The node path renders shadows by
   *    setting `scene.overrideMaterial` to a shared depth-only `NodeMaterial`
   *    (`ShadowFilterNode.getShadowMaterial`) and harvesting FOUR fields off the
   *    object's own material — `castShadowPositionNode ?? positionNode`,
   *    `colorNode`, `depthNode`, `maskShadowNode ?? maskNode`
   *    (`Renderer._getShadowNodes`).
   *
   *    `maskNode` is why the construction ground cut survives: one declaration,
   *    both passes. `positionNode` is why the vertex half did not. Every
   *    displacement in this stage — the construction sink, the bay door, the
   *    radar spin, the walk cycle, the wind sway — happens in MODEL space,
   *    before `instancedMesh( object )` rewrites `positionLocal`; the only hook
   *    that early is `setupPosition`, and the shadow pass never calls ours.
   *
   *    So on the node path a half-built structure cast its FINISHED silhouette
   *    — the exact defect `createStructureDepthMaterial` was written to fix —
   *    and a swaying canopy cast a frozen shadow. Worse than a mismatch at
   *    `buildProgress` 0.30: the structures are ENTIRELY below the cut, so the
   *    frame showed three hard black slabs thrown by objects that are not there.
   *
   *    ROUTE (b) IS NOT "EXPENSIVE BUT CORRECT". IT IS INVALID. MEASURED.
   *    ------------------------------------------------------------------
   *    (b) was `material.allowOverride = false`, which makes
   *    `Renderer.renderObject` skip the override and draw the object into the
   *    shadow map with its own material — and therefore its own `setupPosition`.
   *    It was measured, by `tools/shadow-override-probe.mjs`, on real WebGPU in
   *    real Chrome, and it does not work:
   *
   *        arm                        backend    devErrs   darker vs reference
   *        glsl-webgl (reference)     webgl            0   —
   *        glsl-webgl-nodepth         webgl            0   3.040%   <- the defect
   *        tsl-override               webgpu           0   3.040%   <- same defect
   *        tsl-nooverride             webgpu           2   89.312%  <- BLANK FRAME
   *        tsl-nooverride-noreceive   webgpu           0   0.470%   <- correct
   *        tsl-castshadow             webgpu           0   0.460%   <- THE FIX
   *
   *        ! tsl-nooverride: GPUValidationError: [Texture "ShadowDepthTexture"]
   *          usage (TextureBinding|RenderAttachment) includes writable usage and
   *          another usage in the same synchronization scope.
   *
   *    THE CAUSE, and it is structural rather than a three bug. A lit material
   *    that RECEIVES shadows samples the shadow map. Drawn into the shadow pass
   *    with `allowOverride = false`, it samples the very texture that pass is
   *    writing — which WebGPU forbids in one synchronization scope. The
   *    validation error invalidates the whole command buffer, so the frame draws
   *    NOTHING; the 89% above is a blank canvas, not a shader difference.
   *
   *    The fifth arm is the proof of that diagnosis rather than of a fix: with
   *    `receiveShadow = false` on the casters the sampler disappears, the frame
   *    is valid, and the shadow is CORRECT. So the flag genuinely does reach
   *    `setupPosition`. It is simply unusable, because every caster in this game
   *    receives shadows and a building that cannot be shadowed by the building
   *    beside it is not a rendering the look bible would accept. DO NOT RETRY IT.
   *
   *    ROUTE (a) IS THE ONE, AND IT IS CHEAPER THAN THIS ENTRY BELIEVED TWICE.
   *    ----------------------------------------------------------------------
   *    `render/cast-shadow-nodes.ts` is thirty lines and it is called from
   *    `createStructureNodeMaterial` and `createPropNodeMaterials` with the SAME
   *    function that material's `setupPosition` calls, so every displacement has
   *    exactly one declaration.
   *
   *    THE SENTENCE THAT WAS WRONG, because it is the reusable part: this entry
   *    said the DISPLACEMENT still needs a per-instance upload, "because a
   *    model-space offset must be rotated and scaled by the instance basis
   *    before it can be added to an instanced position". True of the offset,
   *    false of the conclusion — the expression does not have to ADD to the
   *    instanced position. `setupPosition` does
   *    `positionLocal.assign( subBuild( this.positionNode, ... ) )`: it REPLACES.
   *    So the expression discards the instanced value, resets `positionLocal` to
   *    `positionGeometry`, runs the edit in model space where it belongs, and
   *    calls three's own `instancedMesh( builder.object )` — reaching the
   *    instance matrix through the builder rather than through an upload.
   *    `InstanceBatcher` and `Scatter` are untouched.
   *
   *    WHAT IT COSTS. One extra mat4 in the shadow vertex stage, because
   *    `instancedMesh` now runs twice there: four more attribute slots where the
   *    matrices arrive interleaved, or a second uniform buffer over the same
   *    array where they arrive as a uniform buffer. A second BINDING of a
   *    resident buffer, never a second copy, and nothing on the CPU.
   *    `tests/stage-d-node-materials.spec.ts` section 3b pins the ordering, the
   *    varying, and that attribute count against the guaranteed 16.
   *
   *    THE UNIT MATERIAL IS DELIBERATELY LEFT OUT. `createUnitMaterial` has no
   *    `customDepthMaterial`, so infantry shadows are the rest pose on the
   *    shipping renderer too; see the block in `UnitNodeMaterial.ts`.
   */
  'no customDepthMaterial on the node path; allowOverride=false is a WebGPU validation error; '
  + 'CLOSED by castShadowPositionNode re-running the model-space edit and re-instancing',
  /*
   * 2. `material.positionNode` IS APPLIED AFTER INSTANCING, `<begin_vertex>` IS
   *    APPLIED BEFORE IT. `NodeMaterial.setupPosition` runs morph, skinning,
   *    displacement map, `batch( object )` and `instancedMesh( object )` and only
   *    THEN assigns `positionNode`. Anything ported from a `<begin_vertex>`
   *    injection is in the wrong space there, and every symptom is a plausible
   *    picture rather than an error: legs swinging sideways, a dish orbiting the
   *    map origin, a whole forest leaning the same way. Override `setupPosition`.
   */
  'positionNode runs AFTER instancedMesh(); <begin_vertex> runs before it — override setupPosition',
  /*
   * 3. A DESCENDING `smoothstep` IS UNDEFINED IN WGSL. Already Stage C's #3, and
   *    it recurred immediately: the bay door's closing edge is
   *    `smoothstep( 0.4400, 0.3000, ph )`. Assume every GLSL shader in this
   *    project contains one and grep before porting rather than after.
   */
  'smoothstep with edge0 > edge1 is undefined in WGSL; invert the ascending form',
  /*
   * 4. `material.dithering` REACHES NOTHING, still. Stage C found it on terrain;
   *    `createUnitMaterial` is the second material that sets it and means it, and
   *    structures inherit the flag from that constructor. The implementation now
   *    lives in `render/dither-nodes.ts` so there is one copy rather than two.
   */
  'material.dithering: no node implementation; shared re-implementation in render/dither-nodes.ts',
  /*
   * 5. NOT A GAP, BUT THE THING MOST WORTH KNOWING. `maskNode` is harvested by
   *    the shadow pass, so a fragment discard written once is correct in both
   *    passes. On the GLSL path that same rule is two injections in two
   *    materials, and they have to be kept in step by hand.
   */
  'maskNode reaches BOTH passes; the GLSL needed the discard injected twice',
  /*
   * 6. `.setLayout()` IS ONLY LEGAL ON A FUNCTION WHOSE INPUTS ARE ALL
   *    PARAMETERS — AND THE OFFLINE GATE CANNOT SEE THE VIOLATION.
   *
   *    Stage C's #2 says a bare `Fn` inlines at every call site and a layout
   *    makes it a real callable. Both true. What it does not say is that a REAL
   *    WGSL FUNCTION can see nothing but its declared parameters, so a body that
   *    reads a module-scope attribute, varying or uniform emits a function
   *    referring to names that are not in its scope. Four of Stage D's five
   *    helpers did, and Chrome refused all of them:
   *
   *        unresolved value 'aSwayPhase'    (the prop wind)
   *        unresolved value 'vRaState'      (the structure soot)
   *        unresolved value 'nodeUniform1'  (the shroud's mask sampler)
   *
   *    THE PART THAT MATTERS FOR EVERY REMAINING STAGE: none of that failed the
   *    offline builder. `WGSLNodeBuilder.build()` GENERATES the module; it does
   *    not compile it, and nothing in Node does. So "the graph builds on both
   *    backends" is a real gate and a WEAKER one than it reads — and the GLSL
   *    backend inlines regardless, so the WebGL2 arm was green throughout.
   *    `tests/stage-d-node-materials.spec.ts` now greps the generated WGSL for a
   *    declared function whose body names something outside its parameter list,
   *    which catches this class without a browser. Keep that check.
   */
  'setLayout only works when every input is a parameter, and offline WGSL generation does not compile',
];

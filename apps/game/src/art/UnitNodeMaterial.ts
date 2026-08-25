/**
 * ============================================================================
 * VOLTMARCH — src/art/UnitNodeMaterial.ts
 * ============================================================================
 * THE UNIT MATERIAL, AS A TSL NODE GRAPH. Stage D of
 * the WebGPU migration.
 *
 * `./UnitFactory.ts`'s `createUnitMaterial` is the shipping WebGL material: a
 * `MeshPhysicalMaterial` over the greeble atlas with one `onBeforeCompile` that
 * runs three injections in a fixed order — `declareGaitPhase`, `applyGait`,
 * `applyShroudTint`. This file draws the same hulls for `WebGPURenderer`, on its
 * WebGPU backend and on its WebGL2 fallback, which are the same node path and
 * both of which we support.
 *
 * THE TWO FILES ARE THE SAME MATERIAL EXPRESSED TWICE and are meant to be read
 * side by side. RULING #3 — roughness 0.52, metalness 0, clearcoat 0.30 @ 0.38,
 * env 0.80 — is not restated here: `UNIT_MATERIAL` in `config.ts` is the one
 * table and BOTH materials read it, and the five DEV assertions that guard it
 * are `assertUnitMaterialRuling`, called by both constructors rather than
 * transcribed into this one.
 *
 * WHAT THE NODE PATH GETS FOR FREE
 * --------------------------------
 * `map`, `normalMap`, `aoMap`, `roughnessMap`, `metalnessMap`, `emissiveMap`,
 * `vertexColors` and `clearcoat` are stock `MeshPhysicalNodeMaterial`
 * properties with node implementations already. The ONLY custom work is the walk
 * cycle, the shroud self-tint and the dither — and each of those is a shared
 * helper in `src/render/`, not a copy, because `StructureNodeMaterial.ts` builds
 * on this same base and two of the three would otherwise be written twice.
 *
 * NO `customProgramCacheKey`. The shipping material returns
 * `'vm.unit.gait.shroud.v1'`, a hand-managed string. `onBeforeCompile` is dead
 * on node materials but `customProgramCacheKey` STILL FIRES
 * (`TerrainNodeMaterial.TSL_GAPS` #6), so carrying it over would key programs on
 * a constant describing GLSL that does not exist here, and a future graph change
 * would silently be served the previous program. three hashes the node graph
 * itself, which is strictly better than a string a human must remember to bump.
 * Do not add one back.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import { UNIT_MATERIAL } from '../core/config';
import { ditherOutput } from '../render/dither-nodes';
import { applyGaitNodes } from '../render/gait-nodes';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import type { GreebleAtlas } from './Greeble';
import { assertUnitMaterialRuling } from './UnitFactory';
import { unitRim } from './unit-rim-nodes';

type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE SHARED CONSTRUCTION
 * ========================================================================== */

/**
 * Everything `createUnitMaterial` sets before its `onBeforeCompile`, applied to
 * an already-constructed node material.
 *
 * SPLIT OUT BECAUSE A STRUCTURE MATERIAL *IS* A UNIT MATERIAL. `createStructureMaterial`
 * on the GLSL path literally calls `createUnitMaterial` and then overrides three
 * coat properties, so the node path must inherit the same base or the two
 * renderers would disagree about the atlas wiring for every building in the
 * game. It cannot be inherited through the CLASS, because the two need different
 * vertex graphs — structures have no walk cycle and units have no radar dish.
 */
export function configureUnitNodeBase(mat: MeshPhysicalNodeMaterial, atlas: GreebleAtlas): void {
  mat.map = atlas.map;
  mat.normalMap = atlas.normalMap;
  mat.normalScale = new THREE.Vector2(UNIT_MATERIAL.normalScale, UNIT_MATERIAL.normalScale);
  // One texture, three channels: R = ao, G = roughness, B = metalness.
  mat.aoMap = atlas.ormMap;
  mat.roughnessMap = atlas.ormMap;
  mat.metalnessMap = atlas.ormMap;
  // The ORM map is AUTHORITATIVE for roughness and metalness, so the scalar
  // multipliers are 1.0 by design: the map carries 0.52 on paint and 0.32/0.82
  // on bare metal, which is how one batch serves both surface classes.
  mat.roughness = 1.0;
  mat.metalness = 1.0;
  // Emissive is a MASKED channel. Bible 8.1 wants tiny area and high value; an
  // unmasked 2.6 over a whole hull veils the frame to white.
  mat.emissive = new THREE.Color(0xffffff);
  mat.emissiveMap = atlas.emissiveMap;
  mat.emissiveIntensity = UNIT_MATERIAL.emissiveIntensity;
  mat.clearcoat = UNIT_MATERIAL.clearcoat;
  mat.clearcoatRoughness = UNIT_MATERIAL.clearcoatRoughness;
  mat.envMapIntensity = UNIT_MATERIAL.envMapIntensity;
  // Carries the baked ambient/cavity gradient and the contact darkening.
  mat.vertexColors = true;
  /*
   * MEANT, AND RE-IMPLEMENTED. `material.dithering` reaches nothing on the node
   * path — see `render/dither-nodes.ts`. A hull is a large, smooth, single-hue
   * surface under one directional key, which is the second place in this game
   * where an 8-bit gradient bands; dropping the flag here would make the two
   * renderers differ on exactly the surface the player is looking at.
   */
  mat.dithering = true;
  mat.side = THREE.FrontSide;
  // aoMap multiplies INDIRECT light only, which is exactly bible 3.3's ruling
  // that crease AO must darken ambient and never the direct key.
  mat.aoMapIntensity = 1.0;
}

/* ==========================================================================
 * 2. THE MATERIAL
 * ========================================================================== */

/**
 * `MeshPhysicalNodeMaterial` plus the three things three's node system does not
 * do for us.
 *
 * THE ORDER OF THE TWO OVERRIDES IS THE WHOLE FILE:
 *
 *   `setupPosition`  gait BEFORE `super`, shroud UV AFTER it.
 *   `setupOutput`    shroud tint BEFORE `super`, dither AFTER it.
 *
 * Both mirror the GLSL chunk order, and every one of the four placements is
 * load-bearing:
 *
 *  - The gait must precede `super.setupPosition`, because that is where
 *    `instancedMesh( object )` runs and rewrites `positionLocal` into instance
 *    space. A rotation about "the X axis" after it is a rotation about a WORLD
 *    axis, and a soldier facing +X would swing his legs sideways. See
 *    `render/gait-nodes.ts`.
 *  - The shroud UV must FOLLOW it, because the fog is sampled at the world XZ a
 *    unit actually occupies — instance transform and swung limb included. Same
 *    reason `applyShroudTint` reads `transformed` at `<project_vertex>`.
 *  - The shroud tint precedes `super.setupOutput` (fog, premultiplied alpha)
 *    because the GLSL injects it above `<tonemapping_fragment>`, which runs
 *    before both.
 *  - The dither follows, because `<dithering_fragment>` is the last chunk in the
 *    program.
 */
class UnitStandardNodeMaterial extends MeshPhysicalNodeMaterial {
  override setupPosition(builder: NodeBuilder): Vec3N {
    applyGaitNodes();
    const position = super.setupPosition(builder) as Vec3N;
    shroudVertexUv();
    return position;
  }

  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    const out = super.setupOutput(builder, shroudTint(unitRim(outputNode))) as Vec4N;
    return this.dithering === true ? ditherOutput(out) : out;
  }
}

/**
 * THE NODE-PATH TWIN OF `createUnitMaterial`, and the only place a unit node
 * material is constructed.
 */
export function createUnitNodeMaterial(
  atlas: GreebleAtlas, name: string,
): MeshPhysicalNodeMaterial {
  const mat = new UnitStandardNodeMaterial();
  mat.name = name;
  configureUnitNodeBase(mat, atlas);
  /*
   * NO `castShadowPositionNode`, AND THAT IS A DECISION RATHER THAN AN OMISSION.
   *
   * `render/cast-shadow-nodes.ts` closes the node path's shadow gap and it would
   * take the walk cycle too, in one line — `castShadowPosition( applyGaitNodes )`
   * — because `castShadowPosition` is handed the SAME function the colour pass
   * runs and needs nothing else. It is deliberately not called, for the reason
   * `prop-wind.ts` states about the wind coefficients: the two renderers must
   * not disagree.
   *
   * `createUnitMaterial` HAS NO `customDepthMaterial`. Grep it: the only two in
   * the game are `createStructureDepthMaterial` and `PropLibrary`'s, so on the
   * shipping WebGL renderer a marching rifleman's shadow is the REST POSE and
   * always has been. Wiring it here would make the node path better than the
   * renderer it has to be byte-comparable with, on the most numerous caster in
   * the game, for the least visible displacement of the five — a leg's worth of
   * shadow on a 1.4 m model. That is a second grade baseline bought with the
   * shadow pass's most-multiplied cost.
   *
   * THE HONEST ROUTE, if a swinging shadow is ever wanted: give
   * `createUnitMaterial` a depth material FIRST, so both paths gain it in the
   * same commit, and add the line here in that commit.
   */
  assertUnitMaterialRuling(mat, 'node');
  return mat;
}

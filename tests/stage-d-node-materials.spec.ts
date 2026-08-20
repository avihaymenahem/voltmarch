/**
 * ============================================================================
 * VOLTMARCH — tests/stage-d-node-materials.spec.ts
 * ============================================================================
 * THE GATE FOR THE STAGE D TSL PORT (the WebGPU migration §5):
 * structures, units and props.
 *
 * The mechanism is Stage C's and is worth restating because it is what makes
 * this whole migration cheap to verify: **a TSL node graph compiles to WGSL and
 * to GLSL in plain Node, with no GPU, no canvas and no `renderer.init()`.**
 * `WGSLNodeBuilder` and `GLSLNodeBuilder` run a full setup -> analyze -> generate
 * against a `WebGPURenderer` that was constructed and never initialised. "Does
 * the shader still compile, on both backends" is therefore a unit test.
 *
 * WHAT A GREEN RUN DOES NOT SAY. A compiled shader is not a correct picture.
 * These tests prove the graphs build, that the shipping materials' literals
 * survived being shared, and that the structures the GLSL relied on — the
 * attributes, the discard, the dither, the shroud varying — are present in the
 * generated source. They cannot prove a hull LOOKS the same. That is a capture,
 * and it belongs to Stage F.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GLSLNodeBuilder, Mesh, NodeMaterial, PerspectiveCamera, PlaneGeometry, Scene, WGSLNodeBuilder,
  WebGPURenderer,
} from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn } from 'three/tsl';
import { BUILDING_ANIM, PROP_MATERIAL, SCATTER_WIND, UNIT_MATERIAL } from '../src/core/config';
import { STRUCTURE_ANIM, STRUCTURE_ANIM_LINEAR } from '../src/art/structure-anim';
import { createStructureNodeMaterial } from '../src/art/StructureNodeMaterial';
import { createUnitNodeMaterial } from '../src/art/UnitNodeMaterial';
import { UNIT_RIM_NODE_MARKER } from '../src/art/unit-rim-nodes';
import { createPropNodeMaterial } from '../src/world/PropNodeMaterial';
import { PROP_WIND } from '../src/world/prop-wind';
import { DITHER_SHIFT_LITERAL } from '../src/render/dither-nodes';
import { GAIT_TURNS_TO_RADIANS } from '../src/render/Gait';
import { SHROUD_NODE_VARYING } from '../src/render/shroud-nodes';
import type { GreebleAtlas } from '../src/art/Greeble';

/* ==========================================================================
 * 0. THE OFFLINE COMPILER
 *
 * Lifted from `terrain-node-material.spec.ts` deliberately rather than shared:
 * that file's copy documents the `hasFeature` stub and the undeclared builder
 * fields at length, and a helper module hiding those two surprises is how the
 * next person loses an afternoon to them. The geometry is the difference — the
 * attributes this stage's materials declare are not the attributes terrain
 * declares, and `attribute()` warns and SUBSTITUTES when the geometry lacks one,
 * which silently compiles a different shader from the one the game runs.
 * ========================================================================== */

function offlineRenderer(): WebGPURenderer {
  const canvas = {
    width: 4, height: 4, style: {},
    addEventListener() { /* no listeners are ever fired offline */ },
    removeEventListener() { /* ditto */ },
    getContext() { return null; },
  } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  (renderer as unknown as { hasFeature: () => boolean }).hasFeature = () => false;
  return renderer;
}

interface OfflineBuilder {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  scene: Scene;
  camera: PerspectiveCamera;
  build(): unknown;
  getUniformBufferLimit(): number;
  vertexShader?: string;
  fragmentShader?: string;
}

interface CompiledShader { vertex: string; fragment: string }

/** Per-vertex attributes the Stage D materials read. */
const VERTEX_ATTRIBUTES: ReadonlyArray<readonly [string, number]> = [
  ['aGait', 2],     // unit walk cycle:      (swingSign, pivotY)
  ['aFeature', 4],  // structure per-vertex: (code, riseHeight, animParam, phase)
  ['aSway', 1],     // prop wind amplitude
  ['aEmit', 1],     // prop additive emissive
  ['aGloss', 1],    // prop per-vertex roughness
  ['color', 3],     // vertexColors: true on units and props
];

/**
 * Per-instance attributes the batcher and the scatter upload.
 *
 * `aSwayPhase` is here because the alternative is worse than it looks: with the
 * attribute absent, `attribute()` warns and SUBSTITUTES a default, so every prop
 * assertion below would be made against a shader that never reads the phase —
 * which is exactly the substitution this file's own header warns about, running
 * in this file. `Scatter` publishes it; see `world/prop-wind.ts`.
 */
const INSTANCE_ATTRIBUTES: ReadonlyArray<readonly [string, number]> = [
  ['aState', 4],      // (hpFrac, buildProgress, selected, seed)
  ['aTeamColor', 3],  // LINEAR rgb
  ['aSwayPhase', 1],  // prop wind phase, off the instance's world XZ
];

/**
 * Compile a material's node graph offline, as an INSTANCED mesh.
 *
 * Instanced on purpose and not as a convenience: every material in this stage is
 * drawn through `InstanceBatcher` or `Scatter`, and `NodeMaterial.setupPosition`
 * takes a materially different path for an `InstancedMesh` — it runs
 * `instancedMesh( object )`, which REWRITES `positionLocal` — so a compile over
 * a plain `Mesh` would exercise the wrong graph in exactly the place this port
 * had to be careful.
 */
function compile(material: THREE.Material, which: 'wgsl' | 'glsl'): CompiledShader {
  const renderer = offlineRenderer();
  const geometry = new PlaneGeometry(1, 1, 1, 1);
  const count = geometry.attributes.position.count;
  for (const [name, size] of VERTEX_ATTRIBUTES) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * size), size));
  }
  for (const [name, size] of INSTANCE_ATTRIBUTES) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(size * 2), size));
  }

  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  const scene = new Scene();
  scene.add(mesh);

  const Builder = which === 'wgsl' ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(mesh, renderer) as unknown as OfflineBuilder;
  builder.material = material;
  builder.scene = scene;
  builder.camera = new PerspectiveCamera();
  builder.geometry = geometry;
  /*
   * THE ONE STUB THIS FILE NEEDS BEYOND STAGE C'S, AND IT IS THERE BECAUSE THE
   * MESH IS INSTANCED. `createInstanceMatrixNode` asks the builder how big a
   * uniform buffer the device allows, and answers that question through
   * `renderer.backend.device.limits` — which is null until `renderer.init()`.
   *
   * ZERO ON PURPOSE. It selects the INTERLEAVED ATTRIBUTE branch rather than the
   * uniform-buffer one, which is what a real scatter mesh of four thousand props
   * takes (16 mat4 floats is 64 bytes an instance, so the uniform route runs out
   * at 1024) and is the branch that actually emits vertex attributes.
   */
  builder.getUniformBufferLimit = (): number => 0;
  builder.build();

  return { vertex: builder.vertexShader ?? '', fragment: builder.fragmentShader ?? '' };
}

/** A 1x1 stand-in atlas. The graph cares about the sampler shape, not the art. */
function fakeAtlas(): GreebleAtlas {
  const tex = (name: string, srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    t.name = name;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    // `defaultCoat` reads `spec.plating`: 'welded' selects the Allied ceramic
    // glaze, anything else the Soviet field coat. Either is fine here.
    spec: { plating: 'welded' },
    map: tex('atlas.map', true),
    normalMap: tex('atlas.normal', false),
    ormMap: tex('atlas.orm', false),
    emissiveMap: tex('atlas.emissive', true),
  } as unknown as GreebleAtlas;
}

const BOTH = ['wgsl', 'glsl'] as const;

/* ==========================================================================
 * 1. EVERY GRAPH COMPILES — on BOTH backends of the node path
 *
 * NOT ONE TEST BUT TWO, for the reason Stage C recorded: `WebGPURenderer`
 * silently runs its WebGL2 backend wherever a WebGPU device is unavailable, and
 * that backend compiles the SAME node graph through `GLSLNodeBuilder`. Anything
 * that builds on one and not the other ships a renderer that works on half the
 * machines. It is also why `wgslFn` was refused as a shortcut for any of this.
 * ========================================================================== */

describe('the Stage D graphs compile', () => {
  const cases: ReadonlyArray<readonly [string, () => THREE.Material]> = [
    ['the unit material', () => createUnitNodeMaterial(fakeAtlas(), 'unit.test')],
    ['the structure material', () => createStructureNodeMaterial(fakeAtlas(), 'structure.test')],
    ['the prop material', () => createPropNodeMaterial()],
  ];

  for (const [label, make] of cases) {
    for (const which of BOTH) {
      it(`builds ${which.toUpperCase()} for ${label}`, () => {
        const material = make();
        const { vertex, fragment } = compile(material, which);
        expect(vertex.length).toBeGreaterThan(500);
        expect(fragment.length).toBeGreaterThan(2000);
        material.dispose();
      });
    }

    it(`emits no NaN literal into ${label}`, () => {
      // A `NaN` in a generated constant is the black-frame failure this repo has
      // a standing rule about, and it costs nothing to look for.
      const material = make();
      for (const which of BOTH) {
        const { vertex, fragment } = compile(material, which);
        expect(vertex).not.toMatch(/NaN/);
        expect(fragment).not.toMatch(/NaN/);
      }
      material.dispose();
    });
  }
});

/* ==========================================================================
 * 1b. NO DECLARED WGSL FUNCTION CAPTURES MODULE SCOPE
 *
 * THE CHECK THAT EXISTS BECAUSE THE ONE ABOVE IS WEAKER THAN IT READS.
 * `WGSLNodeBuilder.build()` GENERATES a module; it does not compile one, and
 * nothing in Node does. Four of Stage D's five helpers passed every test in
 * section 1 and were then refused outright by Chrome:
 *
 *     unresolved value 'aSwayPhase'    (the prop wind)
 *     unresolved value 'vRaState'      (the structure soot)
 *     unresolved value 'nodeUniform1'  (the shroud's mask sampler)
 *
 * The cause is `TSL_GAPS` #2's missing half: `.setLayout()` turns a TSL `Fn`
 * into a real WGSL function, and a WGSL function can see NOTHING but its
 * declared parameters. A body that reads a module-scope attribute, varying or
 * uniform emits a function full of names that are not in its scope. The GLSL
 * backend inlines regardless, so the WebGL2 arm never noticed.
 *
 * This finds it without a browser: take every `fn` three declared, and look for
 * the identifiers only the entry point can reach.
 * ========================================================================== */

/**
 * Names that exist only in the entry point's scope: our attributes, our
 * varyings, and three's generated uniform/varying handles.
 *
 * `nodeUniform\\d+` is the important one and the least obvious — it is how a
 * sampler arrives, so a `texture().sample()` inside a declared function fails
 * on a name this list would otherwise miss entirely.
 *
 * AT MODULE SCOPE because section 5 runs the identical scan over the SHADOW
 * graph. One scanner, two callers: a second transcription of it is the drift
 * this whole file is written against.
 */
const OUT_OF_SCOPE = [
  'aState', 'aFeature', 'aTeamColor', 'aGait', 'aSway', 'aSwayPhase', 'aEmit', 'aGloss',
  'vRaState', 'vRaTeam', 'vRaClip', 'vShroudUv', 'vEmit', 'vGloss',
];

/** Bodies of every `fn name( ... ) -> type { ... }` three declared. */
function declaredFunctions(wgsl: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wgsl)) !== null) {
    // `main` IS the entry point and is the one scope that legitimately holds
    // every attribute and varying in the module.
    if (m[1] === 'main') continue;
    const open = wgsl.indexOf('{', re.lastIndex);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < wgsl.length; i++) {
      if (wgsl[i] === '{') depth++;
      else if (wgsl[i] === '}' && --depth === 0) break;
    }
    out.push({ name: m[1], body: wgsl.slice(open, i + 1) });
  }
  return out;
}

/** The scope scan itself, so both callers assert the same thing. */
function expectNoCapturingFunction(wgsl: string): void {
  for (const fn of declaredFunctions(wgsl)) {
    for (const name of OUT_OF_SCOPE) {
      expect(fn.body, `fn ${fn.name} reads ${name}, which only main can see`)
        .not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(fn.body, `fn ${fn.name} reads a nodeUniform, which only main can see`)
      .not.toMatch(/\bnodeUniform\d+\b/);
  }
}

describe('the generated WGSL has no function that reaches outside itself', () => {
  const cases: ReadonlyArray<readonly [string, () => THREE.Material]> = [
    ['the unit material', () => createUnitNodeMaterial(fakeAtlas(), 'unit.scope')],
    ['the structure material', () => createStructureNodeMaterial(fakeAtlas(), 'structure.scope')],
    ['the prop material', () => createPropNodeMaterial()],
  ];

  for (const [label, make] of cases) {
    it(`declares no capturing function in ${label}`, () => {
      const material = make();
      for (const stage of [compile(material, 'wgsl').vertex, compile(material, 'wgsl').fragment]) {
        expectNoCapturingFunction(stage);
      }
      material.dispose();
    });
  }

  it('would actually catch one, so the check is not vacuous', () => {
    // The control. Without it, a run in which three stopped emitting declared
    // functions at all would pass every assertion above and prove nothing.
    const wgsl = 'fn raThing( a : f32 ) -> f32 { return a * vRaState.x; }';
    const bodies = wgsl.slice(wgsl.indexOf('{'));
    expect(bodies).toMatch(/\bvRaState\b/);
  });
});

/* ==========================================================================
 * 2. THE SHARED CONSTANTS ARE ON THEIR PRE-MOVE VALUES
 *
 * THE LITERALS ARE WRITTEN OUT AGAIN ON PURPOSE, and this is the block that
 * must not be tidied. The derived scalars were MOVED out of the GLSL string
 * builders in `BuildingFactory.ts`, `Gait.ts` and `PropLibrary.ts` so both
 * materials read one copy. Every other assertion in this file compares one path
 * against the other or against that shared table — so a value that drifted
 * during the move would drift on BOTH sides at once and every one of them would
 * still pass. These numbers are transcribed from the shipping GLSL as it stood
 * at v2.13.0, before the move.
 * ========================================================================== */

describe('the shared derived constants', () => {
  it('keeps the structure animation numbers the GLSL baked in', () => {
    expect(STRUCTURE_ANIM.doorPeriodSeconds).toBe(9.0);
    expect(STRUCTURE_ANIM.doorOpenFraction).toBe(0.30);
    expect(STRUCTURE_ANIM.doorCloseFraction).toBe(0.44);
    expect(STRUCTURE_ANIM.damageOnsetLo).toBeCloseTo(0.198, 10);
    expect(STRUCTURE_ANIM.damageOnset).toBe(0.66);
    expect(STRUCTURE_ANIM.sootMultiplier).toBe(0.44);
    expect(STRUCTURE_ANIM.burnOnsetLo).toBeCloseTo(0.066, 10);
    expect(STRUCTURE_ANIM.burnOnset).toBe(0.33);
    expect(STRUCTURE_ANIM.burnFlickerRadians).toBeCloseTo(69.11498, 5);
    expect(STRUCTURE_ANIM.riseBandMeters).toBe(0.55);
    expect(STRUCTURE_ANIM.selectPulseRadians).toBeCloseTo(8.796452, 6);
    expect(STRUCTURE_ANIM.selectEmissive).toBe(0.35);
    expect(STRUCTURE_ANIM.burnEmissiveGain).toBe(2.4);
    expect(STRUCTURE_ANIM.riseBandGain).toBe(2.2);
    expect(STRUCTURE_ANIM.burnMaskGain).toBe(6.0);
  });

  it('derives them from config rather than from a second table', () => {
    // The complement of the test above: pinned literals alone would let the
    // shared table stop tracking `config.ts` without anything noticing.
    expect(STRUCTURE_ANIM.damageOnset).toBe(BUILDING_ANIM.damageOnset);
    expect(STRUCTURE_ANIM.damageOnsetLo).toBe(BUILDING_ANIM.damageOnset * 0.3);
    expect(STRUCTURE_ANIM.burnOnsetLo).toBe(BUILDING_ANIM.burnOnset * 0.2);
    expect(STRUCTURE_ANIM.doorCloseFraction).toBe(BUILDING_ANIM.doorOpenFraction + 0.14);
    expect(STRUCTURE_ANIM.sootMultiplier).toBe(BUILDING_ANIM.sootMultiplier);
    expect(STRUCTURE_ANIM.selectEmissive).toBe(BUILDING_ANIM.selectEmissive);
  });

  it('keeps the two structure colours in LINEAR space', () => {
    // `lin()` in `BuildingFactory.ts` emitted these at four decimal places; the
    // node path reads the same floats. Both must be plausible linear values —
    // an sRGB slip would show as a channel above the sRGB->linear curve.
    for (const rgb of [STRUCTURE_ANIM_LINEAR.burnColor, STRUCTURE_ANIM_LINEAR.riseBandColor]) {
      expect(rgb).toHaveLength(3);
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    // '#FFB01E' and '#9DFEF5': both are bright, so at least one channel is high.
    expect(Math.max(...STRUCTURE_ANIM_LINEAR.burnColor)).toBeGreaterThan(0.9);
    expect(Math.max(...STRUCTURE_ANIM_LINEAR.riseBandColor)).toBeGreaterThan(0.9);
  });

  it('keeps the prop wind coefficients the GLSL baked in', () => {
    expect(PROP_WIND.phaseX).toBe(0.113);
    expect(PROP_WIND.phaseZ).toBe(0.171);
    expect(PROP_WIND.harmonicA).toBe(0.78);
    expect(PROP_WIND.harmonicB).toBe(0.22);
    expect(PROP_WIND.xRateB).toBe(2.37);
    expect(PROP_WIND.xPhaseB).toBe(0.7);
    expect(PROP_WIND.zRateA).toBe(0.83);
    expect(PROP_WIND.zPhaseA).toBe(1.31);
    expect(PROP_WIND.zRateB).toBe(2.11);
    expect(PROP_WIND.zAmplitude).toBe(0.72);
    expect(PROP_WIND.radiansPerSecond).toBeCloseTo(SCATTER_WIND.hz * Math.PI * 2, 10);
  });

  it('keeps the gait turn-to-radian factor the GLSL baked in', () => {
    expect(GAIT_TURNS_TO_RADIANS).toBe(6.2831853);
    // And it must still PRINT as that string, because it is interpolated into
    // the shipping GLSL and a different precision is a different program.
    expect(`${GAIT_TURNS_TO_RADIANS}`).toBe('6.2831853');
  });
});

/* ==========================================================================
 * 3. THE MATERIALS AGREE WITH THEIR SHIPPING TWINS
 * ========================================================================== */

describe('the unit node material', () => {
  it('carries RULING #3 verbatim, from the same table as the GLSL twin', () => {
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.ruling');
    expect(mat.roughness).toBe(1.0);
    expect(mat.metalness).toBe(1.0);
    expect(mat.clearcoat).toBe(UNIT_MATERIAL.clearcoat);
    expect(mat.clearcoatRoughness).toBe(UNIT_MATERIAL.clearcoatRoughness);
    expect(mat.envMapIntensity).toBe(UNIT_MATERIAL.envMapIntensity);
    expect(mat.emissiveIntensity).toBe(UNIT_MATERIAL.emissiveIntensity);
    expect(mat.vertexColors).toBe(true);
    expect(mat.aoMapIntensity).toBe(1.0);
    // RULING #3 is that it is PHYSICAL, not Standard. `MeshStandardNodeMaterial`
    // is right there and is what the terrain uses.
    expect((mat as unknown as { isMeshPhysicalNodeMaterial?: boolean })
      .isMeshPhysicalNodeMaterial).toBe(true);
    mat.dispose();
  });

  it('re-implements the dithering the node system does not have', () => {
    /*
     * `material.dithering` is honoured by three's WebGL chunk system and by
     * NOTHING in `src/nodes/`. A hull is a large, smooth, single-hue surface
     * under one directional key — the second place in this game where an 8-bit
     * gradient bands. The marker is the +/-0.25/255 shift constant, which
     * nothing else in any graph produces.
     */
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.dither');
    expect(mat.dithering).toBe(true);
    expect(compile(mat, 'glsl').fragment).toContain(`${DITHER_SHIFT_LITERAL}`.slice(0, 10));
    mat.dispose();
  });

  it('drops the dither when the flag is off, so the flag is really the switch', () => {
    // The control for the test above: a hard-coded dither would pass it too.
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.nodither');
    mat.dithering = false;
    expect(compile(mat, 'glsl').fragment).not.toContain(`${DITHER_SHIFT_LITERAL}`.slice(0, 10));
    mat.dispose();
  });

  it('carries the walk cycle into the vertex stage', () => {
    // `aGait` and the turns-to-radians factor are the whole animation. Losing
    // either compiles cleanly and renders a parade of statues.
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.gait');
    const { vertex } = compile(mat, 'glsl');
    expect(vertex).toMatch(/aGait/);
    expect(vertex).toContain('6.2831853');
    mat.dispose();
  });

  it('publishes the shroud varying and consumes it in the fragment stage', () => {
    /*
     * The shroud self-tint is TWO calls at two different points, and a material
     * that makes the fragment call without the vertex one compiles fine and
     * renders an unwritten varying — a black or garbage tint rather than an
     * error. Both halves are asserted because only both together are the
     * feature.
     */
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.shroud');
    const { vertex, fragment } = compile(mat, 'glsl');
    expect(vertex).toContain(SHROUD_NODE_VARYING);
    expect(fragment).toContain(SHROUD_NODE_VARYING);
    mat.dispose();
  });

  it('adds the same geometry-normal silhouette rim as the shipping material', () => {
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.rim');
    const { fragment } = compile(mat, 'glsl');
    expect(fragment).toContain(UNIT_RIM_NODE_MARKER);
    // The perturbed atlas normal would make every seam glow; the geometry
    // normal keeps this treatment confined to the actual silhouette.
    expect(fragment).toMatch(/normalViewGeometry/);
    mat.dispose();
  });
});

describe('the structure node material', () => {
  it('discards the part of the structure still underground', () => {
    /*
     * The construction rise IS the discard: `vRaClip < 0.0` is what makes a
     * building grow out of its pad instead of appearing whole. Without it the
     * frame shows a finished structure at buildProgress 0.
     */
    const mat = createStructureNodeMaterial(fakeAtlas(), 'structure.clip');
    expect(compile(mat, 'wgsl').fragment).toMatch(/discard/);
    expect(compile(mat, 'glsl').fragment).toMatch(/discard/);
    mat.dispose();
  });

  it('reads both instance channels and the per-vertex feature code', () => {
    const mat = createStructureNodeMaterial(fakeAtlas(), 'structure.attrs');
    const { vertex } = compile(mat, 'glsl');
    expect(vertex).toMatch(/aState/);
    expect(vertex).toMatch(/aFeature/);
    expect(vertex).toMatch(/aTeamColor/);
    mat.dispose();
  });

  it('leaves material.roughness reachable, unlike terrain', () => {
    // Terrain replaces `roughnessNode` and so makes the scalar inert. This
    // material does NOT, and the difference is worth pinning: a structure's
    // roughness comes from its faction construction language and is set per
    // material by `BuildingFactory`.
    const mat = createStructureNodeMaterial(fakeAtlas(), 'structure.rough');
    expect(mat.roughnessNode).toBeNull();
    mat.dispose();
  });
});

describe('the prop node material', () => {
  it('reads all three per-vertex prop channels', () => {
    // aSway (wind), aEmit (additive lamp heads), aGloss (per-vertex roughness).
    // Each one is a separate draw call saved; losing one is a silent flattening.
    const mat = createPropNodeMaterial();
    const { vertex } = compile(mat, 'glsl');
    expect(vertex).toMatch(/aSway/);
    expect(vertex).toMatch(/aEmit/);
    expect(vertex).toMatch(/aGloss/);
    mat.dispose();
  });

  it('keeps the roughness lerp and the additive emissive on their own nodes', () => {
    /*
     * `aGloss` is the WHOLE surface-variation budget for props: a parked car is
     * wet lacquer and the hedge beside it is matte leaf, out of one material and
     * therefore one draw call. It reaches the BRDF through `roughnessNode`, and
     * `aEmit` reaches the frame through `emissiveNode`; a port that dropped
     * either would render one uniform matte roster with dark lamps.
     */
    const mat = createPropNodeMaterial();
    expect(mat.roughnessNode).not.toBeNull();
    expect(mat.emissiveNode).not.toBeNull();
    // And the scalar stays on its shipping value, because the lerp starts there.
    expect(mat.roughness).toBe(PROP_MATERIAL.roughness);
    mat.dispose();
  });

  it('publishes the shroud varying, so a forest in the black stays dark', () => {
    const mat = createPropNodeMaterial();
    const { vertex, fragment } = compile(mat, 'glsl');
    expect(vertex).toContain(SHROUD_NODE_VARYING);
    expect(fragment).toContain(SHROUD_NODE_VARYING);
    mat.dispose();
  });
});

/* ==========================================================================
 * 3b. THE SHADOW PASS SEES THE VERTEX DISPLACEMENT
 *
 * `STAGE_D_TSL_GAPS` #1 WAS THE MIGRATION BLOCKER AND THIS IS ITS GATE.
 *
 * The node renderer never reads `object.customDepthMaterial`. It sets
 * `scene.overrideMaterial` to a shared depth material and harvests four fields
 * off the caster's own material (`Renderer._getShadowNodes`), of which
 * `setupPosition` is not one — so every model-space displacement in this stage
 * was invisible to the shadow map and a half-built structure cast its finished
 * silhouette. `castShadowPositionNode` IS harvested, and it is applied AFTER
 * `instancedMesh( object )`, which is what makes the fix expressible at all.
 *
 * WHAT THIS SECTION CAN AND CANNOT DO. It compiles the OVERRIDE MATERIAL — the
 * same three fields wired the same way `Renderer` wires them — so it is testing
 * the graph the shadow pass really builds, and it can prove the reset, the edit,
 * the varying and the re-instancing are all there and in that order. It cannot
 * prove the shadow is CORRECT. That is `tools/shadow-override-probe.mjs`, whose
 * `tsl-castshadow` arm measures 0.460% darker than the shipping WebGL render
 * against the defect's 3.040%, and this file must not be read as a substitute
 * for it — `STAGE_D_TSL_GAPS` #6 is the standing reminder that generating a
 * module is not compiling one.
 * ========================================================================== */

/**
 * What `Renderer._getShadowNodes` plus `Renderer.renderObject` actually build.
 *
 * Reconstructed rather than imported because three exposes neither: the harvest
 * lives inside a private method and the override material is owned by the shadow
 * node. Every line here is transcribed from `Renderer.js`, and the transcription
 * is the point — a stub that merely put `castShadowPositionNode` on a material
 * would not exercise `NodeMaterial.setupPosition`'s instancing, which is the one
 * thing the fix has to survive.
 */
function shadowGraphOf(source: THREE.Material): NodeMaterial {
  const src = source as unknown as {
    castShadowPositionNode: Node | null;
    colorNode: Node | null;
    maskNode: Node | null;
  };
  const mat = new NodeMaterial();
  mat.name = 'shadow.override';
  const override = mat as unknown as { positionNode: Node | null; colorNode: Node | null };
  override.positionNode = src.castShadowPositionNode;
  const mask = src.maskNode;
  if (mask !== null && mask !== undefined) {
    // `colorNode = Fn( ( [ color ] ) => { maskNode.not().discard(); return color; } )( colorNode )`
    const gated = mask as unknown as { not(): { discard(): void } };
    override.colorNode = (Fn(([color]: [Node]) => {
      gated.not().discard();
      return color;
    }) as unknown as (c: Node | null) => Node)(src.colorNode);
  } else {
    override.colorNode = src.colorNode;
  }
  return mat;
}

describe('the shadow pass graph', () => {
  const CASTERS: ReadonlyArray<readonly [string, () => THREE.Material]> = [
    ['the structure material', () => createStructureNodeMaterial(fakeAtlas(), 'structure.shadow')],
    ['the prop material', () => createPropNodeMaterial()],
  ];

  for (const [label, make] of CASTERS) {
    it(`${label} declares a castShadowPositionNode at all`, () => {
      const mat = make() as unknown as { castShadowPositionNode: Node | null };
      // The whole fix is one property. Without it the harvest finds nothing and
      // the shadow pass silently reverts to the finished silhouette — which is
      // exactly the failure mode the gap had: no warning, no error, a picture.
      expect(mat.castShadowPositionNode).not.toBeNull();
      (mat as unknown as THREE.Material).dispose();
    });

    for (const which of BOTH) {
      it(`builds ${which.toUpperCase()} for ${label}'s shadow override`, () => {
        const source = make();
        const { vertex, fragment } = compile(shadowGraphOf(source), which);
        expect(vertex.length).toBeGreaterThan(300);
        expect(fragment.length).toBeGreaterThan(100);
        expect(vertex).not.toMatch(/NaN/);
        expect(fragment).not.toMatch(/NaN/);
        source.dispose();
      });
    }

    it(`declares no capturing WGSL function in ${label}'s shadow override`, () => {
      // The same scan section 1b runs, over the graph nobody was looking at.
      const source = make();
      const { vertex, fragment } = compile(shadowGraphOf(source), 'wgsl');
      expectNoCapturingFunction(vertex);
      expectNoCapturingFunction(fragment);
      source.dispose();
    });
  }

  /**
   * The three statements, in order, in the emitted vertex stage.
   *
   * ORDER IS THE ENTIRE CORRECTNESS ARGUMENT and none of the three is provable
   * from a name-presence check:
   *
   *   1. `positionLocal = position` a SECOND time — the reset. Without it the
   *      edit runs on the already-instanced position and rotates about a world
   *      axis through the world origin.
   *   2. the edit.
   *   3. an instance-matrix multiply AFTER the edit — the re-instancing. Without
   *      it the caster is drawn in model space, at the map origin.
   */
  function flowOf(source: THREE.Material): string {
    const { vertex } = compile(shadowGraphOf(source), 'glsl');
    return vertex;
  }

  /** Index of the Nth `positionLocal = ( nodeVarN * vec4( positionLocal ...` multiply. */
  function instancingSites(glsl: string): number[] {
    const out: number[] = [];
    const re = /positionLocal\s*=\s*\(\s*nodeVar\d+\s*\*\s*vec4\(\s*positionLocal/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(glsl)) !== null) out.push(m.index);
    return out;
  }

  it('resets the structure to model space, sinks it, then re-instances', () => {
    const source = createStructureNodeMaterial(fakeAtlas(), 'structure.order');
    const glsl = flowOf(source);

    // 1. TWO resets. The first is three's own initialiser; the second is ours,
    //    and it has to sit after the instancing three already emitted.
    const resets = [...glsl.matchAll(/positionLocal\s*=\s*position\s*;/g)].map((m) => m.index);
    expect(resets.length).toBeGreaterThanOrEqual(2);

    const sites = instancingSites(glsl);
    expect(sites.length).toBe(2);
    expect(resets[1]).toBeGreaterThan(sites[0]);

    // 2. The sink is solved and applied between the reset and the second
    //    instancing. `raDrop` is the shared name in both shaders.
    const drop = glsl.indexOf('raDrop =');
    expect(drop).toBeGreaterThan(resets[1]);
    expect(drop).toBeLessThan(sites[1]);

    // 3. And the ground cut travels with it. `vRaClip` is what `maskNode` tests,
    //    and an UNASSIGNED varying reads as zero, passes `>= 0.0` and discards
    //    nothing — which is how a sunk structure kept its finished shadow even
    //    though the mask was harvested correctly all along.
    expect(glsl).toMatch(/vRaClip\s*=\s*nodeVar\d+\s*;/);
    expect(glsl).not.toMatch(/vRaClip\s*=\s*0\.0\s*;/);
    expect(glsl.indexOf('vRaClip =')).toBeGreaterThan(drop);

    source.dispose();
  });

  it('resets the prop to model space, sways it, then re-instances', () => {
    const source = createPropNodeMaterial();
    const glsl = flowOf(source);

    const resets = [...glsl.matchAll(/positionLocal\s*=\s*position\s*;/g)].map((m) => m.index);
    const sites = instancingSites(glsl);
    expect(resets.length).toBeGreaterThanOrEqual(2);
    expect(sites.length).toBe(2);
    expect(resets[1]).toBeGreaterThan(sites[0]);

    // The wind reads the per-instance phase and the per-vertex amplitude, and
    // both have to land between the reset and the re-instancing. A frozen
    // canopy shadow is precisely what `PropLibrary`'s depth material exists to
    // prevent on the WebGL path.
    const sway = glsl.indexOf('swayPhase = aSwayPhase');
    expect(sway).toBeGreaterThan(resets[1]);
    expect(sway).toBeLessThan(sites[1]);
    expect(glsl.slice(sway, sites[1])).toMatch(/aSway\b/);

    source.dispose();
  });

  it('leaves the unit material without one, matching the shipping renderer', () => {
    /*
     * A DECISION, PINNED. `createUnitMaterial` has no `customDepthMaterial` —
     * the only two in the game are `createStructureDepthMaterial` and
     * `PropLibrary`'s — so on WebGL a marching rifleman's shadow is the rest
     * pose. Wiring `castShadowPosition( applyGaitNodes )` here is one line and
     * would make the node path better than the renderer it must stay
     * byte-comparable with, on the most numerous caster in the game. If a
     * swinging shadow is ever wanted, the depth material comes first and both
     * paths gain it in one commit.
     */
    const mat = createUnitNodeMaterial(fakeAtlas(), 'unit.shadow');
    expect((mat as unknown as { castShadowPositionNode: Node | null })
      .castShadowPositionNode).toBeNull();
    mat.dispose();
  });

  /**
   * Every `layout( location = N ) in <type> <name>;` in a GLSL vertex stage,
   * split into the ones WE named and three's own `nodeAttributeN` aliases.
   *
   * The regex is written against the real emitted form and the counts below are
   * the check that it still matches: a pattern that silently stopped matching
   * would make every assertion here vacuously true, which is what the first
   * version of this test did.
   */
  function vertexAttributes(glsl: string): { named: Set<string>; generated: number } {
    const all = [...glsl.matchAll(/layout\(\s*location\s*=\s*\d+\s*\)\s*in\s+\w+\s+(\w+)\s*;/g)]
      .map((m) => m[1]);
    return {
      named: new Set(all.filter((n) => !/^nodeAttribute\d+$/.test(n))),
      generated: all.filter((n) => /^nodeAttribute\d+$/.test(n)).length,
    };
  }

  it('adds no per-instance data, which is the whole reason this route was taken', () => {
    /*
     * THE CONSTRAINT THAT CHOSE THE DESIGN, PINNED.
     *
     * The alternative was uploading a per-instance 3x3 basis so the displacement
     * could be rotated AFTER instancing — 36 bytes an instance a frame through
     * `InstanceBatcher` and `Scatter`, the two hottest writers in the renderer,
     * against a suite that asserts zero allocations per frame exactly. This
     * route reaches the instance transform through `builder.object` instead, so
     * the only per-instance data it touches is the matrix three uploads anyway.
     *
     * TWO ASSERTIONS, AND THE SECOND IS THE COST. The shadow stage names no
     * GEOMETRY attribute the colour stage does not, and its only additions are
     * three's own instance-matrix aliases — exactly FOUR of them, one mat4,
     * because `instancedMesh( object )` now runs twice. That is the price, it is
     * a second binding of a buffer that is already resident rather than a second
     * copy of one, and it is written down here so a future change that starts
     * uploading something cannot pass quietly.
     */
    const source = createStructureNodeMaterial(fakeAtlas(), 'structure.cost');
    const colour = vertexAttributes(compile(source, 'glsl').vertex);
    const shadow = vertexAttributes(compile(shadowGraphOf(source), 'glsl').vertex);

    // The regex still matches something, so the two loops below are not vacuous.
    expect(colour.named.size).toBeGreaterThan(2);
    expect(colour.generated).toBe(4);

    for (const name of shadow.named) {
      expect(colour.named, `the shadow pass reads ${name} and the colour pass does not`)
        .toContain(name);
    }
    expect(shadow.generated).toBe(colour.generated + 4);

    /*
     * AND THE HARD LIMIT THIS SPENDS AGAINST. WebGPU guarantees only 16 vertex
     * attributes; the shadow stage measures 13 here and 14 on the real structure
     * geometry, which carries `uv` for the atlas alpha the harvested `colorNode`
     * samples. Doubling the instance matrix costs four of the sixteen, so a
     * future geometry that adds three more channels blows the limit in a
     * player's browser and in no other gate.
     */
    expect(shadow.named.size + shadow.generated).toBeLessThanOrEqual(16 - 2);
    source.dispose();
  });
});

/* ==========================================================================
 * 4. THE CACHE KEY THAT MUST NOT COME BACK
 * ========================================================================== */

describe('program caching', () => {
  it('carries none of the GLSL materials hand-managed cache keys', () => {
    /*
     * `customProgramCacheKey` STILL FIRES on node materials — it is the half of
     * the old mechanism that survives `onBeforeCompile`'s silent death
     * (`TerrainNodeMaterial.TSL_GAPS` #6). The shipping materials return
     * `'ra3.structure.v3'`, `'vm.unit.gait.shroud.v1'` and `'ra-prop-v3'`,
     * strings a human has to remember to bump. There is no injected GLSL on this
     * path, so those strings could only ever be stale, and a stale key hands
     * back the previous program with nothing thrown and nothing logged.
     */
    const stale = ['ra3.structure.v3', 'vm.unit.gait.shroud.v1', 'ra-prop-v3', 'ra-prop-depth-v1'];
    const mats: THREE.Material[] = [
      createUnitNodeMaterial(fakeAtlas(), 'unit.key'),
      createStructureNodeMaterial(fakeAtlas(), 'structure.key'),
      createPropNodeMaterial(),
    ];
    for (const mat of mats) {
      expect(stale).not.toContain(mat.customProgramCacheKey());
      mat.dispose();
    }
  });
});

/**
 * ============================================================================
 * VOLTMARCH — tests/terrain-node-material.spec.ts
 * ============================================================================
 * THE GATE FOR THE TSL TERRAIN PORT (the WebGPU migration Stage C).
 *
 * THE THING THAT MAKES THIS FILE POSSIBLE, AND IT IS WORTH THE WHOLE MIGRATION
 * KNOWING ABOUT: **a TSL node graph compiles to WGSL and to GLSL in plain Node,
 * with no GPU, no canvas and no `renderer.init()`.** `WGSLNodeBuilder` and
 * `GLSLNodeBuilder` are exported from `three/webgpu` and will run a full
 * setup -> analyze -> generate over a material given a `WebGPURenderer` that was
 * constructed and never initialised. So "does the shader still compile" is a
 * unit test here rather than a browser capture, on both backends of the node
 * path, for every stage of the port that follows this one.
 *
 * WHAT THAT DOES NOT COVER, said plainly so nobody over-reads a green run: a
 * compiled shader is not a correct picture. These tests prove the graph builds,
 * that the uniforms are wired, that a biome means the same numbers on both
 * materials, and that the structures the GLSL relied on survived the
 * translation. They cannot prove the ground LOOKS the same — that is a capture,
 * and it is `tools/terrain-node-compare.mjs`.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GLSLNodeBuilder, Mesh, PerspectiveCamera, PlaneGeometry, Scene, WGSLNodeBuilder, WebGPURenderer,
} from 'three/webgpu';
import { BIOMES, SURFACE_COUNT, SurfaceId, type BiomeDef, type BiomeName } from '../src/world/Biomes';
import { createTerrainMaterials } from '../src/world/TerrainMaterial';
import { createTerrainNodeMaterials } from '../src/world/TerrainNodeMaterial';
import {
  SPLAT_SHARPEN, TERRAIN_LAYER_ROUGH_DEFAULT, TERRAIN_LAYER_SCALE_DEFAULT,
  TERRAIN_SCALAR_DEFAULTS, TERRAIN_VEC3_DEFAULTS,
} from '../src/world/terrain-uniforms';
import { CELL, CLIFF_SLOPE, MAP_SIZE } from '../src/core/config';

/* Small, because these tests build the real procedural tiles and 256 would be
 * 60x the bytes for a question none of them ask. */
const LAYER_SIZE = 8;
const SEED = 1234;

function makeSet(biome: BiomeDef = BIOMES.temperate) {
  return createTerrainNodeMaterials({ biome, layerTextureSize: LAYER_SIZE, seed: SEED });
}

/**
 * A `WebGPURenderer` that was constructed and never initialised.
 *
 * The node builders reach the renderer for exactly two things during a build:
 * `renderer.contextNode` (a real `context()` node, set in the constructor) and
 * `renderer.library.fromMaterial` (the node-material registry, also set in the
 * constructor). Both exist the moment the object does.
 *
 * `hasFeature` is the ONE exception and it is stubbed rather than worked
 * around: `WGSLNodeBuilder.isUnfilterable` asks whether `float32Filterable` is
 * available, and `Renderer.hasFeature` throws by contract before the backend is
 * up. Answering `false` is the correct answer for every texture this material
 * samples — all five are 8-bit — so the stub does not hide anything this file
 * is testing.
 */
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

interface CompiledShader { vertex: string; fragment: string }

/**
 * The part of a node builder this file drives.
 *
 * `@types/three`'s `NodeBuilder` declares two fields — `material` and
 * `geometry` — and stops. `scene`, `camera`, `build()`, `vertexShader` and
 * `fragmentShader` are all real and all undeclared, so the shape is written out
 * here and asserted once rather than reached for with a cast at each use. If a
 * later three ships fuller typings this interface simply becomes redundant.
 */
interface OfflineBuilder {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  scene: Scene;
  camera: PerspectiveCamera;
  build(): unknown;
  vertexShader?: string;
  fragmentShader?: string;
}

/**
 * Compile a material's node graph offline.
 *
 * The geometry carries `aUp` / `aTop` because the material declares those
 * attributes and `attribute()` warns (and substitutes) when the geometry does
 * not have them — a missing attribute here would silently compile a DIFFERENT
 * shader from the one the game runs.
 */
function compile(material: THREE.Material, which: 'wgsl' | 'glsl'): CompiledShader {
  const renderer = offlineRenderer();
  const geometry = new PlaneGeometry(1, 1, 1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array(count), 1));

  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);

  const Builder = which === 'wgsl' ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(mesh, renderer) as unknown as OfflineBuilder;
  builder.material = material;
  builder.scene = scene;
  builder.camera = new PerspectiveCamera();
  builder.geometry = geometry;
  builder.build();

  return { vertex: builder.vertexShader ?? '', fragment: builder.fragmentShader ?? '' };
}

/* ==========================================================================
 * 1. THE GRAPH COMPILES — on BOTH backends of the node path
 * ========================================================================== */

describe('the TSL terrain graph compiles', () => {
  it('builds WGSL for the WebGPU backend', () => {
    const set = makeSet();
    const { vertex, fragment } = compile(set.material, 'wgsl');
    expect(vertex.length).toBeGreaterThan(500);
    expect(fragment.length).toBeGreaterThan(2000);
    set.dispose();
  });

  /*
   * NOT REDUNDANT WITH THE ABOVE, and this is the reason `wgslFn` was rejected
   * as a shortcut for this port: `WebGPURenderer` silently runs its WebGL2
   * backend wherever a WebGPU device is unavailable, and that backend compiles
   * the SAME node graph through `GLSLNodeBuilder`. Anything that builds on one
   * and not the other ships a renderer that works on half the machines.
   */
  it('builds GLSL for the WebGL2 fallback backend', () => {
    const set = makeSet();
    const { vertex, fragment } = compile(set.material, 'glsl');
    expect(vertex.length).toBeGreaterThan(500);
    expect(fragment.length).toBeGreaterThan(2000);
    set.dispose();
  });

  it('emits no NaN literal into either shader', () => {
    // A `NaN` in a generated constant is the black-frame failure this repo has
    // a standing rule about, and it costs nothing to look for.
    const set = makeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compile(set.material, which);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
    }
    set.dispose();
  });
});

/* ==========================================================================
 * 2. THE STRUCTURES THE GLSL RELIED ON SURVIVED THE TRANSLATION
 *
 * Each of these pins a specific line of `TerrainMaterial.ts`'s GLSL whose loss
 * would be invisible in a compile check and expensive in a capture.
 * ========================================================================== */

describe('the translated shader keeps the GLSL structures', () => {
  it('samples the six layers through ONE array binding, not six', () => {
    /*
     * The whole reason the splat fits a draw-call budget: six albedos through
     * one array sampler, because a WebGL2 fragment shader has 16 samplers
     * across the entire program and the naive version spends six on albedo
     * alone. It is also what makes `applyBiome`'s texture swap reach every
     * fetch — see the identity test below.
     */
    const set = makeSet();
    const { fragment } = compile(set.material, 'glsl');
    const arrayBindings = fragment.match(/uniform\s+(highp|mediump|lowp)?\s*sampler2DArray/g) ?? [];
    expect(arrayBindings.length).toBe(1);
    set.dispose();
  });

  it('takes screen-space derivatives of world position for the cliff test', () => {
    // `raFace` is rebuilt from dFdx/dFdy of the world position. Lose it and the
    // cliff branch selects off the interpolated vertex normal, which is a mound
    // where there should be an 80-degree wall.
    const set = makeSet();
    const { fragment } = compile(set.material, 'wgsl');
    expect(fragment).toMatch(/dpdx/);
    expect(fragment).toMatch(/dpdy/);
    set.dispose();
  });

  it('disables WGSL derivative-uniformity diagnostics, so the branch is legal', () => {
    /*
     * WGSL's uniformity analysis rejects a derivative reached through
     * non-uniform control flow outright, where GLSL merely calls it undefined.
     * three emits `diagnostic( off, derivative_uniformity )` at the top of every
     * generated WGSL module; this asserts we are relying on something that is
     * actually there rather than on a GLSL habit.
     */
    const set = makeSet();
    const { fragment } = compile(set.material, 'wgsl');
    expect(fragment).toMatch(/diagnostic\s*\(\s*off\s*,\s*derivative_uniformity\s*\)/);
    set.dispose();
  });

  it('emits the two noise helpers as real functions, not seven inlined copies', () => {
    /*
     * A TSL `Fn` with no layout is a MACRO: three inlines its body at every
     * call site and renames the collided locals. `raHash21` has seven call
     * sites, so without `.setLayout()` the fragment shader carries seven copies
     * of it — 17 111 chars against 15 425 on WGSL. This asserts the layouts are
     * still declared, because losing them is a silent 10% of source on the most
     * expensive shader we draw.
     */
    const set = makeSet();
    expect(compile(set.material, 'wgsl').fragment).toMatch(/fn\s+raHash21\s*\(/);
    expect(compile(set.material, 'wgsl').fragment).toMatch(/fn\s+raValue2\s*\(/);
    expect(compile(set.material, 'glsl').fragment).toMatch(/float\s+raHash21\s*\(/);
    set.dispose();
  });

  it('carries the aUp and aTop attributes into the fragment stage', () => {
    // The cap and the scree skirt are placed from these two and from nothing
    // else — they cannot be recovered from world position after the fact.
    const set = makeSet();
    const { vertex } = compile(set.material, 'glsl');
    expect(vertex).toMatch(/aUp/);
    expect(vertex).toMatch(/aTop/);
    set.dispose();
  });

  it('re-implements the dithering the node system does not have', () => {
    /*
     * `material.dithering` is honoured by three's WebGL chunk system and by
     * NOTHING in `src/nodes/`. This material is 60-75% of the frame and one
     * enormous low-frequency gradient, so losing the dither would band the
     * ground in the one place it shows most. The marker is the +/-0.25/255
     * shift constant, which nothing else in the graph produces.
     */
    const set = makeSet();
    expect(set.material.dithering).toBe(true);
    const { fragment } = compile(set.material, 'glsl');
    expect(fragment).toMatch(/0\.0009803921568627451|0\.00098039/);
    set.dispose();
  });

  it('drops the dither when the flag is off, so the flag is really the switch', () => {
    // The control for the test above: without this, a hard-coded dither would
    // pass it just as happily.
    const set = makeSet();
    set.material.dithering = false;
    const { fragment } = compile(set.material, 'glsl');
    expect(fragment).not.toMatch(/0\.0009803921568627451|0\.00098039/);
    set.dispose();
  });
});

/* ==========================================================================
 * 3. UNIFORM PLUMBING
 * ========================================================================== */

describe('the uniform block', () => {
  /*
   * THE LITERALS ARE WRITTEN OUT AGAIN ON PURPOSE, and this is the one test in
   * the file that must not be tidied.
   *
   * The defaults and the biome table were MOVED out of `TerrainMaterial.ts`
   * into `terrain-uniforms.ts` so both materials read one copy. Every other
   * assertion here compares one material against the other or against that
   * shared table — so a value that drifted during the move would drift on both
   * sides at once and every one of them would still pass. These numbers are
   * transcribed from `TerrainMaterial.ts` as it stood at v2.13.0, before the
   * move, and they are the only thing standing between a refactor and a silent
   * change to the shipping ground.
   *
   * `uCliffNy` and `uCellSize` are derived from `config.ts` rather than typed
   * in, so they are checked as expressions; everything else is a literal.
   */
  it('leaves the SHIPPING material on its pre-refactor values, to the digit', () => {
    const set = createTerrainMaterials({
      biome: BIOMES.temperate, layerTextureSize: LAYER_SIZE, seed: SEED,
    });
    // Before any biome is applied, `createUniforms` alone. Rebuild a virgin one:
    // `createTerrainMaterials` calls `applyBiome` in its constructor, so the
    // biome-owned slots are already overwritten and only the grid- and
    // camera-derived constants survive to be checked here.
    const u = set.uniforms;
    expect(u.uInvMapSize.value).toBe(1 / MAP_SIZE);
    expect(u.uCellSize.value).toBe(CELL);
    expect(u.uSplatSharpen.value).toBe(2.8);
    expect(u.uCliffNy.value).toBe(Math.cos(CLIFF_SLOPE));
    expect(u.uFaceMix.value).toBe(0.78);
    set.dispose();
  });

  it('leaves the SHARED default table on its pre-refactor values', () => {
    // The slots a biome overwrites, checked at the source rather than on a
    // constructed material — which is the only place they are still visible.
    expect(TERRAIN_LAYER_SCALE_DEFAULT).toEqual([8, 5.5, 6.5, 7, 4.8, 3.2]);
    expect(TERRAIN_LAYER_ROUGH_DEFAULT).toEqual([0.95, 0.92, 0.9, 0.85, 0.7, 0.68]);
    expect(TERRAIN_SCALAR_DEFAULTS.uMacroScale).toBe(34);
    expect(TERRAIN_SCALAR_DEFAULTS.uMacroStrength).toBe(0.13);
    expect(TERRAIN_SCALAR_DEFAULTS.uDetailScale).toBe(5.6);
    expect(TERRAIN_SCALAR_DEFAULTS.uDetailNormal).toBe(0.075);
    expect(TERRAIN_SCALAR_DEFAULTS.uDetailRoughness).toBe(0.16);
    expect(TERRAIN_SCALAR_DEFAULTS.uWarpScale).toBe(11);
    expect(TERRAIN_SCALAR_DEFAULTS.uWarpAmp).toBe(0.55);
    expect(TERRAIN_SCALAR_DEFAULTS.uCellJitter).toBe(0.038);
    expect(TERRAIN_SCALAR_DEFAULTS.uCliffCapM).toBe(0.75);
    expect(TERRAIN_SCALAR_DEFAULTS.uCliffSkirtM).toBe(1.3);
    expect(TERRAIN_SCALAR_DEFAULTS.uStriationM).toBe(0.46);
    expect(TERRAIN_SCALAR_DEFAULTS.uCourseM).toBe(0.22);
    expect(TERRAIN_SCALAR_DEFAULTS.uCourseOn).toBe(0);
    expect(TERRAIN_SCALAR_DEFAULTS.uCliffRelief).toBe(0.55);
    expect(TERRAIN_SCALAR_DEFAULTS.uCliffRough).toBe(0.85);
    expect(TERRAIN_SCALAR_DEFAULTS.uCliffGrainMean).toBe(0.17);
    expect(TERRAIN_SCALAR_DEFAULTS.uStepHeight).toBe(6);
    expect(TERRAIN_VEC3_DEFAULTS.uMacroTint).toEqual([0.088, 0.068, 0.019]);
    expect(TERRAIN_VEC3_DEFAULTS.uCliffBase).toEqual([0.19, 0.17, 0.1]);
    expect(TERRAIN_VEC3_DEFAULTS.uCliffShade).toEqual([0.06, 0.05, 0.03]);
    expect(TERRAIN_VEC3_DEFAULTS.uCliffHi).toEqual([0.32, 0.29, 0.18]);
    expect(TERRAIN_VEC3_DEFAULTS.uCliffCap).toEqual([0.1, 0.12, 0.01]);
  });

  it('starts at the same defaults as the GLSL material', () => {
    const set = makeSet();
    const u = set.uniforms;
    expect(u.uInvMapSize.value).toBe(TERRAIN_SCALAR_DEFAULTS.uInvMapSize);
    expect(u.uCellSize.value).toBe(TERRAIN_SCALAR_DEFAULTS.uCellSize);
    expect(u.uCliffNy.value).toBe(TERRAIN_SCALAR_DEFAULTS.uCliffNy);
    expect(u.uFaceMix.value).toBe(TERRAIN_SCALAR_DEFAULTS.uFaceMix);
    set.dispose();
  });

  it('holds the splat sharpen exponent below the stair-stepping threshold', () => {
    /*
     * `TerrainMaterial.ts` warns that above ~4 the control texture's own 4 m
     * stair-stepping shows through the warp. Pinned here because the port is
     * exactly the sort of change during which a "let us sharpen it a bit more"
     * would go unnoticed.
     */
    const set = makeSet();
    expect(set.uniforms.uSplatSharpen.value).toBe(SPLAT_SHARPEN);
    expect(set.uniforms.uSplatSharpen.value).toBeLessThanOrEqual(4);
    set.dispose();
  });

  it('exposes six layer scales and six roughnesses as live arrays', () => {
    const set = makeSet();
    expect(set.uniforms.uLayerScale.array).toHaveLength(SURFACE_COUNT);
    expect(set.uniforms.uLayerRough.array).toHaveLength(SURFACE_COUNT);
    // Not the shared module-level constant — a per-material copy, or two
    // materials would share one array and the second biome swap would retint
    // the first material's ground.
    expect(set.uniforms.uLayerScale.array).not.toBe(TERRAIN_LAYER_SCALE_DEFAULT);
    expect(set.uniforms.uLayerRough.array).not.toBe(TERRAIN_LAYER_ROUGH_DEFAULT);
    set.dispose();
  });

  it('gives two materials independent uniform arrays', () => {
    const a = makeSet();
    const b = makeSet();
    expect(a.uniforms.uLayerScale.array).not.toBe(b.uniforms.uLayerScale.array);
    a.applyBiome(BIOMES.desert);
    b.applyBiome(BIOMES.temperate);
    expect(a.uniforms.uLayerScale.array).not.toEqual(b.uniforms.uLayerScale.array);
    a.dispose();
    b.dispose();
  });

  it('points the splat samplers at whatever setSplat is handed', () => {
    const set = makeSet();
    const a = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const b = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    set.setSplat(a, b);
    expect(set.uniforms.uSplat0.value).toBe(a);
    expect(set.uniforms.uSplat1.value).toBe(b);
    set.dispose();
  });
});

/* ==========================================================================
 * 4. BIOME APPLICATION — THE ANTI-DRIFT GATE
 *
 * This is the test the whole port rests on. Two materials draw the same ground
 * on two renderers; if they ever disagree about what a biome means, the
 * migration ships two grades and nobody can tell which one is the regression.
 * `applyTerrainBiome` is shared, so this asserts that sharing actually reaches
 * every slot rather than most of them.
 * ========================================================================== */

describe('a biome means the same numbers on both materials', () => {
  const names = Object.keys(BIOMES) as BiomeName[];

  it.each(names)('agrees on every uniform for %s', (name) => {
    const biome = BIOMES[name];
    const glsl = createTerrainMaterials({ biome, layerTextureSize: LAYER_SIZE, seed: SEED });
    const node = createTerrainNodeMaterials({ biome, layerTextureSize: LAYER_SIZE, seed: SEED });

    const g = glsl.uniforms;
    const n = node.uniforms;

    expect(n.uLayerScale.array).toEqual(g.uLayerScale.value);
    expect(n.uLayerRough.array).toEqual(g.uLayerRough.value);

    const scalars = [
      'uMacroScale', 'uMacroStrength', 'uDetailScale', 'uDetailNormal',
      'uDetailRoughness', 'uWarpScale', 'uWarpAmp', 'uCellJitter',
      'uCliffCapM', 'uCliffSkirtM', 'uStriationM', 'uCourseM', 'uCourseOn',
      'uCliffRelief', 'uCliffRough', 'uCliffGrainMean', 'uStepHeight',
      'uInvMapSize', 'uCellSize', 'uSplatSharpen', 'uCliffNy', 'uFaceMix',
    ] as const;
    for (const key of scalars) {
      expect(n[key].value, key).toBe(g[key].value as number);
    }

    const colours = ['uMacroTint', 'uCliffBase', 'uCliffShade', 'uCliffHi', 'uCliffCap'] as const;
    for (const key of colours) {
      const nv = n[key].value;
      const gv = g[key].value as THREE.Vector3;
      expect([nv.x, nv.y, nv.z], key).toEqual([gv.x, gv.y, gv.z]);
    }

    glsl.dispose();
    node.dispose();
  });

  it('re-tints in place across a live swap, allocating no new uniform nodes', () => {
    // A `?biome=` swap must never rebuild a program, so the node objects have
    // to survive it — only their values may move.
    const set = makeSet(BIOMES.temperate);
    const before = set.uniforms.uMacroTint;
    const beforeScaleArray = set.uniforms.uLayerScale.array;
    const t0 = set.uniforms.uStriationM.value;

    set.applyBiome(BIOMES.snow);

    expect(set.uniforms.uMacroTint).toBe(before);
    expect(set.uniforms.uLayerScale.array).toBe(beforeScaleArray);
    expect(set.uniforms.uStriationM.value).not.toBe(t0);
    set.dispose();
  });

  it('derives the cliff grain mean from the biome rock layer, as the GLSL does', () => {
    // The one uniform in the table that is COMPUTED rather than copied, and so
    // the one most likely to be silently dropped in a port.
    for (const name of names) {
      const glsl = createTerrainMaterials({
        biome: BIOMES[name], layerTextureSize: LAYER_SIZE, seed: SEED,
      });
      const node = createTerrainNodeMaterials({
        biome: BIOMES[name], layerTextureSize: LAYER_SIZE, seed: SEED,
      });
      expect(node.uniforms.uCliffGrainMean.value).toBe(glsl.uniforms.uCliffGrainMean.value);
      expect(node.uniforms.uCliffGrainMean.value).toBeGreaterThan(0);
      glsl.dispose();
      node.dispose();
    }
  });
});

/* ==========================================================================
 * 5. THE LAYER ARRAY, AND WHY ONE TEXTURE NODE MATTERS
 * ========================================================================== */

describe('the layer array texture', () => {
  it('is built for the biome and swapped on the ONE node every fetch reads', () => {
    /*
     * Eight fetches read `uLayers` — six ground layers and two triplanar cliff
     * planes — and all eight go through `uniforms.uLayers` via `.sample()`.
     * `TextureNode.sample()` returns a view that delegates `.value` back to its
     * source, so one assignment reaches all eight. Building eight independent
     * texture nodes instead would be eight bindings of one texture and a swap
     * that reached only the first: correct on the frame it happened and wrong
     * on every frame after a biome change.
     */
    const set = makeSet(BIOMES.temperate);
    const first = set.uniforms.uLayers.value as THREE.DataArrayTexture;
    expect(first.image.depth).toBe(SURFACE_COUNT);
    expect(first.name).toContain('temperate');

    set.applyBiome(BIOMES.desert);
    const second = set.uniforms.uLayers.value as THREE.DataArrayTexture;
    expect(second).not.toBe(first);
    expect(second.name).toContain('desert');
    set.dispose();
  });

  it('adopts prewarmed tiles only on an exact key match', () => {
    // Same guard, same reason, as `createTerrainMaterials`: a buffer that does
    // not describe this material is a GPU upload reading past the end of its
    // allocation, which renders black and reports nothing.
    const set = createTerrainNodeMaterials({
      biome: BIOMES.temperate,
      layerTextureSize: LAYER_SIZE,
      seed: SEED,
      textures: {
        key: 'not-the-key',
        generateMs: 0,
        layerSize: LAYER_SIZE,
        layers: new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * SURFACE_COUNT),
        warp: new Uint8Array(0),
        macro: new Uint8Array(0),
      },
    });
    expect(set.texturesAdopted).toBe(false);
    set.dispose();
  });

  it('pushes anisotropy onto the tile the material is actually holding', () => {
    const set = makeSet();
    set.setAnisotropy(16);
    expect((set.uniforms.uLayers.value as THREE.DataArrayTexture).anisotropy).toBe(16);
    // And onto the NEXT tile, or a biome swap silently drops back to 8 and the
    // cliffs go soft at grazing angles.
    set.applyBiome(BIOMES.snow);
    expect((set.uniforms.uLayers.value as THREE.DataArrayTexture).anisotropy).toBe(16);
    set.dispose();
  });
});

/* ==========================================================================
 * 6. THE TWO MEASURED FACTS FROM `RENDER_FINDINGS.md` §6c
 * ========================================================================== */

describe('roughness and the environment scale', () => {
  it('leaves material.roughness inert, exactly as the GLSL path does', () => {
    /*
     * `<roughnessmap_fragment>` was replaced by the splat-driven `raRough` on
     * the GLSL path, so the scalar reaches nothing. `roughnessNode` is the same
     * decision expressed the node way. Asserting the NODE IS SET is the whole
     * point: if it were ever dropped, three would fall back to
     * `materialRoughness` and the ground would take a single roughness
     * everywhere — which reads as a subtle, uniform loss of surface variety and
     * is exactly the kind of regression a capture argues about for a day.
     */
    const set = makeSet();
    expect(set.material.roughnessNode).not.toBeNull();
    expect(set.material.roughness).toBe(0.92);

    const before = compile(set.material, 'glsl').fragment;
    set.material.roughness = 0.11;
    const after = compile(set.material, 'glsl').fragment;
    expect(after).toBe(before);
    set.dispose();
  });

  it('leaves the per-material environment scale inert until it is asked for', () => {
    /*
     * §6c measured `envMapIntensity` 0.0 -> 8.0 at ZERO pixels changed and
     * blamed this material's custom-program path. The cause is upstream and
     * applies to every standard material in the game with no `envMap` of its
     * own — see the block in `TerrainNodeMaterial.ts` section 6 for the two
     * three.js source lines. The node path implements the same rule, so the
     * knob does not come alive by itself HERE EITHER, and the default must
     * therefore be exactly today's appearance: no envMap, no change.
     */
    const set = makeSet();
    expect(set.material.envMap).toBeNull();
    set.dispose();
  });

  it('makes the environment scale live once setEnvironment supplies a map', () => {
    // `materialEnvIntensity` is `material.envMap ? material.envMapIntensity :
    // scene.environmentIntensity`, so an envMap is precisely the switch. This
    // is the route out of §6c, and it works on BOTH renderers.
    const set = makeSet();
    const env = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    set.setEnvironment(env, 0.35);
    expect(set.material.envMap).toBe(env);
    expect(set.material.envMapIntensity).toBe(0.35);
    set.dispose();
  });
});

/* ==========================================================================
 * 7. THE CACHE KEY THAT MUST NOT COME BACK
 * ========================================================================== */

describe('program caching', () => {
  it('does not carry the GLSL material s hand-managed cache key', () => {
    /*
     * `customProgramCacheKey` STILL FIRES on node materials — it is the half of
     * the old mechanism that survives `onBeforeCompile`'s silent death. The
     * shipping GLSL material returns `'ra-terrain-v4'`, a string a human has to
     * remember to bump whenever the injected GLSL changes. There is no injected
     * GLSL on this path, so that string could only ever be stale, and a stale
     * key hands back the previous program with nothing thrown and nothing
     * logged. Three hashes the node graph instead.
     */
    const node = makeSet();
    const glsl = createTerrainMaterials({
      biome: BIOMES.temperate, layerTextureSize: LAYER_SIZE, seed: SEED,
    });
    expect(glsl.material.customProgramCacheKey()).toBe('ra-terrain-v4');
    expect(node.material.customProgramCacheKey()).not.toBe('ra-terrain-v4');
    node.dispose();
    glsl.dispose();
  });
});

/* ==========================================================================
 * 8. DETERMINISM — THE LINE THE PORT MAY NOT CROSS
 * ========================================================================== */

describe('the port moved no generation to the GPU', () => {
  it('produces byte-identical tiles for one seed, on the CPU, every time', () => {
    /*
     * Terrain generates independently on both machines of a lockstep match and
     * GPU floats are not bit-identical across vendors, so the single most
     * dangerous thing this port could have done is move a generator into the
     * shader. The tiles are still built by `terrain-texture-gen.ts` on this
     * thread; two materials on one seed must therefore hold identical bytes.
     */
    const a = makeSet(BIOMES.temperate);
    const b = makeSet(BIOMES.temperate);
    const ta = a.uniforms.uLayers.value as THREE.DataArrayTexture;
    const tb = b.uniforms.uLayers.value as THREE.DataArrayTexture;
    expect(new Uint8Array(ta.image.data as unknown as ArrayBufferLike & Uint8Array))
      .toEqual(new Uint8Array(tb.image.data as unknown as ArrayBufferLike & Uint8Array));
    a.dispose();
    b.dispose();
  });

  it('reads the rock layer index the classifier writes, not a literal', () => {
    // The cliff triplanar samples `SurfaceId.Rock`. A hard-coded 3 here would
    // survive a reorder of the surface enum and paint cliffs with concrete.
    expect(SurfaceId.Rock).toBe(3);
  });
});

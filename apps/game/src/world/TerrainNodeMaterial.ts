/**
 * ============================================================================
 * VOLTMARCH — src/world/TerrainNodeMaterial.ts
 * ============================================================================
 * THE GROUND SHADER, AS A TSL NODE GRAPH. Stage C of
 * the WebGPU migration.
 *
 * `./TerrainMaterial.ts` is the shipping WebGL material: a
 * `MeshStandardMaterial` whose `onBeforeCompile` replaces four GLSL chunks.
 * This file draws the same ground for `WebGPURenderer` — on its WebGPU backend
 * and on its WebGL2 fallback, which are the same node path and both of which we
 * support. The two files are the SAME SHADER expressed twice, and they are
 * meant to be read side by side: every block below carries the name of the GLSL
 * it replaces.
 *
 * WHY A REWRITE AND NOT A PORT
 * ----------------------------
 * Node materials have no `onBeforeCompile` and no `#include` chunk
 * substitution. Measured on this tree: `onBeforeCompile` is called ZERO times
 * on a node material under `WebGPURenderer`, and it fails SILENTLY — no
 * warning, no error, the material simply renders stock. There is no escape
 * hatch. `wgslFn` is not one either: it links on the WebGPU backend and fails
 * on the WebGL2 fallback, where the WGSL source lands verbatim inside a GLSL
 * shader. A TSL graph is the only thing that compiles on both.
 *
 * THE STALE CACHE KEY IS A REAL TRAP, AND IT IS WHY THERE IS NO
 * `customProgramCacheKey` HERE
 * ------------------------------------------------------------------
 * `customProgramCacheKey` DOES still fire on node materials — it is the one
 * half of the old mechanism that survives. The shipping material returns the
 * hand-managed string `'ra-terrain-v3'`, bumped by hand with every edit to its
 * injected GLSL. Carrying that string over would key compiled programs on a
 * constant that no longer describes anything: the injected GLSL it was tracking
 * does not exist on this path, so the key could never go stale in a way anyone
 * would notice, and a future graph change would be served the previous program
 * with nothing thrown and nothing logged.
 *
 * So this material sets NO cache key. Three hashes the node graph itself, which
 * is strictly better than a string a human has to remember to bump — the defect
 * the comment on `'ra-terrain-v3'` exists to warn about is structurally absent
 * here. Do not add one back.
 *
 * WHAT IS DELIBERATELY IDENTICAL
 * ------------------------------
 *  - **`material.roughness` is INERT**, exactly as on the GLSL path and for the
 *    same reason: `roughnessNode` is the splat-blended `raRough`, so the scalar
 *    reaches nothing. That is by design (`RENDER_FINDINGS.md` §6c) and is
 *    pinned by this module's spec.
 *  - **The biome table is not duplicated.** Both materials call
 *    `applyTerrainBiome` from `./terrain-uniforms.ts` over the same `{ value }`
 *    slots, so a biome means the same numbers on both paths by construction
 *    rather than by two tables agreeing.
 *  - **Generation stays on the CPU.** Nothing here reads or reimplements
 *    `terrain-gen.ts`. This is the shader that DRAWS the heightfield; the
 *    heightfield itself is built identically on both lockstep clients and moving
 *    any of it to the GPU is a tick-zero desync, because GPU floats are not
 *    bit-identical across vendors.
 *
 * WHAT IS DELIBERATELY DIFFERENT, AND MEASURED
 * --------------------------------------------
 *  - **Terrain output dithering is available but disabled.** The old
 *    screen-coordinate hash covered 60-75% of every frame and resolved into
 *    visible horizontal rows on high-DPI canvases. The textured terrain does
 *    not need that global overlay; local sky-gradient dithering remains.
 *  - **`envMapIntensity`.** See section 6.
 *
 * NOTHING IN `src/` IMPORTS THIS YET, AND THAT IS CHECKED
 * ------------------------------------------------------
 * Verified on the shipped bundle: `MeshStandardNodeMaterial` and
 * `WGSLNodeBuilder` appear ZERO times in `dist/assets/*.js`, so `three/webgpu`
 * is not in the WebGL build at all and the shipping renderer is untouched at
 * runtime as well as in source.
 *
 * **Keep it that way when the seam wires this up: reach it through a DYNAMIC
 * import, behind `requestedBackend()`.** A static import from anything the main
 * chunk already pulls in drags the whole node system — compiler, both builders,
 * the lighting graph — into the bundle every WebGL player downloads, for a
 * renderer they will not run.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Fn, If, attribute, cameraViewMatrix, clamp, cos, cross, dot, float, floor, fract, int, max, min, mix,
  mod, normalize, positionWorld, normalWorldGeometry, pow, screenCoordinate, smoothstep, step,
  sin, texture, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { SURFACE_COUNT, SurfaceId, type BiomeDef } from './Biomes';
import {
  MACRO_N, WARP_N, buildLayerArrayBytes, buildLayerResponseArrayBytes,
  buildMacroBytes, buildWarpBytes,
  macroSeed, terrainTextureKey, warpSeed,
} from './terrain-texture-gen';
import {
  TERRAIN_LAYER_ROUGH_DEFAULT, TERRAIN_LAYER_SCALE_DEFAULT,
  TERRAIN_SCALAR_DEFAULTS, TERRAIN_VEC3_DEFAULTS,
  applyTerrainBiome, type TerrainBiomeSink,
} from './terrain-uniforms';
import type { CreateTerrainMaterialOptions } from './TerrainMaterial';
import {
  TERRAIN_DETAIL_ROUGHNESS, TERRAIN_DETAIL_STRENGTH, TERRAIN_DETAIL_TILE_METRES,
  createTerrainDetailMask,
} from './terrain-detail-mask';
import type { SurfaceEnvironmentState } from './surface-environment';

/**
 * TSL node types, named once so the shader below reads as shader code.
 *
 * `@types/three` types every node by its GLSL/WGSL type, which is genuinely
 * useful — `vec2` where the shader wants a `vec3` is a compile error here
 * rather than a wrong picture — so these are aliases, not escape hatches.
 */
type FloatN = Node<'float'>;
type Vec2N = Node<'vec2'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;
type BoolN = Node<'bool'>;

/* ==========================================================================
 * 1. THE UNIFORM BLOCK
 *
 * One TSL `uniform()` per GLSL uniform, same names, same defaults. A
 * `UniformNode` is `{ value }` just like a `THREE.IUniform`, which is what lets
 * `applyTerrainBiome` write to both materials without an adapter.
 *
 * The two SIX-ELEMENT arrays are the exception. `uniformArray` keeps its JS
 * array on `.array` and leaves `.value` null, so the biome sink is handed
 * `.array` directly. That array is mutated in place and never replaced — the
 * node holds the reference and re-uploads from it.
 * ========================================================================== */

function v3(c: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(c[0], c[1], c[2]);
}

/**
 * Build the uniform nodes. Same names and same defaults as
 * `TerrainMaterial.ts`'s `createUniforms`, reading the same table.
 *
 * The five texture nodes are seeded with the stand-ins from section 2; the real
 * textures are swapped onto `.value` before anything renders.
 */
function createUniformNodes(
  warp: THREE.DataTexture, macro: THREE.DataTexture,
  terrainDetail: THREE.Texture,
  layersStandIn: THREE.DataArrayTexture,
  responsesStandIn: THREE.DataArrayTexture,
  splat0StandIn: THREE.DataTexture, splat1StandIn: THREE.DataTexture,
) {
  const S = TERRAIN_SCALAR_DEFAULTS;
  return {
    uLayers: texture(layersStandIn),
    uResponses: texture(responsesStandIn),
    uSplat0: texture(splat0StandIn),
    uSplat1: texture(splat1StandIn),
    uWarp: texture(warp),
    uMacro: texture(macro),
    uTerrainDetail: texture(terrainDetail),

    uLayerScale: uniformArray<'float'>(TERRAIN_LAYER_SCALE_DEFAULT.slice(), 'float'),
    uLayerRough: uniformArray<'float'>(TERRAIN_LAYER_ROUGH_DEFAULT.slice(), 'float'),

    uInvMapSize: uniform(S.uInvMapSize),
    uMacroScale: uniform(S.uMacroScale),
    uMacroStrength: uniform(S.uMacroStrength),
    uMacroTint: uniform(v3(TERRAIN_VEC3_DEFAULTS.uMacroTint)),
    uTerrainDetailTileM: uniform(TERRAIN_DETAIL_TILE_METRES),
    uTerrainDetailStrength: uniform(TERRAIN_DETAIL_STRENGTH),
    uTerrainDetailRoughness: uniform(TERRAIN_DETAIL_ROUGHNESS),
    uWarpScale: uniform(S.uWarpScale),
    uWarpAmp: uniform(S.uWarpAmp),
    uCellSize: uniform(S.uCellSize),
    uCellJitter: uniform(S.uCellJitter),
    uSplatSharpen: uniform(S.uSplatSharpen),
    uSurfaceEnvironment: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // shoreline wetness, salt exposure, snow contamination, reserved.
    uSurfaceContext: uniform(new THREE.Vector4(0, 0, 0, 0)),

    uCliffNy: uniform(S.uCliffNy),
    uCliffBase: uniform(v3(TERRAIN_VEC3_DEFAULTS.uCliffBase)),
    uCliffShade: uniform(v3(TERRAIN_VEC3_DEFAULTS.uCliffShade)),
    uCliffHi: uniform(v3(TERRAIN_VEC3_DEFAULTS.uCliffHi)),
    uCliffCap: uniform(v3(TERRAIN_VEC3_DEFAULTS.uCliffCap)),
    uCliffCapM: uniform(S.uCliffCapM),
    uCliffSkirtM: uniform(S.uCliffSkirtM),
    uStriationM: uniform(S.uStriationM),
    uCourseM: uniform(S.uCourseM),
    uCourseOn: uniform(S.uCourseOn),
    uCliffRelief: uniform(S.uCliffRelief),
    uCliffRough: uniform(S.uCliffRough),
    uCliffGrainMean: uniform(S.uCliffGrainMean),
    uStepHeight: uniform(S.uStepHeight),
    uFaceMix: uniform(S.uFaceMix),
  };
}

/**
 * The live uniform block, DERIVED from the factory rather than declared beside
 * it. `uniform()` in `@types/three` is a 20-overload table that resolves the
 * exact node type per value — hand-writing this interface throws all of that
 * away and lands every field on `UniformNode<unknown, unknown>`, which then
 * type-errors at the first `.add()` in the shader. Inference keeps the precise
 * types and cannot drift from the factory.
 */
export type TerrainNodeUniforms = ReturnType<typeof createUniformNodes>;

/* ==========================================================================
 * 2. PLACEHOLDER TEXTURES
 *
 * A TSL `texture()` node needs a Texture at CONSTRUCTION time — its sampler
 * type is read off the value when the graph is generated. The splat control
 * textures arrive later, from `setSplat`, and the layer array is built by the
 * first `applyBiome`, so the nodes are seeded with 1-texel stand-ins and their
 * `.value` is swapped before anything renders.
 *
 * THE STAND-IN'S SHAPE MATTERS AND ITS CONTENTS DO NOT. A `DataArrayTexture`
 * stand-in makes the node emit an array sampler; a plain `DataTexture` makes it
 * emit a 2D one. Get that wrong and the swap produces a sampler-type mismatch
 * at compile time rather than a wrong picture, which is the good failure — but
 * it is still a failure, so they are built to match here.
 * ========================================================================== */

function placeholder2D(name: string): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function placeholderArray(name: string, srgb = true): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(new Uint8Array(4 * SURFACE_COUNT), 1, 1, SURFACE_COUNT);
  tex.name = name;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Wrap the warp bytes. Mipmaps are on deliberately: a warp that aliases at
 * distance is a boundary that crawls when the camera pans.
 */
function warpTexture(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, WARP_N, WARP_N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'terrain.warp';
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Wrap the macro bytes. */
function macroTexture(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, MACRO_N, MACRO_N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'terrain.macro';
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Wrap six packed layers as one array texture.
 *
 * `SRGBColorSpace` gets the hardware decode — `rgba8unorm-srgb` on WebGPU,
 * `SRGB8_ALPHA8` on WebGL2 — rather than six shader pows per fragment.
 */
function layerArrayTexture(
  data: Uint8Array, size: number, biomeKey: string,
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, SURFACE_COUNT);
  tex.name = `terrain.layers.${biomeKey}`;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Linear normal XY / roughness delta / cavity array. */
function responseArrayTexture(
  data: Uint8Array, size: number, biomeKey: string,
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, SURFACE_COUNT);
  tex.name = `terrain.responses.${biomeKey}`;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 3. THE SHADER — TSL translation of `FRAG_COMMON`
 *
 * `.setLayout()` IS LOAD-BEARING AND A BARE `Fn` IS NOT A FUNCTION. A TSL `Fn`
 * with no layout is INLINED at every call site — it is a macro, not a callable.
 * `raHash21` has seven call sites (four inside `raValue2`, plus the striation
 * band, the running-bond brick and the per-cell jitter), and without a layout
 * three emitted its body seven times and renamed the collided locals `p3_1`
 * through `p3_6` on the way past. Declaring the layout makes it a real function
 * in both languages, which is what the GLSL original had.
 *
 * Measured on the temperate biome, fragment stage:
 *
 *     bare Fn      WGSL 17 111 chars   GLSL 16 773
 *     setLayout    WGSL 15 425 chars   GLSL 15 465      (-9.9% / -7.8%)
 *
 * Source length is not instruction count and a driver will inline a six-op hash
 * whatever we do, so this is not claimed as a frame-time win. It is claimed as
 * the structure the GLSL had, restored, on the single most expensive shader we
 * draw — and it is cheap.
 * ========================================================================== */

/**
 * Hash / value noise. Terrain detail that costs a texture fetch is terrain
 * detail we cannot afford six times over, so the cheap stuff lives in ALU.
 *
 * `vec3( p.xyx )` in the GLSL is `(p.x, p.y, p.x)` — written out here because
 * the swizzle is easy to misread as `p.xyz`.
 */
const raHash21 = Fn(([p]: [Vec2N]) => {
  const p3 = vec3(p.x, p.y, p.x).mul(0.1031).fract().toVar('p3');
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return p3.x.add(p3.y).mul(p3.z).fract();
}).setLayout({ name: 'raHash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const raValue2 = Fn(([p]: [Vec2N]) => {
  const i = floor(p).toVar('i');
  const f = fract(p).toVar('f');
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  const a = raHash21(i);
  const b = raHash21(i.add(vec2(1.0, 0.0)));
  const c = raHash21(i.add(vec2(0.0, 1.0)));
  const d = raHash21(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}).setLayout({ name: 'raValue2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/* ==========================================================================
 * 3b. DITHERING — A GAP IN THE NODE SYSTEM, RE-IMPLEMENTED
 *
 * `material.dithering` is honoured by three's WebGL chunk system and by nothing
 * else: `dithering_pars_fragment.glsl.js` is its ONLY implementation in the
 * whole library and no node in `src/nodes/` reads the flag. Set it on a node
 * material and it silently does nothing.
 *
 * That matters here more than anywhere. The ground is 60-75% of the frame, it
 * is one enormous low-frequency gradient, and 8-bit banding across it is
 * exactly what the flag exists to break up. Dropping it would make the two
 * renders differ in the one place a difference is most visible, for no reason
 * except that a feature did not get ported.
 *
 * So this is three's own algorithm, node for node — same `rand`, same
 * `+/-0.25/255` per-channel shift, same `mix` over the grid position. The one
 * substitution is `gl_FragCoord.xy` -> `screenCoordinate`, which is the same
 * quantity on both backends.
 * ========================================================================== */

/** three's `rand( vec2 )` from `common.glsl.js`. */
const raRand = Fn(([uv]: [Vec2N]) => {
  const a = float(12.9898);
  const b = float(78.233);
  const c = float(43758.5453);
  const dt = dot(uv.xy, vec2(a, b));
  const sn = mod(dt, 3.14);
  return fract(sn.sin().mul(c));
});

/**
 * `MeshStandardNodeMaterial` plus the dithering three forgot to port.
 *
 * `setupOutput` is the documented extension point for exactly this — see the
 * worked example in `NodeMaterial.js`. Calling `super` LAST keeps fog and
 * premultiplied alpha in their original order relative to us, which is what the
 * GLSL chunk order does: `<dithering_fragment>` runs after `<fog_fragment>`.
 */
class TerrainStandardNodeMaterial extends MeshStandardNodeMaterial {
  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    const out = super.setupOutput(builder, outputNode) as Vec4N;
    if (this.dithering !== true) return out;

    const gridPosition = raRand(screenCoordinate.xy);
    const shift = vec3(0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0);
    const ditherShift = mix(shift.mul(2.0), shift.mul(-2.0), gridPosition);
    return vec4(out.rgb.add(ditherShift), out.a);
  }
}

/* ==========================================================================
 * 4. THE MATERIAL
 * ========================================================================== */

export interface TerrainNodeMaterialSet {
  /** The one terrain program. Ground and cliff both live in here. */
  readonly material: MeshStandardNodeMaterial;
  /** Live uniform nodes; mutate `.value`, never replace the node. */
  readonly uniforms: TerrainNodeUniforms;
  /** True when the tiles came from `options.textures`. For the boot log only. */
  readonly texturesAdopted: boolean;
  /** Point the splat samplers at the terrain's control textures. */
  setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void;
  /** Re-tint for a biome. Uniforms + the layer array only; no recompile. */
  applyBiome(biome: BiomeDef): void;
  /** Anisotropy is a renderer capability, so it is pushed in from outside. */
  setAnisotropy(a: number): void;
  /**
   * Make the per-material environment scale LIVE. See section 6 — this is the
   * lever `RENDER_FINDINGS.md` §6c went looking for and could not find, and it
   * is INERT until this is called, so the default appearance is unchanged.
   */
  setEnvironment(env: THREE.Texture | null, intensity: number): void;
  /** Copy the shared weather scalars into the retained packed uniform. */
  setSurfaceEnvironment(state: SurfaceEnvironmentState): void;
  dispose(): void;
}

export function createTerrainNodeMaterials(
  options: CreateTerrainMaterialOptions,
): TerrainNodeMaterialSet {
  /*
   * ADOPT OR GENERATE — the same key comparison, for the same reason, as
   * `createTerrainMaterials`. `terrainTextureKey` is the ONE definition of
   * "these bytes describe this material" and both callers use it, so a mismatch
   * cannot be papered over by two comments that agree. The lengths are checked
   * too: a `layers` buffer one byte short is not an exception, it is a texture
   * upload reading past the end of its buffer, which renders as a black frame
   * and reports nothing.
   */
  const layerSize = options.layerTextureSize;
  const pre = options.textures ?? null;
  const adopted = pre !== null
    && pre.key === terrainTextureKey(options.biome.key, layerSize, options.seed)
    && pre.layerSize === layerSize
    && pre.layers.length === layerSize * layerSize * 4 * SURFACE_COUNT
    && pre.responses instanceof Uint8Array
    && pre.responses.length === layerSize * layerSize * 4 * SURFACE_COUNT
    && pre.warp.length === WARP_N * WARP_N * 4
    && pre.macro.length === MACRO_N * MACRO_N * 4;

  const warp = warpTexture(adopted && pre !== null ? pre.warp : buildWarpBytes(warpSeed(options.seed)));
  const macro = macroTexture(adopted && pre !== null ? pre.macro : buildMacroBytes(macroSeed(options.seed)));
  const terrainDetail = createTerrainDetailMask();

  const layersPlaceholder = placeholderArray('terrain.layers.placeholder');
  const responsesPlaceholder = placeholderArray('terrain.responses.placeholder', false);
  const splat0Placeholder = placeholder2D('terrain.splatA.placeholder');
  const splat1Placeholder = placeholder2D('terrain.splatB.placeholder');

  const uniforms = createUniformNodes(
    warp, macro, terrainDetail, layersPlaceholder, responsesPlaceholder,
    splat0Placeholder, splat1Placeholder,
  );
  const U = uniforms;

  /* ----------------------------------------------------------------------
   * 4a. VERTEX SIDE — the `VERT_COMMON` / `VERT_BODY` replacement.
   *
   * There is no `positionNode`. The GLSL's `<begin_vertex>` replacement only
   * READ `transformed`; it never moved a vertex. So the vertex position is
   * stock and the whole vertex half of the old injection is these two
   * varyings plus two TSL built-ins.
   *
   * `positionWorld` is `modelMatrix * transformed` and `normalWorldGeometry`
   * is the interpolated vertex normal in world space — exactly `vRaWorld` and
   * `vRaWorldN`, already interpolated, already normalised.
   *
   * `aUp` / `aTop` are the vertex's metres above the foot and below the lip of
   * its local terrace face, over the step height. The cliff model needs both to
   * place the scree skirt and the coping cap, and neither can be recovered from
   * world position after the fact.
   * -------------------------------------------------------------------- */
  const vRaUp = varying(attribute<'float'>('aUp', 'float'), 'vRaUp');
  const vRaTop = varying(attribute<'float'>('aTop', 'float'), 'vRaTop');

  /* ----------------------------------------------------------------------
   * 4b. THE FACE NORMAL AND THE CLIFF TEST — head of `FRAG_SURFACE`.
   *
   * The branch condition comes from the TRUE face normal, rebuilt from
   * screen-space derivatives, against the same CLIFF_SLOPE threshold the nav
   * grid uses — so a face a unit cannot climb is exactly a face that renders as
   * rock. The derivatives are taken BEFORE the branch: `dFdx` inside
   * non-uniform control flow is undefined in GLSL, and WGSL's uniformity
   * analysis is stricter still.
   *
   * TWO INDEPENDENT GUARDS, because either alone leaves a hole. On a large flat
   * plain seen at a grazing angle the two derivatives grow long and nearly
   * parallel, their cross product collapses toward zero and `normalize` returns
   * numerical noise; the cliff test then flips at random over WHOLE REGIONS.
   *   1. a degenerate cross product falls back to the interpolated vertex
   *      normal, which is always defined;
   *   2. the cliff branch additionally requires the VERTEX normal to be steep.
   *      A plateau's vertex normal is ~+Y and a wall's is ~horizontal, so this
   *      rejects nothing real while making a derivative glitch unable to paint
   *      flat ground as rock on its own.
   *
   * This is computed by a shared `Fn` because BOTH the colour graph and the
   * normal graph need it, and `normalNode` is built in its own sub-build where
   * a value from the colour flow is not reachable. It is pure ALU — no texture
   * fetch — so the duplication is a handful of instructions, not a second pass
   * over the splat.
   * -------------------------------------------------------------------- */
  const raFaceNormal = Fn(() => {
    const raSmoothN = normalize(normalWorldGeometry).toVar('raSmoothN');
    const raDx = positionWorld.dFdx().toVar('raDx');
    const raDy = positionWorld.dFdy().toVar('raDy');
    const raCross = cross(raDx, raDy).toVar('raCross');
    const raCrossLen = raCross.length().toVar('raCrossLen');
    const raFace = raCross.div(max(raCrossLen, 1e-7)).toVar('raFace');
    // `raCrossLen > 1e-7 ? raCross / raCrossLen : raSmoothN`, branch-free.
    raFace.assign(raCrossLen.greaterThan(1e-7).select(raFace, raSmoothN));
    // `if ( dot( raFace, raSmoothN ) < 0.0 ) raFace = -raFace;`
    raFace.assign(dot(raFace, raSmoothN).lessThan(0.0).select(raFace.negate(), raFace));
    return raFace;
  });

  const raIsCliffOf = (raFace: Vec3N): BoolN => {
    const raSmoothN = normalize(normalWorldGeometry);
    return raFace.y.lessThan(U.uCliffNy).and(raSmoothN.y.lessThan(U.uCliffNy.add(0.18)));
  };

  /* ----------------------------------------------------------------------
   * 4c. THE REGIONAL LAYER — `raMacro`.
   *
   * The 28-38 m regional layer, shared by ground AND cliff so a rock face and
   * the dirt at its foot never disagree about which part of the map they are
   * in.
   * -------------------------------------------------------------------- */
  const raMacro = (col: Vec3N, wxz: Vec2N): Vec3N => {
    const m = U.uMacro.sample(wxz.div(U.uMacroScale)).rgb.toVar('raMacroM');
    const lit = col.mul(float(1.0).add(m.r.sub(0.5).mul(2.0).mul(U.uMacroStrength)));
    return mix(lit, U.uMacroTint, clamp(float(0.55).sub(m.g).mul(U.uMacroStrength).mul(1.5), 0.0, 1.0));
  };

  /**
   * Continuous terrain-space ageing, byte-for-byte in intent with
   * `TerrainMaterial.raGroundAge`: directional dust, sparse crooked crack
   * segments, and meso-scale grit. There is no radial mask and no added sampler.
   */
  const raGroundAge = (wxz: Vec2N, pixelM: FloatN): Vec3N => {
    const broad = raValue2(wxz.div(18.0).add(vec2(13.7, 4.2))).toVar('raAgeBroad');
    const meso = raValue2(wxz.div(5.5).add(vec2(31.0, 17.0))).toVar('raAgeMeso');
    const dust = smoothstep(0.36, 0.76, broad).mul(float(0.42).add(meso.mul(0.58)))
      .toVar('raAgeDust');

    const sweepA = fract(wxz.x.add(wxz.y.mul(0.34)).div(11.0)
      .add(broad.sub(0.5).mul(0.82))).sub(0.5).abs().toVar('raAgeSweepA');
    const sweepB = fract(wxz.y.sub(wxz.x.mul(0.21)).div(17.0)
      .add(meso.sub(0.5).mul(0.55))).sub(0.5).abs().toVar('raAgeSweepB');
    const sweep = smoothstep(0.06, 0.38, sweepA).oneMinus().mul(0.72)
      .add(smoothstep(0.05, 0.32, sweepB).oneMinus().mul(0.28))
      .toVar('raAgeSweep');
    dust.assign(clamp(dust.mul(0.84).add(sweep.mul(float(0.06).add(meso.mul(0.10)))), 0.0, 1.0));

    const crackCellM = 4.2;
    const cell = floor(wxz.div(crackCellM)).toVar('raAgeCell');
    const local = fract(wxz.div(crackCellM)).sub(0.5).toVar('raAgeLocal');
    const h = raHash21(cell.add(vec2(7.0, 19.0))).toVar('raAgeHash');
    const angle = h.mul(6.2831853).toVar('raAgeAngle');
    const dir = vec2(cos(angle), sin(angle)).toVar('raAgeDir');
    const side = vec2(dir.y.negate(), dir.x).toVar('raAgeSide');
    const along = dot(local, dir).toVar('raAgeAlong');
    const across = dot(local, side).add(sin(along.mul(17.0).add(h.mul(8.0))).mul(0.025))
      .toVar('raAgeAcross');
    // Coverage AA keeps one terrain-space crack stable. Multiplying the whole
    // feature by a camera-distance factor made it pulse during pans.
    const crackAA = clamp(pixelM.div(crackCellM).mul(0.75), 0.0015, 0.045)
      .toVar('raAgeCrackAA');
    const mainLine = smoothstep(float(0.008).sub(crackAA), float(0.008).add(crackAA),
      across.abs()).oneMinus()
      .mul(smoothstep(float(0.17).sub(crackAA), float(0.17).add(crackAA),
        along.abs()).oneMinus()).toVar('raAgeMain');

    const turn = step(0.5, h).mul(2.0).sub(1.0).mul(0.88).toVar('raAgeTurn');
    const branchDir = vec2(cos(angle.add(turn)), sin(angle.add(turn))).toVar('raAgeBranchDir');
    const branchSide = vec2(branchDir.y.negate(), branchDir.x).toVar('raAgeBranchSide');
    const branchP = local.sub(dir.mul(0.04)).toVar('raAgeBranchP');
    const branchAlong = dot(branchP, branchDir).toVar('raAgeBranchAlong');
    const branchAcross = dot(branchP, branchSide).toVar('raAgeBranchAcross');
    const branch = smoothstep(float(0.007).sub(crackAA), float(0.007).add(crackAA),
      branchAcross.abs()).oneMinus()
      .mul(smoothstep(float(0.115).sub(crackAA), float(0.115).add(crackAA),
        branchAlong.abs()).oneMinus())
      .mul(step(0.88, raHash21(cell.add(vec2(29.0, 3.0)))))
      .toVar('raAgeBranch');
    const crack = max(mainLine, branch)
      .mul(step(0.87, raHash21(cell.add(vec2(2.0, 41.0)))))
      .toVar('raAgeCrack');

    const gritFine = raValue2(wxz.div(4.8).add(vec2(9.0, 37.0))).toVar('raAgeGritFine');
    const gritWide = raValue2(vec2(wxz.y, wxz.x.negate()).div(8.5).add(vec2(23.0, 6.0)))
      .toVar('raAgeGritWide');
    const grit = smoothstep(0.40, 0.76, gritFine.mul(0.68).add(gritWide.mul(0.32)))
      .mul(float(0.34).add(broad.mul(0.46))).toVar('raAgeGrit');
    return vec3(dust, crack, grit);
  };

  /* ----------------------------------------------------------------------
   * 4d. THE STRIATION BASIS — the ALU shared by the cliff's colour and its
   * normal. Returns `vec3( raHoriz, raBand, raSub )`.
   *
   * Sharpening the triplanar weights so one axis dominates everywhere except a
   * narrow band around the 45 degree faces is what keeps the ANALYTIC striation
   * at a true 0.46 m wavelength instead of stretching it by up to sqrt(2).
   * -------------------------------------------------------------------- */
  const raStriaBasis = (raFace: Vec3N): Vec3N => {
    const raP = positionWorld;
    const raWx = raFace.x.abs().toVar('raWx');
    const raWz = raFace.z.abs().toVar('raWz');
    const raWs = max(raWx.add(raWz), 1e-4).toVar('raWs');
    raWx.divAssign(raWs);
    raWz.divAssign(raWs);
    const raSx = raWx.mul(raWx).mul(raWx).toVar('raSx');
    const raSz = raWz.mul(raWz).mul(raWz).toVar('raSz');
    const raHoriz = raP.z.mul(raSx).add(raP.x.mul(raSz))
      .div(max(raSx.add(raSz), 1e-4)).toVar('raHoriz');
    const raStria = raHoriz.div(U.uStriationM).toVar('raStria');
    const raBand = raHash21(vec2(floor(raStria), 3.7)).toVar('raBand');
    const raSub = fract(raStria).toVar('raSub');
    return vec3(raHoriz, raBand, raSub);
  };

  /* ----------------------------------------------------------------------
   * 4e. THE SURFACE — the `<map_fragment>` and `<roughnessmap_fragment>`
   * replacements, as `vec4( colour.rgb, roughness )`.
   *
   * ONE MATERIAL, TWO SHADING MODELS. A terrace face is not the flat-ground
   * shader with a different texture, and the obvious implementation — two
   * materials over two index groups per chunk — was measured at 84 draw calls
   * for terrain alone. So the two models live in ONE program behind a
   * per-TRIANGLE branch: one draw per chunk, and no runtime cost, because the
   * branch condition is constant across a triangle and therefore perfectly
   * coherent inside every warp that is not straddling a terrace lip.
   * -------------------------------------------------------------------- */
  const raSurface = Fn(() => {
    const raXZ = positionWorld.xz.toVar('raXZ');
    // World metres covered by one fragment. This drives crack-edge coverage,
    // never whole-feature opacity. Keep the derivatives outside the
    // cliff branch: WGSL's uniformity rules are stricter than GLSL's undefined
    // behaviour here, and both backends need the same stable result.
    const raPixelM = max(
      positionWorld.dFdx().xz.length(),
      positionWorld.dFdy().xz.length(),
    ).toVar('raPixelM');
    const raFace = raFaceNormal().toVar('raFaceS');

    const raCol = vec3(0.5).toVar('raCol');
    const raRough = float(0.9).toVar('raRough');

    If(raIsCliffOf(raFace), () => {

      const raP = positionWorld;
      const basis = raStriaBasis(raFace).toVar('raBasis');
      const raHoriz = basis.x;
      const raBand = basis.y;
      const raSub = basis.z;

      /*
       * TRUE two-plane triplanar. The obvious shortcut — blend the COORDINATE
       * and sample once — destroys the texture's screen-space derivatives
       * wherever the blend weights cross, and the GPU answers with a
       * near-infinite mip level and a face full of diagonal mush. Sample both
       * planes, blend the RESULT.
       *
       * 1.8x the flat-ground tiling: a terrace face is seen at a grazing angle
       * from a 39 degree camera, so its vertical texel density is several times
       * the ground's, and sampling it at the ground's scale is a guaranteed
       * moire.
       */
      const raWx = raFace.x.abs().toVar('raWxC');
      const raWz = raFace.z.abs().toVar('raWzC');
      const raWs = max(raWx.add(raWz), 1e-4).toVar('raWsC');
      raWx.divAssign(raWs);
      raWz.divAssign(raWs);

      const raCliffScale = U.uLayerScale.element(SurfaceId.Rock).mul(1.8).toVar('raCliffScale');
      const raGrainC = U.uLayers.sample(vec2(raP.z, raP.y.negate()).div(raCliffScale))
        .depth(int(SurfaceId.Rock)).rgb.mul(raWx)
        .add(U.uLayers.sample(vec2(raP.x, raP.y.negate()).div(raCliffScale))
          .depth(int(SurfaceId.Rock)).rgb.mul(raWz))
        .toVar('raGrainC');

      // Vertical striation: one random tone per stria plus a soft groove.
      const raGroove = float(1.0).sub(raSub.mul(2.0).sub(1.0).abs()).toVar('raGroove');
      const raErode = raValue2(vec2(raHoriz.mul(1.35), raP.y.mul(0.8))).toVar('raErode');

      const raRock = mix(U.uCliffShade, U.uCliffBase,
        clamp(raBand.mul(0.66).add(raErode.mul(0.44)), 0.0, 1.0)).toVar('raRock');
      raRock.assign(mix(raRock, U.uCliffHi,
        smoothstep(0.62, 1.0, raGroove).mul(float(0.14).add(raBand.mul(0.24)))));

      // Fine grain as a LUMINANCE modulation, normalised by the biome's own
      // rock luminance so the authored cliff colour survives the multiply.
      const raGrainL = dot(raGrainC, vec3(0.2126, 0.7152, 0.0722))
        .div(max(U.uCliffGrainMean, 1e-4)).toVar('raGrainL');
      raRock.mulAssign(mix(1.0, clamp(raGrainL, 0.55, 1.45), 0.38));

      // Retaining-wall mode: horizontal mortar courses + running-bond jitter.
      const raCourseF = raP.y.div(max(U.uCourseM, 0.001)).toVar('raCourseF');
      const raCoursePhase = fract(raCourseF).toVar('raCoursePhase');
      /*
       * `smoothstep( 0.12, 0.0, x )` in the GLSL — a DESCENDING ramp, which
       * both the GLSL and the WGSL specs leave undefined for edge0 >= edge1
       * even though every implementation evaluates the same polynomial. Written
       * as the ascending form and inverted, which is exactly equal because
       * S(1-t) === 1-S(t) for 3t^2-2t^3, and is defined behaviour on both
       * backends.
       */
      const raJoint = smoothstep(0.0, 0.12, min(raCoursePhase, raCoursePhase.oneMinus()))
        .oneMinus().toVar('raJoint');
      const raRow = floor(raCourseF).toVar('raRow');
      const raBrick = raHash21(vec2(
        floor(raHoriz.div(U.uStriationM.mul(2.0)).add(mod(raRow, 2.0).mul(0.5))), raRow,
      )).toVar('raBrick');
      raRock.mulAssign(mix(1.0,
        raJoint.mul(0.42).oneMinus().mul(float(0.88).add(raBrick.mul(0.24))), U.uCourseOn));

      /*
       * The cap. On natural rock this is the overhung soil/grass lip; on a
       * retaining wall it is the grey concrete coping. Either way it is THE
       * detail that stops the top edge reading as a cut polygon (bible 6.4).
       *
       * `vRaTop` is metres below the LOCAL top of this face over the step
       * height: measured from the geometry, not inferred from height modulo a
       * tier, because the +/-0.6 m swell makes a modulo wrap unpredictably and
       * the cap then breaks into disconnected slabs instead of a continuous
       * band.
       */
      const raBelowTop = vRaTop.mul(U.uStepHeight).toVar('raBelowTop');
      const raCap = smoothstep(0.0, U.uCliffCapM, raBelowTop).oneMinus().toVar('raCap');
      raRock.assign(mix(raRock, U.uCliffCap, raCap.mul(0.92)));
      // Contact shadow in the overhang directly under that lip.
      raRock.mulAssign(mix(0.62, 1.0,
        smoothstep(U.uCliffCapM, U.uCliffCapM.mul(2.4), raBelowTop)));

      // Boulder skirt at the foot of the face.
      const raAboveBase = vRaUp.mul(U.uStepHeight).toVar('raAboveBase');
      raRock.assign(mix(raRock, U.uCliffShade.mul(1.3),
        smoothstep(0.0, U.uCliffSkirtM, raAboveBase).oneMinus().mul(0.45)));

      raCol.assign(raMacro(raRock, raP.xz));
      raRough.assign(U.uCliffRough);

    }).Else(() => {

      // 1. Warp the MASK, not the colour (bible 6.2b). +/-0.6 m of boundary
      //    noise. A straight-line alpha ramp between two ground types is the
      //    instant prototype tell.
      const raWarp = U.uWarp.sample(raXZ.div(U.uWarpScale)).rg
        .sub(0.5).mul(U.uWarpAmp).toVar('raWarp');
      const raSuv = raXZ.add(raWarp).mul(U.uInvMapSize).toVar('raSuv');

      const raS0 = U.uSplat0.sample(raSuv).toVar('raS0');
      const raS1 = U.uSplat1.sample(raSuv).toVar('raS1');

      /*
       * 1b. SHARPEN the blend. The control texture carries one texel per 4 m
       *     build cell, so a raw bilinear fetch dissolves grass into gravel
       *     over a whole cell and every surface boundary reads as mush. Raising
       *     each weight to a power and renormalising is monotone — the layer
       *     that was winning still wins — but it collapses the transition band
       *     to about 1/N of a cell, which is the crisp edge RA3 actually has.
       *
       * UNROLLED, where the GLSL wrote `for ( int i = 0; i < 6; i ++ )`. The
       * bound is a compile-time constant either way, so this is the same code
       * after the compiler is done with it, and unrolling keeps every
       * `uniformArray` index constant — a dynamically indexed uniform array is
       * a uniformity hazard in WGSL that we have no reason to take on.
       */
      const raW: FloatN[] = [raS0.r, raS0.g, raS0.b, raS0.a, raS1.r, raS1.g].map(
        (w, i) => pow(max(w, 0.0), i < 4 ? U.uSplatSharpen.mul(0.58) : U.uSplatSharpen)
          .toVar(`raW${i}`),
      );

      const raSum = raW[0].add(raW[1]).add(raW[2]).add(raW[3]).add(raW[4]).add(raW[5])
        .toVar('raSum');
      const raNorm = float(1.0).div(max(raSum, 1e-6)).toVar('raNorm');

      const raDustable = clamp(
        raW[0].mul(0.62).add(raW[1]).add(raW[2].mul(0.86))
          .add(raW[3].mul(0.38)).add(raW[4].mul(0.24)).add(raW[5].mul(0.10))
          .mul(raNorm),
        0.0, 1.0,
      ).toVar('raDustable');
      const raCrackable = clamp(
        raW[0].mul(0.38).add(raW[1]).add(raW[2].mul(0.82)).add(raW[3].mul(0.46))
          .add(raW[4].mul(0.52)).add(raW[5].mul(0.18)).mul(raNorm),
        0.0, 1.0,
      ).toVar('raCrackable');

      const raAlbedo = vec3(0.0).toVar('raAlbedo');
      const raR = float(0.0).toVar('raR');
      const raCavity = float(0.0).toVar('raCavity');
      for (let i = 0; i < SURFACE_COUNT; i++) {
        const w = raW[i].mul(raNorm).toVar(`raWn${i}`);
        const response = U.uResponses
          .sample(raXZ.div(U.uLayerScale.element(i))).depth(int(i))
          .toVar(`raResponse${i}`);
        raAlbedo.addAssign(
          U.uLayers.sample(raXZ.div(U.uLayerScale.element(i))).depth(int(i)).rgb.mul(w),
        );
        raR.addAssign(clamp(
          U.uLayerRough.element(i).add(response.b.sub(0.5).mul(0.5)), 0.55, 1.0,
        ).mul(w));
        raCavity.addAssign(response.a.mul(w));
      }

      const raRoughMacro = raValue2(raXZ.div(14.0).add(vec2(17.0, 43.0)))
        .toVar('raRoughMacro');
      raR.assign(clamp(raR.add(raRoughMacro.sub(0.5).mul(0.045)), 0.55, 1.0));
      raAlbedo.mulAssign(mix(0.965, 1.0, raCavity));

      // 2. Regional breakup.
      raAlbedo.assign(raMacro(raAlbedo, raXZ));

      // 2a. The supplied detail belongs only to natural splat layers 0..3.
      // Concrete and paving are 4/5, so roads and sidewalks receive zero.
      const raNatural = clamp(
        raW[0].add(raW[1]).add(raW[2]).add(raW[3]).mul(raNorm), 0.0, 1.0,
      ).toVar('raNatural');
      const raTerrainDetail = U.uTerrainDetail
        .sample(raXZ.div(U.uTerrainDetailTileM)).r.toVar('raTerrainDetail');
      raAlbedo.mulAssign(float(1.0).add(
        raTerrainDetail.sub(0.5).mul(U.uTerrainDetailStrength).mul(raNatural),
      ));
      raR.assign(clamp(raR.add(
        float(0.5).sub(raTerrainDetail).mul(U.uTerrainDetailRoughness).mul(raNatural),
      ), 0.55, 1.0));

      // 2b. Continuous material history. No decals, no extra draw and no
      // sampler: only terrain-space ALU over the already blended surface.
      const raAge = raGroundAge(raXZ, raPixelM).toVar('raAge');
      const raDust = raAge.x.mul(raDustable).toVar('raDust');
      const raCrack = raAge.y.mul(raCrackable).toVar('raCrack');
      const raGrit = raAge.z.mul(max(raDustable, raCrackable.mul(0.6))).toVar('raGrit');
      raAlbedo.mulAssign(float(1.0).add(raAge.x.sub(0.5).mul(0.11).mul(raDustable)));
      raAlbedo.mulAssign(mix(vec3(1.0), vec3(0.84, 0.72, 0.58), raDust.mul(0.34)));
      raAlbedo.mulAssign(float(1.0).sub(raCrack.mul(0.30)).sub(raGrit.mul(0.11)));
      raR.assign(clamp(raR.add(raDust.mul(0.040)).add(raCrack.mul(0.075))
        .add(raGrit.mul(0.030)), 0.55, 1.0));

      // 2c. Packed climate pilot for the shipping node path.
      // Snow is deliberately carried but unused until accumulation has a real
      // surface model; a white multiply here would be a misleading weather FX.
      const raSurfaceUp = clamp(normalWorldGeometry.y, 0.0, 1.0).toVar('raSurfaceUp');
      const raClimateWet = U.uSurfaceEnvironment.x
        .mul(float(0.55).add(raSurfaceUp.mul(0.45))).toVar('raClimateWet');
      const raClimateDust = U.uSurfaceEnvironment.y.mul(raDustable)
        .mul(float(0.38).add(raAge.x.mul(0.62)))
        .mul(float(1.0).sub(raClimateWet.mul(0.82))).toVar('raClimateDust');
      const raContactClimate = U.uSurfaceEnvironment.w.mul(raCavity)
        .mul(float(0.35).add(raAge.z.mul(0.65))).toVar('raContactClimate');
      // Slot 2 is the authored sand/beach surface in every biome. The map
      // cause remains a broad envelope; this splat is the local shoreline mask
      // that prevents coast/atoll exposure from salting inland pixels.
      const raShoreMask = clamp(raW[2].mul(raNorm), 0.0, 1.0)
        .mul(raNatural).toVar('raShoreMask');
      const raShoreWet = U.uSurfaceContext.x.mul(raShoreMask)
        .mul(float(1.0).sub(raClimateWet.mul(0.35))).toVar('raShoreWet');
      const raSalt = U.uSurfaceContext.y.mul(raShoreMask)
        .mul(float(1.0).sub(raClimateWet.mul(0.72))).toVar('raShoreSalt');
      // Slot 0 is snow only in the snow biome. The cause is exactly zero on
      // every other preset, so grass never inherits this contamination path.
      const raSnowMask = clamp(raW[0].mul(raNorm), 0.0, 1.0)
        .mul(raNatural).toVar('raSnowMask');
      const raSnowContamination = U.uSurfaceContext.z.mul(raSnowMask)
        .mul(float(0.42).add(raAge.z.mul(0.58))).toVar('raSnowContamination');
      raAlbedo.mulAssign(float(1.0).sub(
        raClimateWet.mul(mix(0.045, 0.070, raNatural)).add(raShoreWet.mul(0.055)),
      ));
      raAlbedo.mulAssign(mix(
        vec3(1.0), vec3(0.90, 0.82, 0.70), raClimateDust.mul(0.10),
      ));
      raAlbedo.mulAssign(float(1.0).sub(raContactClimate.mul(0.025)));
      raAlbedo.assign(mix(
        raAlbedo, vec3(0.72, 0.69, 0.62), raSalt.mul(0.045),
      ));
      raAlbedo.mulAssign(float(1.0).sub(raSnowContamination.mul(0.085)));
      raR.assign(clamp(raR.sub(
        raClimateWet.mul(mix(0.10, 0.14, raNatural)).add(raShoreWet.mul(0.07)),
      ).add(raClimateDust.mul(0.018)).add(raSalt.mul(0.045))
        .add(raSnowContamination.mul(0.035)), 0.50, 1.0));

      // 3. Build-cell-scale variation without exposing the control grid.
      const raCell = raValue2(raXZ.div(U.uCellSize).add(vec2(0.5))).toVar('raCell');
      const raCellTail = smoothstep(0.88, 0.98, raCell).toVar('raCellTail');
      raAlbedo.mulAssign(float(1.0)
        .add(raCell.sub(0.5).mul(2.0).mul(U.uCellJitter))
        .sub(raCellTail.mul(U.uCellJitter).mul(0.45)));

      raCol.assign(raAlbedo);
      raRough.assign(raR);

    });

    return vec4(max(raCol, vec3(0.0)), raRough);
  });

  /* ----------------------------------------------------------------------
   * 4f. THE SHADING NORMAL — the `<normal_fragment_begin>` replacement.
   *
   * Hard faceting plus a striation tilt standing in for the +/-0.25 m of real
   * relief the bible specifies. The interpolated vertex normal is correct for
   * the plateaus and wrong for an 80 degree wall, where it reads as a mound.
   *
   * `normalNode` substitutes for `normalView`, so it must be VIEW space and it
   * must start from `normalViewGeometry` rather than `normalView` — referencing
   * the latter from inside its own replacement is a cycle.
   * -------------------------------------------------------------------- */
  const raNormal = Fn(() => {
    const raFace = raFaceNormal().toVar('raFaceN');
    const base = normalize(normalWorldGeometry).toVar('raBaseWorldN');

    const basis = raStriaBasis(raFace).toVar('raBasisN');
    const raBand = basis.y;
    const raSub = basis.z;

    const raTan = normalize(cross(vec3(0.0, 1.0, 0.0), raFace).add(vec3(1e-5))).toVar('raTan');
    const raShadeN = normalize(raFace.add(
      raTan.mul(raSub.mul(2.0).sub(1.0)).mul(U.uCliffRelief).mul(float(0.3).add(raBand.mul(0.7))),
    )).toVar('raShadeN');

    const worldN = mix(base, raShadeN, U.uFaceMix).toVar('raMixedWorldN');
    const out = normalize(cameraViewMatrix.mul(vec4(worldN, 0.0)).xyz).toVar('raOutViewN');

    // Ground response. The node path cannot share locals from `colorNode`'s
    // sub-build, so it repeats only the two splat fetches and six compact
    // response fetches — never the six albedo fetches.
    const raXZ = positionWorld.xz.toVar('raNormalXZ');
    const raWarp = U.uWarp.sample(raXZ.div(U.uWarpScale)).rg
      .sub(0.5).mul(U.uWarpAmp).toVar('raNormalWarp');
    const raSuv = raXZ.add(raWarp).mul(U.uInvMapSize).toVar('raNormalSuv');
    const raS0 = U.uSplat0.sample(raSuv).toVar('raNormalS0');
    const raS1 = U.uSplat1.sample(raSuv).toVar('raNormalS1');
    const raW: FloatN[] = [raS0.r, raS0.g, raS0.b, raS0.a, raS1.r, raS1.g].map(
      (w, i) => pow(max(w, 0.0), U.uSplatSharpen).toVar(`raNormalW${i}`),
    );
    const raSum = raW[0].add(raW[1]).add(raW[2]).add(raW[3]).add(raW[4]).add(raW[5])
      .toVar('raNormalSum');
    const raNorm = float(1.0).div(max(raSum, 1e-6)).toVar('raNormalNorm');
    const raNxy = vec2(0.0).toVar('raNormalXY');
    for (let i = 0; i < SURFACE_COUNT; i++) {
      const response = U.uResponses
        .sample(raXZ.div(U.uLayerScale.element(i))).depth(int(i));
      raNxy.addAssign(response.rg.mul(2.0).sub(1.0).mul(raW[i].mul(raNorm)));
    }
    const groundWorld = normalize(base.add(vec3(raNxy.x, 0.0, raNxy.y).mul(0.52)))
      .toVar('raGroundWorldN');
    const groundView = normalize(cameraViewMatrix.mul(vec4(groundWorld, 0.0)).xyz)
      .toVar('raGroundViewN');
    return raIsCliffOf(raFace).select(out, groundView);
  });

  /* ----------------------------------------------------------------------
   * 5. THE MATERIAL ITSELF
   * -------------------------------------------------------------------- */

  const material = new TerrainStandardNodeMaterial();
  material.name = 'TerrainNode';
  material.color = new THREE.Color(0xffffff);
  /*
   * `roughness` IS INERT AND THAT IS DELIBERATE, exactly as on the GLSL path.
   * `roughnessNode` below is the splat-blended `raRough`; this scalar is the
   * value three would have used had it not been replaced, kept only so the
   * material serialises to the same thing.
   */
  material.roughness = 0.92;
  material.metalness = 0.0;
  /*
   * Keep the optional implementation available for an explicit material that
   * proves it needs gradient protection. The terrain default stays false: a
   * full-ground screen-space hash is visible texture, not invisible dither.
   */
  material.dithering = false;

  const surface = raSurface();
  material.colorNode = surface.xyz;
  material.roughnessNode = surface.w;
  material.normalNode = raNormal();

  /* ----------------------------------------------------------------------
   * 6. THE ENVIRONMENT SCALE — `RENDER_FINDINGS.md` §6c, and its cause.
   *
   * §6c measured `material.envMapIntensity` 0.0 -> 8.0 at ZERO pixels changed
   * while `scene.environmentIntensity` 0 -> 6 moved essentially every terrain
   * pixel, and concluded that "something in this material's custom-program path
   * is not taking the uniform". THAT DIAGNOSIS IS WRONG, and the port is what
   * found it. The cause is in three itself and applies to every
   * `MeshStandardMaterial` in the game that has no `envMap` of its own:
   *
   *     WebGLRenderer.js:2693
   *       if ( ( material.isMeshStandardMaterial || ... ) &&
   *            material.envMap === null && scene.environment !== null )
   *         m_uniforms.envMapIntensity.value = scene.environmentIntensity;
   *
   * The renderer OVERWRITES the uniform every frame. The node path implements
   * the identical rule on purpose:
   *
   *     MaterialProperties.js:21
   *       materialEnvIntensity = material.envMap ? material.envMapIntensity
   *                                              : scene.environmentIntensity;
   *
   * So the knob does not come alive for free here either — but the rule names
   * its own exit. Give the material its OWN `envMap` and `envMapIntensity`
   * becomes the live per-material dial on BOTH renderers. That is what
   * `setEnvironment` does.
   *
   * IT IS INERT UNTIL CALLED. Nothing about the ground's brightness changes
   * until someone passes a texture, and when they do the correct first argument
   * pair is `( scene.environment, scene.environmentIntensity )`, which is
   * bit-identical to today and merely makes the number editable.
   * -------------------------------------------------------------------- */
  function setEnvironment(env: THREE.Texture | null, intensity: number): void {
    material.envMap = env;
    material.envMapIntensity = intensity;
    material.needsUpdate = true;
  }

  /* ----------------------------------------------------------------------
   * 7. THE BIOME
   * -------------------------------------------------------------------- */

  const biomeSink: TerrainBiomeSink = {
    layerScale: uniforms.uLayerScale.array as number[],
    layerRough: uniforms.uLayerRough.array as number[],
    uMacroScale: uniforms.uMacroScale as unknown as { value: number },
    uMacroStrength: uniforms.uMacroStrength as unknown as { value: number },
    uMacroTint: uniforms.uMacroTint as unknown as { value: THREE.Vector3 },
    uWarpScale: uniforms.uWarpScale as unknown as { value: number },
    uWarpAmp: uniforms.uWarpAmp as unknown as { value: number },
    uCellJitter: uniforms.uCellJitter as unknown as { value: number },
    uCliffBase: uniforms.uCliffBase as unknown as { value: THREE.Vector3 },
    uCliffShade: uniforms.uCliffShade as unknown as { value: THREE.Vector3 },
    uCliffHi: uniforms.uCliffHi as unknown as { value: THREE.Vector3 },
    uCliffCap: uniforms.uCliffCap as unknown as { value: THREE.Vector3 },
    uCliffCapM: uniforms.uCliffCapM as unknown as { value: number },
    uCliffSkirtM: uniforms.uCliffSkirtM as unknown as { value: number },
    uStriationM: uniforms.uStriationM as unknown as { value: number },
    uCourseM: uniforms.uCourseM as unknown as { value: number },
    uCourseOn: uniforms.uCourseOn as unknown as { value: number },
    uCliffRelief: uniforms.uCliffRelief as unknown as { value: number },
    uCliffRough: uniforms.uCliffRough as unknown as { value: number },
    uCliffGrainMean: uniforms.uCliffGrainMean as unknown as { value: number },
    uStepHeight: uniforms.uStepHeight as unknown as { value: number },
  };

  /*
   * The prewarmed LAYER bytes, held for exactly one `applyBiome` call — they
   * were generated for that biome, so only the first pass can legitimately use
   * them, and clearing the reference on the way past also stops the buffer
   * being held alive for the whole match.
   */
  let pendingLayers: Uint8Array | null = adopted && pre !== null ? pre.layers : null;
  let pendingResponses: Uint8Array | null = adopted && pre !== null ? pre.responses : null;
  let layers: THREE.DataArrayTexture | null = null;
  let responses: THREE.DataArrayTexture | null = null;
  let anisotropy = 8;

  function applyBiome(biome: BiomeDef): void {
    applyTerrainBiome(biome, biomeSink);

    /*
     * The layer array is the only thing a biome swap must actually rebuild.
     *
     * SWAPPING `.value` ON THE TEXTURE NODE IS ENOUGH, and it is why every
     * layer fetch in the shader goes through ONE node. `TextureNode.sample()`
     * returns a view that delegates `.value` back to its source, so the six
     * ground fetches and the two cliff fetches are one binding and one live
     * reference — verified in this module's spec, because the alternative
     * (eight independent texture nodes) would be eight bindings of the same
     * texture and a swap that reached only the first.
     */
    const bytes = pendingLayers ?? buildLayerArrayBytes(biome, layerSize);
    const responseBytes = pendingResponses ?? buildLayerResponseArrayBytes(biome, layerSize);
    pendingLayers = null;
    pendingResponses = null;
    const next = layerArrayTexture(bytes, layerSize, biome.key);
    const nextResponses = responseArrayTexture(responseBytes, layerSize, biome.key);
    next.anisotropy = anisotropy;
    nextResponses.anisotropy = anisotropy;
    const prev = layers;
    const prevResponses = responses;
    layers = next;
    responses = nextResponses;
    uniforms.uLayers.value = next;
    uniforms.uResponses.value = nextResponses;
    prev?.dispose();
    prevResponses?.dispose();
  }

  applyBiome(options.biome);

  return {
    material,
    uniforms,
    texturesAdopted: adopted,

    setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void {
      uniforms.uSplat0.value = a;
      uniforms.uSplat1.value = b;
    },

    applyBiome,
    setEnvironment,

    setSurfaceEnvironment(state: SurfaceEnvironmentState): void {
      (uniforms.uSurfaceEnvironment.value as THREE.Vector4).set(
        state.wetness, state.dust, state.snow, state.contact,
      );
      (uniforms.uSurfaceContext.value as THREE.Vector4).set(
        state.shoreWetness, state.salt, state.snowContamination, 0,
      );
    },

    setAnisotropy(a: number): void {
      anisotropy = a;
      terrainDetail.anisotropy = a;
      terrainDetail.needsUpdate = true;
      if (layers) {
        layers.anisotropy = a;
        layers.needsUpdate = true;
      }
      if (responses) {
        responses.anisotropy = a;
        responses.needsUpdate = true;
      }
    },

    dispose(): void {
      material.dispose();
      warp.dispose();
      macro.dispose();
      layers?.dispose();
      responses?.dispose();
      layers = null;
      responses = null;
      layersPlaceholder.dispose();
      responsesPlaceholder.dispose();
      splat0Placeholder.dispose();
      splat1Placeholder.dispose();
    },
  };
}

/* ==========================================================================
 * 8. WHAT TSL COULD NOT EXPRESS, AND WHAT IT COST
 *
 * Written down here rather than discovered again by whoever ports Stage D.
 * Every entry was hit while translating THIS shader, which is the largest one
 * in the project, so the list is close to complete for the material work that
 * follows. NOTHING ON IT BLOCKED THE PORT — that is the headline, and it is
 * worth saying plainly because the migration plan scheduled terrain early
 * precisely because it was the biggest unknown.
 * ========================================================================== */

export const TSL_GAPS: readonly string[] = [
  /*
   * 1. `material.dithering` is implemented in three's chunk system and nowhere
   *    else — no node reads the flag. The optional implementation remains in
   *    `TerrainStandardNodeMaterial`, but terrain deliberately leaves it off
   *    because the screen-space hash was visible after high-DPI resolve.
   */
  'material.dithering: optional node implementation retained; terrain default disabled',
  /*
   * 2. `Fn` IS A MACRO UNTIL YOU GIVE IT A LAYOUT. A bare `Fn` inlines at every
   *    call site. `.setLayout({ name, type, inputs })` is what makes it a
   *    callable — see section 3 for the measured difference.
   */
  'Fn without setLayout inlines at every call site rather than emitting a function',
  /*
   * 3. A DESCENDING `smoothstep` IS UNDEFINED IN WGSL, where GLSL left it
   *    unspecified and every driver did the obvious thing anyway. Written as
   *    the ascending form and inverted; exactly equal because S(1-t) === 1-S(t)
   *    for 3t^2-2t^3. See `raJoint`.
   */
  'smoothstep with edge0 > edge1 is undefined in WGSL; invert the ascending form',
  /*
   * 4. A TEXTURE NODE NEEDS ITS TEXTURE AT CONSTRUCTION, because the sampler
   *    type is read off the value. Anything wired later needs a stand-in of the
   *    right SHAPE — see section 2.
   */
  'texture() derives its sampler type from the value it was constructed with',
  /*
   * 5. `normalNode` REPLACES `normalView`, so it must be view space and it must
   *    start from `normalViewGeometry`. Referencing `normalView` from inside its
   *    own replacement is a cycle.
   */
  'normalNode is view space and must not reference normalView',
  /*
   * 6. NOT A GAP, BUT THE TRAP MOST LIKELY TO COST SOMEONE A DAY.
   *    `onBeforeCompile` fails silently on node materials while
   *    `customProgramCacheKey` goes on firing, so a ported material that keeps
   *    its old cache key gets a stale program with nothing thrown.
   */
  'customProgramCacheKey still fires though onBeforeCompile is dead; do not port the key',
];

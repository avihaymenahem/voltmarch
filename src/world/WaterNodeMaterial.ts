/**
 * ============================================================================
 * VOLTMARCH — src/world/WaterNodeMaterial.ts
 * ============================================================================
 * THE WATER SHADER, AS A TSL NODE GRAPH. Stage E of
 * the WebGPU migration.
 *
 * `./WaterMaterial.ts` is the shipping WebGL material and stays untouched. This
 * file draws the same sea for `WebGPURenderer` — on its WebGPU backend and on
 * its WebGL2 fallback, which are one node path and both of which we support.
 * The two files are the SAME SHADER expressed twice and are meant to be read
 * side by side: every block below carries the name of the GLSL it replaces.
 *
 * RULING #7 — WATER IS NOT A MIRROR, AND THE PORT DID NOT SOFTEN IT
 * ----------------------------------------------------------------
 * There is NO skybox term in this graph, no planar mirror, no reflection render
 * target and no screen-space trace. The only reflective term is the
 * grazing-angle fresnel against the colour of the LAND, and its mix comes from
 * `WATER_CONSTANTS.ssrMix`, which is `min( WATER_SSR.mix, WATER_SSR.mixMax )`
 * applied once in `water-uniforms.ts` for both materials. None of that is a
 * comment here — it is arithmetic in a table this file reads.
 *
 * THE EXPONENT IS `WATER_SSR.fresnelPower` = 5.0, AND THE 5.4 IS DEAD. Porting
 * this shader turned up a second `fresnelPower` in `config.ts`, in `WATER_NOON`,
 * carrying six lines about being raised from 4.2 to stop the surface handing
 * back sky. **Nothing reads it.** Nothing reads any of `WATER_NOON` — the sea
 * takes its colours from `WATER_PALETTES` and its numbers from `WATER_SSR` /
 * `WATER_LOOK` / `WATER_WAVES`, and `DEFAULT_ART.water` has no consumer at all.
 * It is labelled INERT in `config.ts` now, exactly as `VFX_NOON.muzzleMs` was,
 * and it was NOT "fixed" to 5.4: that would be a look change smuggled inside a
 * renderer port, and the number the shipped frames were graded against is 5.0.
 *
 * WHY A REWRITE AND NOT A PORT
 * ----------------------------
 * Unlike the terrain, there is no stock lighting to preserve: this is a raw
 * `ShaderMaterial` and it lights itself. That makes the translation simpler in
 * one way and harder in another — there is no chunk structure to mirror, so the
 * whole thing is one `fragmentNode` and one `vertexNode`, and any block that
 * quietly went missing would compile perfectly.
 *
 * WHAT CHANGED IN TRANSLATION, AND ALL OF IT IS WRITTEN DOWN
 * ---------------------------------------------------------
 *  1. **ONE DESCENDING `smoothstep` HAD TO BE REWRITTEN.** The seabed cutoff is
 *     `smoothstep( uBed.x, uBed.x * 0.35, bedDepth )` — edge0 > edge1, which
 *     GLSL leaves unspecified and **WGSL leaves UNDEFINED**. It is the ascending
 *     form inverted below, which is exactly equal because S(1-t) === 1-S(t) for
 *     3t^2-2t^3. Every other `smoothstep` in `WATER_FRAG` was already ascending;
 *     this was the only one, and it is the term that makes the bed COMPLETELY
 *     invisible past ~2 TL rather than leaving a ghost that reads as fog.
 *  2. **The shroud block is a function call.** `WATER_FRAG` writes the fog tint
 *     out by hand under a comment reading "Same formula as applyShroudTint()",
 *     because a raw `ShaderMaterial` has no `onBeforeCompile` for the injection
 *     to hook. Here it is `shroudTint()` from `../render/shroud-nodes`, the same
 *     graph the carpet uses. That deletes a copy rather than adding one.
 *  3. **`out` parameters became return values.** `crestWave` and `swellHeight`
 *     each wrote a derivative through an `out` argument; TSL has no equivalent
 *     that is portable across both builders, so they return a packed vector and
 *     the caller destructures. Same arithmetic, same call count.
 *
 * WHAT IS DELIBERATELY IDENTICAL
 * ------------------------------
 *  - **The palette maths is not duplicated.** Both materials call
 *    `applyWaterPalette` from `./water-uniforms.ts` over the same `{ value }`
 *    slots, so a palette means the same numbers on both paths by construction
 *    rather than by two tables agreeing.
 *  - **The tiles are the same tiles.** `buildWaveSlopes` / `buildFoamLace` from
 *    `./water-texture-gen.ts`, same key, same adopt-or-generate rule, same
 *    worker prewarm. Nothing about the foam filigree is re-derived here, so
 *    scorecard #26 measures one implementation.
 *  - **NO `customProgramCacheKey`.** The GLSL material does not carry one
 *    either, but it is worth saying: the key still fires on node materials while
 *    `onBeforeCompile` is silently dead, so a ported material that inherits a
 *    hand-managed key gets a stale program with nothing thrown.
 *
 * NOTHING IN `src/` IMPORTS THIS YET. The seam wires it up in Stage F, through
 * a DYNAMIC import behind `requestedBackend()` — a static import from anything
 * the main chunk already pulls in drags the whole node system into the bundle
 * every WebGL player downloads, for a renderer they will not run.
 * ============================================================================
 */

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
import {
  Discard, Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, dot, exp,
  float, length, max, min, mix, modelWorldMatrix, normalize, positionLocal, pow, sign, sin,
  smoothstep, texture, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';

import { WATER_TEXTURE_SIZE } from '../core/config';
import { shroudTint, shroudVertexUv } from '../render/shroud-nodes';
import {
  buildFoamLace, buildWaveSlopes, waterTextureKey, type WaterTextureData,
} from './water-texture-gen';
import {
  WATER_CONSTANTS, applyWaterPalette, resampleRamp, waterLightNorm,
  type WaterPaletteSink,
} from './water-uniforms';
import type {
  WaterLightRig, WaterMaterialOptions,
} from './WaterMaterial';

type FloatN = Node<'float'>;
type Vec2N = Node<'vec2'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. PLACEHOLDER TEXTURES
 *
 * A TSL `texture()` needs a Texture at CONSTRUCTION time — its sampler type is
 * read off the value when the graph is generated. `uField` arrives from
 * `setField` and `uWake` from `setWake`, both long after this factory returns,
 * so they are seeded with 1-texel stand-ins OF THE RIGHT FORMAT and their
 * `.value` is swapped before anything renders. Get the format wrong and the
 * swap is a sampler-type mismatch at compile time rather than a wrong picture —
 * the good failure, but still a failure.
 * ========================================================================== */

function placeholderRgba(name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  t.name = name;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function placeholderRed(name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
  );
  t.name = name;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ==========================================================================
 * 2. THE UNIFORM BLOCK
 *
 * One TSL `uniform()` per GLSL uniform, same names, same defaults, every number
 * out of `WATER_CONSTANTS`. A `UniformNode` is `{ value }` just like a
 * `THREE.IUniform`, which is what lets `applyWaterPalette` write to both
 * materials without an adapter.
 *
 * `uRamp` is the exception, exactly as the terrain's layer tables are:
 * `uniformArray` keeps its JS array on `.array` and leaves `.value` null, so the
 * palette sink is handed `.array` directly. That array is mutated in place and
 * never replaced — the node holds the reference and re-uploads from it.
 * ========================================================================== */

function createUniformNodes(
  waves: THREE.DataTexture, lace: THREE.DataTexture,
  fieldStandIn: THREE.DataTexture, wakeStandIn: THREE.DataTexture,
  palette: WaterMaterialOptions['palette'], rampDepth: number,
) {
  const C = WATER_CONSTANTS;
  return {
    uField: texture(fieldStandIn),
    uWaves: texture(waves),
    uLace: texture(lace),
    uWake: texture(wakeStandIn),

    uTime: uniform(0),
    uInvMapSize: uniform(C.uInvMapSize),
    uWaterLevel: uniform(0),
    uEncodeMetres: uniform(C.uEncodeMetres),
    uShoreEncode: uniform(C.uShoreEncode),

    uRamp: uniformArray<'vec3'>(resampleRamp(palette, C.rampStops), 'vec3'),
    uRampDepth: uniform(rampDepth),
    uAbsorb: uniform(new THREE.Vector3()),
    uSeabed: uniform(new THREE.Vector3()),
    uBed: uniform(new THREE.Vector3()),

    uWaveA: uniform(new THREE.Vector4(...C.waveA)),
    uWaveB: uniform(new THREE.Vector4(...C.waveB)),
    uWaveC: uniform(new THREE.Vector4(...C.waveC)),
    uSwellDir: uniform(new THREE.Vector4(...C.swellDir)),
    uRot47: uniform(new THREE.Vector2(...C.rot47)),
    uRot113: uniform(new THREE.Vector2(...C.rot113)),

    uFoamColor: uniform(new THREE.Vector3()),
    uFoam: uniform(new THREE.Vector4(...C.foam)),
    uLaceParams: uniform(new THREE.Vector4(...C.laceParams)),
    uFoamMisc: uniform(new THREE.Vector3(...C.foamMisc)),

    uShoreFoam: uniform(new THREE.Vector3()),
    uShoreMid: uniform(new THREE.Vector3()),
    uShoreWater: uniform(new THREE.Vector3()),
    uShore: uniform(new THREE.Vector4(...C.shore)),
    uShoreMisc: uniform(new THREE.Vector3(...C.shoreMisc)),

    uSunDir: uniform(new THREE.Vector3(...C.sunDir).normalize()),
    uSunColor: uniform(new THREE.Vector3(...C.sunColor)),
    uHemiSky: uniform(new THREE.Vector3(...C.hemiSky)),
    uHemiGround: uniform(new THREE.Vector3(...C.hemiGround)),
    uLightNorm: uniform(1),
    uGrade: uniform(new THREE.Vector3(...C.grade)),
    uGlint: uniform(new THREE.Vector4(...C.glint)),
    uSsr: uniform(new THREE.Vector3(C.ssrMix, C.ssrFresnelPower, C.ssrShoreFalloff)),
    uReflect: uniform(new THREE.Vector3()),
  };
}

/**
 * The live uniform block, DERIVED from the factory rather than declared beside
 * it. `uniform()` in `@types/three` is a large overload table that resolves the
 * exact node type per value; hand-writing this interface throws all of that away
 * and lands every field on `UniformNode<unknown, unknown>`, which then
 * type-errors at the first `.mul()` in the shader.
 */
export type WaterNodeUniforms = ReturnType<typeof createUniformNodes>;

/* ==========================================================================
 * 2b. THE SHROUD MIXIN
 *
 * The same two calls at the same two points every Stage D material makes, and
 * for the same reason spelled out in `shroud-nodes.ts` §4. The water needs it
 * more literally than any of them: the fog carpet is draped on the SEABED and
 * depth-tested, while this surface sits at `WATER_LEVEL` above it and writes
 * depth in an earlier render band — so the carpet can never cover the sea, and
 * without the self-tint unexplored ocean renders as bright daylight water.
 *
 * `shroudVertexUv()` derives the UV from `modelWorldMatrix * positionLocal`,
 * which is world XZ. The swell displaces Y and nothing else, so that is exactly
 * the `vWorld.xz` the GLSL passes to its hand-copied block — the two paths look
 * up the same texel.
 *
 * `setupPosition` STILL RUNS ON A MATERIAL WITH A `vertexNode`. `NodeMaterial`
 * builds `setupVertex()` (which calls it) and only then substitutes
 * `this.vertexNode` for the result, so the varying is written even though the
 * clip position comes from elsewhere. That is load-bearing and not obvious: a
 * material that skipped it would compile, render, and tint the sea from an
 * unwritten varying.
 * ========================================================================== */

class WaterShroudNodeMaterial extends NodeMaterial {
  override setupPosition(builder: NodeBuilder): Vec3N {
    const position = super.setupPosition(builder) as Vec3N;
    shroudVertexUv();
    return position;
  }

  override setupOutput(builder: NodeBuilder, outputNode: Vec4N): Vec4N {
    /*
     * BEFORE `super`, which is where the GLSL puts it: `<tonemapping_fragment>`
     * — and therefore the injected block immediately above it — runs before
     * `<fog_fragment>` and `<premultiplied_alpha_fragment>`, and `super` is
     * exactly those two. The water has `fog: false` and is not premultiplied, so
     * both are inert here; the ORDER is kept anyway so this material reads the
     * same as every other one that claims the tint.
     */
    return super.setupOutput(builder, shroudTint(outputNode)) as Vec4N;
  }
}

/* ==========================================================================
 * 3. THE SHADER
 * ========================================================================== */

export interface WaterNodeMaterialSet {
  readonly material: NodeMaterial;
  /** Live uniform nodes; mutate `.value`, never replace the node. */
  readonly uniforms: WaterNodeUniforms;
  readonly waveTexture: THREE.DataTexture;
  readonly laceTexture: THREE.DataTexture;
  /** True when both tiles came from `options.textures`. For the boot log only. */
  readonly texturesAdopted: boolean;
  applyPalette(palette: WaterMaterialOptions['palette'], rampDepth: number): void;
  applyLighting(rig: WaterLightRig): void;
  setField(tex: THREE.Texture | null): void;
  setWake(tex: THREE.Texture | null): void;
  setTime(t: number): void;
  setWaterLevel(y: number): void;
  setSeaState(v: number): void;
  setAnisotropy(a: number): void;
  dispose(): void;
}

export function createWaterNodeMaterial(opts: WaterMaterialOptions): WaterNodeMaterialSet {
  const size = opts.textureSize ?? WATER_TEXTURE_SIZE;
  const seed = opts.seed ?? 0;
  // The slope map is heavily oversampled at half resolution; the LACE stays at
  // full resolution because its filament width is what scorecard #26 measures.
  // Both numbers are `createWaterMaterial`'s, unchanged — the two materials must
  // adopt the SAME prewarmed bytes or the worker only ever serves one of them.
  const waveSize = Math.max(64, size >> 1);

  const pre = opts.textures ?? null;
  const adopted = pre !== null
    && pre.key === waterTextureKey(size, seed)
    && pre.waveSize === waveSize
    && pre.laceSize === size
    && pre.waves.length === waveSize * waveSize * 4
    && pre.lace.length === size * size;

  const waveTexture = new THREE.DataTexture(
    adopted && pre !== null ? pre.waves : buildWaveSlopes(waveSize, seed),
    waveSize, waveSize, THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  waveTexture.name = 'water.waveSlopes';
  waveTexture.wrapS = THREE.RepeatWrapping;
  waveTexture.wrapT = THREE.RepeatWrapping;
  waveTexture.magFilter = THREE.LinearFilter;
  waveTexture.minFilter = THREE.LinearMipmapLinearFilter;
  waveTexture.generateMipmaps = true;
  waveTexture.needsUpdate = true;

  const laceTexture = new THREE.DataTexture(
    adopted && pre !== null ? pre.lace : buildFoamLace(size, seed + 101),
    size, size, THREE.RedFormat, THREE.UnsignedByteType,
  );
  laceTexture.name = 'water.foamLace';
  laceTexture.wrapS = THREE.RepeatWrapping;
  laceTexture.wrapT = THREE.RepeatWrapping;
  laceTexture.magFilter = THREE.LinearFilter;
  laceTexture.minFilter = THREE.LinearMipmapLinearFilter;
  laceTexture.generateMipmaps = true;
  laceTexture.needsUpdate = true;

  const fieldStandIn = placeholderRgba('water.field.standIn');
  const wakeStandIn = placeholderRed('water.wake.standIn');

  const U = createUniformNodes(
    waveTexture, laceTexture, fieldStandIn, wakeStandIn, opts.palette, opts.rampDepth,
  );

  /* ----------------------------------------------------------------------
   * 3a. `WAVE_COMMON` — shared between both stages.
   *
   * The fragment stage RE-EVALUATES the swell rather than interpolating a
   * varying, because the crest height drives the foam threshold and a linearly
   * interpolated crest across a 2 m quad visibly stair-steps the foam edge.
   * That is why these carry layouts: two stages, two real functions, instead of
   * the body inlined at every use.
   * -------------------------------------------------------------------- */

  /**
   * `sign(s) * |s|^k`, plus d/dphase. k < 1 sharpens the crest; a plain sine
   * reads as jelly.
   *
   * THE `out float dh` BECAME `.y` OF THE RETURN. TSL has no portable output
   * parameter, and packing is exactly as cheap — the value was already computed
   * on the line above the return.
   */
  const crestWave = Fn(([phase, k]: [FloatN, FloatN]) => {
    const s = sin(phase).toVar('s');
    const a = max(s.abs(), 1e-4).toVar('a');
    const dh = k.mul(pow(a, k.sub(1.0))).mul(phase.cos()).toVar('dh');
    return vec2(sign(s).mul(pow(a, k)), dh);
  }).setLayout({
    name: 'waterCrestWave',
    type: 'vec2',
    inputs: [{ name: 'phase', type: 'float' }, { name: 'k', type: 'float' }],
  });

  /**
   * Band A. Two crossed crest-sharpened waves.
   *
   * Returns `vec3( height, gradX, gradZ )`; the GLSL wrote the gradient through
   * an `out vec2 grad`.
   *
   * NO `.setLayout()`, AND NOR ON `decodeSigned` OR `rampSample` BELOW. All
   * three read module-scope UNIFORMS — `uWaveA`, `uSwellDir`, `uTime`,
   * `uEncodeMetres`, the `uRamp` array — and a layout emits a real WGSL function
   * that can see nothing but its declared parameters, so those names come out
   * unresolved and Chrome refuses the module. The GLSL backend inlines either
   * way, which is exactly why this class of defect survives an offline compile
   * and has to be caught by the static scan in this module's spec. `crestWave`,
   * `rot2` and `unrot2` DO carry layouts: every input of theirs is a parameter.
   */
  const swellHeight = Fn(([p]: [Vec2N]) => {
    const k1 = float(6.283185307179586).div(U.uWaveA.x).toVar('k1');
    const k2 = float(6.283185307179586).div(U.uWaveA.y).toVar('k2');
    const ph1 = dot(p, U.uSwellDir.xy).mul(k1)
      .sub(U.uTime.mul(U.uWaveA.w).mul(k1)).toVar('ph1');
    const ph2 = dot(p, U.uSwellDir.zw).mul(k2)
      .sub(U.uTime.mul(U.uWaveA.w).mul(0.83).mul(k2)).toVar('ph2');
    const w1 = crestWave(ph1, U.uWaveB.w).toVar('w1');
    const w2 = crestWave(ph2, U.uWaveB.w).toVar('w2');
    const amp = U.uWaveA.z.mul(float(0.55).add(U.uWaveC.w.mul(0.45))).toVar('amp');
    const grad = U.uSwellDir.xy.mul(w1.y.mul(k1).mul(0.62))
      .add(U.uSwellDir.zw.mul(w2.y.mul(k2).mul(0.38))).mul(amp).toVar('grad');
    return vec3(w1.x.mul(0.62).add(w2.x.mul(0.38)).mul(amp), grad.x, grad.y);
  });

  /** The field's sqrt-encoded signed depth channel, in metres. Reads `uEncodeMetres`. */
  const decodeSigned = Fn(([e]: [FloatN]) => {
    const s = e.mul(2.0).sub(1.0).toVar('waterDecodeS');
    return sign(s).mul(s).mul(s).mul(U.uEncodeMetres);
  });

  /**
   * Rotate a vector by (cos, sin), and its inverse. Used to sample the slope
   * map at the bible's 0/47/113 degrees: the DOMAIN is rotated, so the sampled
   * gradient has to be rotated back to world space or the ripples shear.
   */
  const rot2 = Fn(([v, cs]: [Vec2N, Vec2N]) => vec2(
    v.x.mul(cs.x).sub(v.y.mul(cs.y)),
    v.x.mul(cs.y).add(v.y.mul(cs.x)),
  )).setLayout({
    name: 'waterRot2',
    type: 'vec2',
    inputs: [{ name: 'v', type: 'vec2' }, { name: 'cs', type: 'vec2' }],
  });

  const unrot2 = Fn(([v, cs]: [Vec2N, Vec2N]) => vec2(
    v.x.mul(cs.x).add(v.y.mul(cs.y)),
    v.x.mul(cs.y).negate().add(v.y.mul(cs.x)),
  )).setLayout({
    name: 'waterUnrot2',
    type: 'vec2',
    inputs: [{ name: 'v', type: 'vec2' }, { name: 'cs', type: 'vec2' }],
  });

  /**
   * Piecewise-linear 8-stop ramp.
   *
   * UNROLLED, where the GLSL wrote `for ( int i = 1; i < 8; i ++ )` — for the
   * same reason Stage C unrolled the splat loop. The bound is a compile-time
   * constant either way, so this is the same code once the compiler is done, and
   * unrolling keeps every `uniformArray` index CONSTANT. A dynamically indexed
   * uniform array is a uniformity hazard in WGSL that we have no reason to take
   * on, and the GLSL's own comment says ES 1.00 forbade it anyway.
   */
  const rampSample = Fn(([t]: [FloatN]) => {
    const f = clamp(t, 0.0, 1.0).mul(WATER_CONSTANTS.rampStops - 1).toVar('waterRampF');
    const c = vec3(U.uRamp.element(0)).toVar('waterRampC');
    for (let i = 1; i < WATER_CONSTANTS.rampStops; i++) {
      c.assign(mix(c, U.uRamp.element(i), clamp(f.sub(i - 1), 0.0, 1.0)));
    }
    return c;
  });

  /* ----------------------------------------------------------------------
   * 3b. THE VERTEX STAGE — `WATER_VERT`
   *
   * A BARE `Fn`, DELIBERATELY. It is called exactly once, and its body reads
   * `positionLocal`, which is a geometry ATTRIBUTE — attributes arrive through
   * the entry point rather than as module-scope bindings, so hoisting this into
   * a declared function is the one place a layout would be wrong rather than
   * merely unnecessary.
   * -------------------------------------------------------------------- */
  const surfaceWorld = Fn(() => {
    const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).toVar('wp');
    const p = wp.xz.toVar('p');
    const fieldUv = p.mul(U.uInvMapSize).toVar('fieldUv');

    /*
     * Kill the swell as the bed comes up, or the crests poke through the beach
     * and the shoreline band tears. Vertex texture fetch is core in WebGL2 and
     * ordinary in WGSL; three emits the explicit-LOD form for the vertex stage
     * on its own, because there are no derivatives there to pick a mip from.
     */
    const depth = decodeSigned(U.uField.sample(fieldUv).r).toVar('depth');
    const shallow = smoothstep(0.0, 0.75, depth).toVar('shallow');
    const h = swellHeight(p).x.mul(shallow).toVar('h');

    return vec3(wp.x, U.uWaterLevel.add(h), wp.z);
  });

  const vWorld = varying(surfaceWorld(), 'vWorld') as unknown as Vec3N;
  const vFieldUv = varying(vWorld.xz.mul(U.uInvMapSize), 'vFieldUv') as unknown as Vec2N;

  /* ----------------------------------------------------------------------
   * 3c. THE FRAGMENT STAGE — `WATER_FRAG`
   * -------------------------------------------------------------------- */
  const surface = Fn(() => {
    const field = U.uField.sample(vFieldUv).toVar('field');
    const depth = decodeSigned(field.r).toVar('depth');
    /*
     * Land. The mesh carries a small margin past the waterline so the geometry
     * never ends before the water does; this is where that margin is thrown
     * away. `Discard` is TSL's `discard`, and it is a statement rather than an
     * early return — everything below still builds, which is why the guard is
     * a condition rather than an `If`.
     */
    Discard(depth.lessThanEqual(0.0));

    const viewVec = cameraPosition.sub(vWorld).toVar('viewVec');
    const viewDist = length(viewVec).toVar('viewDist');
    const V = viewVec.div(max(viewDist, 1e-4)).toVar('V');
    const p = vWorld.xz.toVar('p');

    /* ---- normal: band A slope + bands B and C from the slope map --------- */
    const swell = swellHeight(p).toVar('swell');
    const crest = swell.x.toVar('crest');
    const grad = swell.yz.toVar('grad');
    const crestN = clamp(crest.div(max(U.uWaveA.z, 1e-4)), -1.0, 1.0).toVar('crestN');

    const shallow = smoothstep(0.0, 0.75, depth).toVar('shallow');
    const slope = grad.mul(shallow).toVar('slope');

    // Band B, two rotations of the mid-frequency channel.
    const dirB = vec2(0.82, 0.57).mul(U.uTime.mul(U.uWaveB.y)).toVar('dirB');
    const b0 = U.uWaves.sample(p.add(dirB).div(U.uWaveB.x)).rg.mul(2.0).sub(1.0).toVar('b0');
    const q47 = rot2(p, U.uRot47).toVar('q47');
    const b1 = U.uWaves.sample(q47.sub(dirB.yx.mul(0.77)).div(U.uWaveB.x.mul(0.63)))
      .rg.mul(2.0).sub(1.0).toVar('b1');
    slope.addAssign(b0.add(unrot2(b1, U.uRot47)).mul(U.uWaveB.z));

    // Band C, the micro-detail. Rotated 113 degrees and scrolling fastest.
    // WITHOUT BAND C THE SPECULAR READS AS PLASTIC; it is not a polish item.
    const q113 = rot2(p, U.uRot113).toVar('q113');
    const c0 = U.uWaves.sample(
      q113.add(vec2(0.31, -0.95).mul(U.uTime.mul(U.uWaveC.y))).div(U.uWaveC.x),
    ).ba.mul(2.0).sub(1.0).toVar('c0');
    slope.addAssign(unrot2(c0, U.uRot113).mul(U.uWaveC.z));

    // Sea state scales the crinkle but not the swell, exactly like real chop.
    slope.mulAssign(float(0.6).add(U.uWaveC.w.mul(0.4)));
    const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar('N');

    /* ---- absorption over a refracted seabed (bible §7) ------------------- */
    const refr = N.xz.mul(U.uBed.z).mul(clamp(depth.mul(0.5), 0.0, 1.0)).toVar('refr');
    const bedField = U.uField.sample(vFieldUv.add(refr.mul(U.uInvMapSize))).toVar('bedField');
    const bedDepth = max(decodeSigned(bedField.r), 0.0).toVar('bedDepth');

    const blob = bedField.b.sub(0.5).mul(2.0).toVar('blob');
    const grit = bedField.a.sub(0.5).mul(2.0).toVar('grit');
    const seabed = U.uSeabed.mul(
      float(1.0).add(blob.mul(U.uBed.y)).add(grit.mul(U.uBed.y).mul(0.45)),
    ).toVar('seabed');

    const trans = exp(bedDepth.negate().mul(U.uAbsorb)).toVar('trans');
    /*
     * THE ONE DESCENDING `smoothstep` IN THIS SHADER, INVERTED.
     *
     * The GLSL is `smoothstep( uBed.x, uBed.x * 0.35, bedDepth )` — edge0 >
     * edge1, which GLSL leaves unspecified and WGSL leaves UNDEFINED. Written
     * as the ascending form and inverted, which is exactly equal because
     * S(1-t) === 1-S(t) for 3t^2-2t^3.
     *
     * It is not decoration: the bible is explicit that the bed is COMPLETELY
     * invisible past ~2 TL, and absorption alone leaves a faint ghost that
     * reads as fog — which is a banned effect arrived at by accident.
     */
    trans.mulAssign(smoothstep(U.uBed.x.mul(0.35), U.uBed.x, bedDepth).oneMinus());

    const body = mix(rampSample(depth.div(U.uRampDepth)), seabed.mul(trans), trans.g)
      .toVar('body');

    /* ---- shoreline: distance field -> band, lightening, churn ------------ */
    /*
     * G is SIGNED: positive offshore, negative inland. Signed is what makes the
     * landward gradient below continuous across the contact — an unsigned
     * distance has a crease exactly on the waterline, which is exactly where
     * the band needs a clean direction.
     */
    const shoreDist = field.g.sub(0.5).mul(2.0).mul(U.uShoreEncode).toVar('shoreDist');
    const shoreT = clamp(shoreDist.div(U.uShore.x), 0.0, 1.0).oneMinus().toVar('shoreT');

    // Landward = downhill in the shore-distance field. Two forward taps; a
    // central difference would cost four for no visible gain.
    const e = float(1.5).mul(U.uInvMapSize).toVar('e');
    const gsx = U.uField.sample(vFieldUv.add(vec2(e, 0.0))).g.sub(field.g).toVar('gsx');
    const gsz = U.uField.sample(vFieldUv.add(vec2(0.0, e))).g.sub(field.g).toVar('gsz');
    const landward = normalize(vec2(gsx, gsz).add(vec2(1e-5))).negate().toVar('landward');

    const lighten = clamp(depth.div(U.uShoreMisc.x), 0.0, 1.0).oneMinus().toVar('lighten');
    body.assign(mix(body, U.uShoreWater, shoreT.mul(lighten).mul(0.62)));

    /* ---- foam — FILIGREE, never a soft alpha blob (scorecard #26) -------- */
    // Warp the lace lookup by the wave normal so the filaments ride the crests
    // instead of sitting on a static grid.
    const lp = p.add(N.xz.mul(0.55)).add(vec2(0.71, 0.32).mul(U.uTime.mul(U.uFoam.w)))
      .toVar('lp');
    const laceA = U.uLace.sample(lp.div(U.uLaceParams.x)).r.toVar('laceA');
    const laceB = U.uLace.sample(rot2(lp, U.uRot47).div(U.uLaceParams.y)).r.toVar('laceB');
    const lace = mix(laceA, laceB, U.uLaceParams.z).toVar('lace');
    // Mixing two gaussians narrows the distribution; renormalise or the
    // measured coverage drifts away from scorecard #26.
    lace.assign(float(0.5).add(lace.sub(0.5).mul(U.uLaceParams.w)));

    // Thresholds open up with sea state and with distance. The distance term is
    // MIP COMPENSATION: a filament field averages toward its mean under
    // minification, and without this the far half of the frame loses its foam.
    const thr = U.uFoam.x
      .sub(U.uWaveC.w.mul(U.uFoamMisc.x))
      .sub(U.uFoamMisc.y.mul(clamp(viewDist.div(90.0), 0.0, 1.0))).toVar('thr');
    const crestPush = crestN.mul(U.uFoam.z).mul(0.5)
      .mul(float(0.4).add(U.uWaveC.w.mul(0.6))).toVar('crestPush');
    const foam = smoothstep(thr, thr.add(U.uFoam.y.sub(U.uFoam.x)), lace.add(crestPush))
      .toVar('foam');

    /*
     * Wakes. FULLY multiplied by the lace — an accumulation buffer on its own is
     * a soft blob, which is the scorecard #26 failure arrived at from the wake
     * side. An earlier version kept a 0.30 floor here "so the churn reads
     * solid"; rendered, that turned a ship's track into a white slug. The wake
     * decides WHERE there is foam, the lace decides what shape it is.
     */
    const wake = U.uWake.sample(vFieldUv).r.mul(U.uFoamMisc.z).toVar('wake');
    const wakeFoam = smoothstep(0.06, 0.55, wake).mul(smoothstep(0.30, 0.62, lace))
      .toVar('wakeFoam');
    foam.assign(max(foam, wakeFoam));

    // The permanent shoreline band: denser, bluer, pulsing, scrolling landward.
    const sp = p.add(landward.mul(U.uTime.mul(U.uShore.w))).add(N.xz.mul(0.3)).toVar('sp');
    const churn = U.uLace.sample(sp.div(U.uShoreMisc.z)).r.toVar('churn');
    const pulse = float(1.0).add(U.uShore.z.mul(
      sin(U.uTime.mul(U.uShore.y).add(p.x.mul(0.21)).add(p.y.mul(0.17))),
    )).toVar('pulse');
    const bandMask = smoothstep(0.0, 0.35, shoreT).mul(pulse).toVar('bandMask');
    const shoreFoam = smoothstep(
      U.uShoreMisc.y, U.uShoreMisc.y.add(0.14), churn.add(bandMask.mul(0.30)),
    ).mul(smoothstep(0.0, 0.12, shoreT)).toVar('shoreFoam');
    foam.assign(clamp(max(foam, clamp(shoreFoam, 0.0, 1.0)), 0.0, 1.0));

    const foamCol = mix(
      U.uFoamColor,
      mix(U.uShoreMid, U.uShoreFoam, smoothstep(0.35, 0.85, churn)),
      smoothstep(0.0, 0.6, shoreT),
    ).toVar('foamCol');

    /* ---- lighting -------------------------------------------------------- */
    const ndl = max(dot(N, U.uSunDir), 0.0).toVar('ndl');
    const hemi = mix(U.uHemiGround, U.uHemiSky, float(0.5).add(N.y.mul(0.5))).toVar('hemi');
    const lightBody = U.uGrade.x.mul(ndl).mul(U.uSunColor)
      .add(hemi.mul(U.uGrade.y)).div(U.uLightNorm).toVar('lightBody');
    const lightFoam = U.uSunColor.mul(ndl).mul(WATER_CONSTANTS.foamSunDiffuse)
      .add(hemi.mul(WATER_CONSTANTS.foamFillDiffuse)).div(U.uLightNorm).toVar('lightFoam');

    const col = mix(body.mul(lightBody), foamCol.mul(lightFoam), foam).toVar('col');

    /* ---- grazing term — RULING #7 ---------------------------------------- */
    // No sky. No cube map. No screen-space trace. The colour of the LAND, at
    // grazing angles only, faded out offshore, and the mix was clamped to
    // WATER_SSR.mixMax in `water-uniforms.ts` before it ever reached this line.
    const fres = pow(clamp(dot(N, V), 0.0, 1.0).oneMinus(), U.uSsr.y).toVar('fres');
    const nearShore = clamp(shoreDist.div(U.uSsr.z), 0.0, 1.0).oneMinus().toVar('nearShore');
    col.assign(mix(col, U.uReflect.mul(lightBody),
      fres.mul(U.uSsr.x).mul(float(0.2).add(nearShore.mul(0.8))).mul(foam.oneMinus())));

    /* ---- glint: anisotropic GGX, stretched along the light azimuth ------- */
    const H = normalize(U.uSunDir.add(V)).toVar('H');
    const az = normalize(U.uSunDir.xz.add(vec2(1e-5))).toVar('az');
    const X = vec3(az.x, 0.0, az.y).toVar('X');
    X.assign(normalize(X.sub(N.mul(dot(N, X)))));
    const Y = cross(N, X).toVar('Y');
    // Widen the lobe with distance: the cheapest specular antialiasing there is,
    // and it keeps a 3 px highlight from crawling across the far half of the map.
    const rough = U.uGlint.x.mul(
      float(1.0).add(U.uGlint.w.mul(clamp(viewDist.div(120.0), 0.0, 1.0))),
    ).toVar('rough');
    const ax = max(rough.mul(U.uGlint.y), 0.004).toVar('ax');
    const ay = max(rough.div(U.uGlint.y), 0.004).toVar('ay');
    const xh = dot(X, H).div(ax).toVar('xh');
    const yh = dot(Y, H).div(ay).toVar('yh');
    const nh = max(dot(N, H), 0.0).toVar('nh');
    const dd = xh.mul(xh).add(yh.mul(yh)).add(nh.mul(nh)).toVar('dd');
    /*
     * The anisotropic GGX D term NORMALISED by its own peak, so `uGlint.z` is
     * "how many times over white does a dead-on glint go" instead of an
     * arbitrary scale that changes meaning every time the roughness moves. The
     * raw D peaks near 10^2 at these roughnesses; feeding that straight into the
     * sun colour turned the whole surface into a highlight and pushed the frame
     * mean from L=58 to L=131 — scorecard #25's exact failure.
     */
    const lobe = clamp(float(1.0).div(max(dd.mul(dd), 1e-6)), 0.0, 1.0).toVar('lobe');
    const spec = U.uSunColor.mul(lobe).mul(ndl).mul(U.uGlint.z)
      .mul(foam.mul(0.85).oneMinus()).toVar('spec');

    col.assign(col.add(spec).mul(U.uGrade.z));

    // The waterline is one texel wide in the field, so fade the last few
    // centimetres of depth rather than leaving a hard stair-stepped edge.
    const alpha = smoothstep(0.0, 0.12, depth).toVar('waterAlpha');

    return vec4(col, alpha);
  });

  /* ----------------------------------------------------------------------
   * 4. THE MATERIAL
   * -------------------------------------------------------------------- */

  const material = new WaterShroudNodeMaterial();
  material.name = 'WaterNodeMaterial';
  /*
   * `vertexNode` is the FULL clip-space position, which is what `WATER_VERT`
   * computed: `projectionMatrix * viewMatrix * wp`, where `wp` already carries
   * the displaced Y. `positionNode` would have been the wrong hook — it takes
   * LOCAL space and three applies the model matrix afterwards, so the world-XZ
   * field lookup that decides the displacement would not be available yet.
   */
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix)
    .mul(vec4(vWorld, 1.0)) as unknown as Vec4N;
  material.fragmentNode = surface() as unknown as Vec4N;
  material.transparent = true;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  // Bible §0 property 4 and the "explicitly zero" list: no fog anywhere.
  material.fog = false;
  material.toneMapped = true;

  const paletteSink: WaterPaletteSink = {
    ramp: U.uRamp.array as THREE.Vector3[],
    uRampDepth: U.uRampDepth as unknown as { value: number },
    uAbsorb: U.uAbsorb as unknown as { value: THREE.Vector3 },
    uSeabed: U.uSeabed as unknown as { value: THREE.Vector3 },
    uBed: U.uBed as unknown as { value: THREE.Vector3 },
    uFoamColor: U.uFoamColor as unknown as { value: THREE.Vector3 },
    uShoreFoam: U.uShoreFoam as unknown as { value: THREE.Vector3 },
    uShoreMid: U.uShoreMid as unknown as { value: THREE.Vector3 },
    uShoreWater: U.uShoreWater as unknown as { value: THREE.Vector3 },
    uReflect: U.uReflect as unknown as { value: THREE.Vector3 },
  };
  applyWaterPalette(opts.palette, opts.rampDepth, paletteSink);

  if (opts.anisotropy !== undefined) {
    waveTexture.anisotropy = opts.anisotropy;
    laceTexture.anisotropy = opts.anisotropy;
  }

  return {
    material,
    uniforms: U,
    waveTexture,
    laceTexture,
    texturesAdopted: adopted,

    applyPalette(palette, rampDepth): void {
      applyWaterPalette(palette, rampDepth, paletteSink);
    },

    applyLighting(rig: WaterLightRig): void {
      U.uSunDir.value.copy(rig.sunDir);
      U.uSunColor.value.copy(rig.sunColor);
      U.uHemiSky.value.copy(rig.hemiSky);
      U.uHemiGround.value.copy(rig.hemiGround);
      U.uLightNorm.value = waterLightNorm(rig);
    },

    setField(tex: THREE.Texture | null): void {
      // Never null on the node path: a `texture()` node with a null value has no
      // sampler to bind and the whole material fails to build. The stand-in is
      // the "no field yet" state, and it is the same shape as the real one.
      U.uField.value = tex ?? fieldStandIn;
    },
    setWake(tex: THREE.Texture | null): void { U.uWake.value = tex ?? wakeStandIn; },
    setTime(t: number): void { U.uTime.value = t; },
    setWaterLevel(y: number): void { U.uWaterLevel.value = y; },
    setSeaState(v: number): void { U.uWaveC.value.w = Math.min(1, Math.max(0, v)); },
    setAnisotropy(a: number): void {
      waveTexture.anisotropy = a;
      laceTexture.anisotropy = a;
      waveTexture.needsUpdate = true;
      laceTexture.needsUpdate = true;
    },

    dispose(): void {
      waveTexture.dispose();
      laceTexture.dispose();
      fieldStandIn.dispose();
      wakeStandIn.dispose();
      material.dispose();
    },
  };
}

/* ==========================================================================
 * 5. WHAT TSL COULD NOT EXPRESS HERE
 *
 * Appended to Stage C's `TSL_GAPS` rather than replacing it. Two new entries,
 * neither of which blocked the port.
 * ========================================================================== */

export const WATER_TSL_GAPS: readonly string[] = [
  /*
   * 1. `out` PARAMETERS. `crestWave` and `swellHeight` each wrote a derivative
   *    through one. TSL has no form of this that generates on both builders, so
   *    both return a packed vector. Free — the value was already computed.
   */
  'Fn has no portable out-parameter; pack the extra result into the return type',
  /*
   * 2. A `texture()` NODE CANNOT HOLD NULL. The GLSL uniforms carry
   *    `uField: { value: null }` until `Water.ts` builds the field, which is
   *    fine for a sampler2D that is simply never read. A TSL `texture()` reads
   *    its sampler type off the value AT CONSTRUCTION, so null is a build
   *    failure rather than a black texture. `setField(null)` therefore restores
   *    the stand-in instead of clearing.
   */
  'texture() cannot hold null; a stand-in of the right FORMAT is the empty state',
];

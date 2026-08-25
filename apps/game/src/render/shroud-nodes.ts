/**
 * ============================================================================
 * VOLTMARCH — src/render/shroud-nodes.ts
 * ============================================================================
 * THE SHROUD, AS A TSL NODE GRAPH. §1-§4 are the SELF-TINT (Stage D of
 * the WebGPU migration); §5-§7 are the CARPET (Stage E).
 *
 * `./FogOfWar.ts`'s `applyShroudTint` is the shipping WebGL injection: five
 * uniforms, one `vShroudUv` varying derived from world XZ, and a tint applied to
 * `gl_FragColor.rgb` immediately before `<tonemapping_fragment>`. It is the most
 * REUSED injection in the project — six of the eleven surviving
 * `onBeforeCompile` sites are nothing but a call to it — so it is ported once,
 * here, rather than six times inside the materials that need it.
 *
 * THE TWO STAGES MET IN THIS FILE, AND THAT IS THE POINT
 * -----------------------------------------------------
 * This header used to say "WHY THIS FILE IS NOT STAGE E, SHROUD" and reserve it
 * for the self-tint alone. Stage E then ported the CARPET — `FogOfWar`'s own
 * `ShaderMaterial`, draped on the seabed, with the domain warp and the ordered
 * dither the self-tint deliberately omits — and putting it anywhere else would
 * have meant a second copy of the alpha/colour formula on the node path, which
 * is the exact defect both stages exist to remove.
 *
 * On the WebGL side that formula is written THREE times: `SHROUD_FRAG` for the
 * carpet, `SHROUD_TINT_FRAG` for the injection, and inline in
 * `src/world/WaterMaterial.ts` under a comment reading "Same formula as
 * applyShroudTint()" — the water is a raw `ShaderMaterial` and has no
 * `onBeforeCompile` for the injection to hook. Here it is one `Fn` with three
 * callers, and `WaterNodeMaterial` is one of them.
 *
 * WHAT THE CARPET KEEPS THAT THE SELF-TINT DOES NOT
 * -------------------------------------------------
 * The domain warp and the screen-space dither, and `FogOfWar.ts` §1b says why:
 * they exist to break a 4 m texel grid across a full-screen surface and buy
 * nothing on a 3 m silhouette. A remembered building therefore keeps exactly the
 * tint it has today, and the carpet keeps its sub-cell edge.
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
import { MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Discard, Fn, float, floor, fract, mix, modelWorldMatrix, positionLocal, positionWorld,
  screenCoordinate, smoothstep, texture, uniform, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import {
  DEFAULT_ART, FOG_DITHER, FOG_EDGE_WARP, FOG_EXPLORED_ALPHA, FOG_EXPLORED_LEVEL,
  FOG_UNEXPLORED_ALPHA, MAP_CELLS,
} from '../core/config';
import { hexToLinearRgb } from '../core/math';
import type { ShroudLook } from '../core/types';
import { SHROUD_UV_SCALE, shroudUniforms } from './FogOfWar';

type Vec2N = Node<'vec2'>;
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

/**
 * A `MeshStandardNodeMaterial` that does nothing but wear the self-tint.
 *
 * THREE SITES IN THE GAME ARE EXACTLY THIS AND NOTHING ELSE — `ore.system.ts`'s
 * crystal instancer, `entity-props.system.ts`'s wrecks, and (before Stage F gave
 * it its own file) the contact pool. Each is a stock `MeshStandardMaterial`
 * whose whole `onBeforeCompile` is one call to `applyShroudTint`. Porting them
 * three times would put three copies of the mixin contract in three files;
 * this is the one copy.
 *
 * The parameters are `MeshStandardMaterialParameters` verbatim, so a caller
 * hands over the SAME object literal it hands the GLSL constructor and the two
 * cannot drift on `vertexColors`, `emissive` or `roughness`.
 */
export function createShroudTintedStandardNodeMaterial(
  params: THREE.MeshStandardMaterialParameters,
): MeshStandardNodeMaterial {
  const mat = new (class ShroudTintedStandardNodeMaterial extends MeshStandardNodeMaterial {
    override setupPosition(builder: Parameters<MeshStandardNodeMaterial['setupPosition']>[0]): Node {
      const position = super.setupPosition(builder) as Node;
      shroudVertexUv();
      return position;
    }
    override setupOutput(
      builder: Parameters<MeshStandardNodeMaterial['setupOutput']>[0], out: Node,
    ): Node {
      return super.setupOutput(builder, shroudTint(out as Vec4N)) as Node;
    }
  })();
  mat.setValues(params);
  return mat;
}

/* ==========================================================================
 * 5. THE CARPET'S OWN NOISE — Stage E
 *
 * `.setLayout()` ON ALL FOUR, AND THAT IS SAFE HERE FOR A REASON WORTH STATING:
 * every one of them is PURE. Their only inputs are their parameters — no
 * attribute, no varying, no uniform, no sampler — so the real WGSL function a
 * layout emits can see everything it needs. That is the missing half of
 * `TSL_GAPS` #2 that Stage D found in a browser (see the note under
 * `shroudTintRgb` above), stated from the other side: a layout is not a
 * performance hint to sprinkle on hot helpers, it is a PROMISE that the body is
 * closed over nothing.
 *
 * It earns its keep here. `shroudVnoise` calls `shroudHash21` four times and the
 * carpet calls `shroudVnoise` four times, so without layouts three would emit
 * the hash body sixteen times over with renamed locals.
 * ========================================================================== */

/** `hash21` from `SHROUD_FRAG`, unchanged. */
const shroudHash21 = Fn(([pIn]: [Vec2N]) => {
  const p = fract(pIn.mul(vec2(127.1, 311.7))).toVar('p');
  p.addAssign(p.dot(p.add(34.345)));
  return fract(p.x.mul(p.y));
}).setLayout({ name: 'shroudHash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Value noise. Cheap on purpose: this only has to break a straight edge. */
const shroudVnoise = Fn(([p]: [Vec2N]) => {
  const i = floor(p).toVar('i');
  const f = fract(p).toVar('f');
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  const a = shroudHash21(i);
  const b = shroudHash21(i.add(vec2(1.0, 0.0)));
  const c = shroudHash21(i.add(vec2(0.0, 1.0)));
  const d = shroudHash21(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}).setLayout({ name: 'shroudVnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * 4x4 ordered Bayer, closed form.
 *
 * VISUAL_DNA I1 asks for ordered dithering on every gradient in the game, and an
 * ordered pattern is stable frame to frame — white noise here would crawl and
 * read as film grain, which is banned. It is also why nothing in this file draws
 * from an RNG: `docs/RENDER_FINDINGS.md` records three's own `DenoiseNode`
 * seeding itself from `Math.random()`, and the shot harness's byte-identical
 * captures would not survive a per-run seed anywhere in the frame.
 */
const shroudBayer2 = Fn(([aIn]: [Vec2N]) => {
  const a = floor(aIn).toVar('a');
  return fract(a.x.mul(0.5).add(a.y.mul(a.y).mul(0.75)));
}).setLayout({ name: 'shroudBayer2', type: 'float', inputs: [{ name: 'aIn', type: 'vec2' }] });

const shroudBayer4 = Fn(([a]: [Vec2N]) => shroudBayer2(a.mul(0.5)).mul(0.25).add(shroudBayer2(a)))
  .setLayout({ name: 'shroudBayer4', type: 'float', inputs: [{ name: 'a', type: 'vec2' }] });

/* ==========================================================================
 * 6. THE CARPET MATERIAL — Stage E
 * ========================================================================== */

export interface ShroudNodeMaterialSet {
  readonly material: NodeMaterial;
  /** Live uniform nodes; mutate `.value`, never replace the node. */
  readonly uniforms: ReturnType<typeof createCarpetUniforms>;
  /** Point the carpet at the real 128x128 R8 mask. */
  setFogTexture(tex: THREE.Texture): void;
  setTime(t: number): void;
  /** Re-read an `ArtDirection.shroud` patch. Uniforms only; never allocates. */
  applyLook(look: ShroudLook): void;
  dispose(): void;
}

function createCarpetUniforms(fog: THREE.Texture, look: ShroudLook) {
  const tint = new Float32Array(3);
  const dark = new Float32Array(3);
  hexToLinearRgb(look.exploredTint, tint as unknown as number[]);
  hexToLinearRgb(look.unexploredColor, dark as unknown as number[]);
  return {
    uFog: texture(fog),
    uExploredTint: uniform(new THREE.Vector3(tint[0], tint[1], tint[2])),
    uUnexploredColor: uniform(new THREE.Vector3(dark[0], dark[1], dark[2])),
    uExploredAlpha: uniform(FOG_EXPLORED_ALPHA),
    uUnexploredAlpha: uniform(FOG_UNEXPLORED_ALPHA),
    uExploredLevel: uniform(FOG_EXPLORED_LEVEL),
    uTexel: uniform(1 / MAP_CELLS),
    uWarp: uniform(FOG_EDGE_WARP),
    uDither: uniform(FOG_DITHER),
    uNoiseScale: uniform(Math.max(1, look.noiseScale)),
    uNoiseSpeed: uniform(look.noiseSpeed),
    uTime: uniform(0),
  };
}

/** 1x1 R8 = 255, matching `FogOfWar`'s own clear mask. */
function clearMask(): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
  );
  t.name = 'ShroudNodeMaskDefault';
  t.needsUpdate = true;
  return t;
}

/**
 * The draped carpet, as a node material.
 *
 * NO CUSTOM VERTEX NODE, and that is not a shortcut. `SHROUD_VERT` computes
 * exactly `projectionMatrix * viewMatrix * modelMatrix * position` and passes
 * `uv` and the world position through — three's default transform plus two
 * stock varyings. `positionWorld` and `uv()` ARE those varyings, so the vertex
 * stage the node builder emits is the one the GLSL hand-wrote.
 *
 * It does NOT call `shroudTint`: the carpet is the surface that formula
 * describes, not a surface tinting itself against it. It reads its OWN `uFog`,
 * warped and dithered, and `vShroudUv` is never written for it.
 */
export function createShroudNodeMaterial(look?: ShroudLook): ShroudNodeMaterialSet {
  const placeholder = clearMask();
  const uniforms = createCarpetUniforms(placeholder, look ?? DEFAULT_ART.shroud);

  const carpet = Fn(() => {
    /*
     * Domain-warp the lookup so the 4 m texel grid never reads as a polygon.
     * TWO octaves, because one is not enough: a single low-frequency warp just
     * bends the straight segments instead of dissolving them, and at the
     * default zoom one texel is ~90 screen px.
     */
    const np = positionWorld.xz.div(uniforms.uNoiseScale)
      .add(vec2(uniforms.uTime.mul(uniforms.uNoiseSpeed))).toVar('np');
    const warp = vec2(shroudVnoise(np).sub(0.5), shroudVnoise(np.add(17.31)).sub(0.5))
      .toVar('warp');
    const np2 = np.mul(4.0).sub(vec2(uniforms.uTime.mul(uniforms.uNoiseSpeed).mul(1.7)))
      .toVar('np2');
    warp.addAssign(
      vec2(shroudVnoise(np2).sub(0.5), shroudVnoise(np2.add(41.7)).sub(0.5)).mul(0.5),
    );
    warp.mulAssign(uniforms.uWarp.mul(uniforms.uTexel).mul(2.0));

    const v = uniforms.uFog.sample(uv().add(warp)).r.toVar('shroudV');

    /*
     * Sub-cell dither at the frontier. Screen-space on purpose: it keeps its
     * size at every zoom, which is what makes it read as a stipple rather than
     * as texture noise. `gl_FragCoord.xy` -> `screenCoordinate.xy`, the same
     * quantity on both backends.
     */
    v.addAssign(shroudBayer4(screenCoordinate.xy).sub(0.46875).mul(uniforms.uDither));

    // Ascending edges with the inversion outside, exactly as the GLSL wrote
    // them — and now for a second reason: a descending `smoothstep` is
    // UNDEFINED in WGSL, where GLSL merely left it unspecified.
    const remembered = smoothstep(0.0, uniforms.uExploredLevel, v).oneMinus()
      .toVar('shroudRemembered');
    const fogged = smoothstep(uniforms.uExploredLevel, 1.0, v).oneMinus().toVar('shroudFogged');

    const a = mix(uniforms.uExploredAlpha.mul(fogged), uniforms.uUnexploredAlpha, remembered)
      .toVar('shroudA');
    Discard(a.lessThanEqual(0.003));

    const col = mix(uniforms.uExploredTint, uniforms.uUnexploredColor, remembered)
      .toVar('shroudCol');
    return vec4(col, a);
  });

  const material = new NodeMaterial();
  material.name = 'ShroudNodeMaterial';
  material.fragmentNode = carpet() as unknown as Vec4N;
  material.transparent = true;
  // DEPTH ON. The carpet owns the GROUND PLANE only; anything standing above it
  // tints itself from the same mask via `shroudTint`. See `FogOfWar.ts` §1b for
  // the 3,600-frame measurement that settled this.
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // Scene fog on the shroud would tint the shroud toward the sky, which is both
  // wrong and, per the bible §1, a thing we do not have anyway.
  material.fog = false;
  material.toneMapped = false;

  return {
    material,
    uniforms,

    setFogTexture(tex: THREE.Texture): void { uniforms.uFog.value = tex; },
    setTime(t: number): void { uniforms.uTime.value = t; },

    applyLook(next: ShroudLook): void {
      const rgb = carpetScratchRgb;
      hexToLinearRgb(next.exploredTint, rgb as unknown as number[]);
      uniforms.uExploredTint.value.set(rgb[0], rgb[1], rgb[2]);
      /*
       * The self-tint has to move with it, or a mood change re-tints the ground
       * and leaves every building and ship on the old palette — `FogOfWar`'s own
       * `applyLook` writes both for that reason. Writing `shroudUniforms` here
       * reaches the node path too, because §1's mirrored uniforms PULL from it.
       */
      shroudUniforms.uFogTint.value.set(rgb[0], rgb[1], rgb[2], FOG_EXPLORED_ALPHA);
      hexToLinearRgb(next.unexploredColor, rgb as unknown as number[]);
      uniforms.uUnexploredColor.value.set(rgb[0], rgb[1], rgb[2]);
      shroudUniforms.uFogDark.value.set(rgb[0], rgb[1], rgb[2], FOG_UNEXPLORED_ALPHA);
      uniforms.uNoiseScale.value = Math.max(1, next.noiseScale);
      uniforms.uNoiseSpeed.value = next.noiseSpeed;
    },

    dispose(): void {
      material.dispose();
      placeholder.dispose();
    },
  };
}

const carpetScratchRgb = new Float32Array(3);

/**
 * VOLTMARCH — src/render/nodes/ao-node.ts
 * =============================================================================
 * GTAO AS TSL NODES, AND THE SCENE SUBMISSION STAYS DELETED.
 *
 * `docs/RENDER_FINDINGS.md` §1 and CLAUDE.md's performance block both record the
 * same measurement: `GTAOPass` used to build its normal G-buffer by drawing the
 * whole scene a second time with `MeshNormalMaterial` — 39-57 draws per fixture,
 * 26.8-29.4% of every frame — and `installAoDepthGBuffer` in `post.ts` deleted
 * that submission by handing the pass the depth the colour pass already wrote.
 * `drawCallsByPass.ao` is 0 on all thirteen fixtures and a non-zero value means
 * the fallback came back.
 *
 * THE MIGRATION PLAN SAYS THAT SAVING "HAS NO DIRECT EQUIVALENT AND WOULD BE
 * REDONE FROM SCRATCH". Half of that turns out to be wrong and half of it is
 * exactly right, and the split matters:
 *
 *  - THE SCENE SUBMISSION IS GONE BY CONSTRUCTION. `GTAONode` does not own a
 *    scene or a camera-driven prepass at all. It is a full-screen quad over a
 *    depth node, and `pass(scene, camera).getTextureNode('depth')` is the depth
 *    the colour pass already wrote. There is nothing to delete because there is
 *    nothing to build: the node pipeline never had the second submission.
 *
 *  - THE SHADER-COST HALF IS REAL AND IS NOT FREE. Both `GTAONode` and
 *    `DenoiseNode` accept a null `normalNode` and reconstruct the view normal
 *    from depth in the shader instead. That is the one-line version and it is
 *    the trap `post.ts` already names: `GTAONode` hoists its reconstruction
 *    above the direction loop and pays for ONE, but `DenoiseNode` calls
 *    `sampleNormal` once for the centre tap and AGAIN INSIDE ITS 16-SAMPLE LOOP
 *    — SEVENTEEN reconstructions per denoised pixel, each nine `textureLoad`s
 *    and three inverse-projection transforms. That is the same trade `post.ts`
 *    refused (`NORMAL_VECTOR_TYPE = 0`), for the same reason, against a shader
 *    cost this repo has no instrument for.
 *
 * So the reconstruction happens ONCE, into a texture, and both consumers read
 * it: `normalFromDepthTexture()` below is an `RTTNode` over three's own
 * `getNormalFromDepth` — one full-screen quad at the AO resolution — and it is
 * handed to `ao()` and to `denoise()` as their `normalNode`. Structurally
 * identical to `installAoDepthGBuffer`; expressed in fifteen lines instead of
 * seventy, because the node pipeline does not need the six private internals of
 * `GTAOPass` that the WebGL wiring reaches into.
 *
 * ── ONE REAL DIFFERENCE FROM THE WEBGL PATH, STATED PLAINLY ──────────────────
 * The WebGL normal target is RGBA8 and the quad packs `n * 0.5 + 0.5` into it,
 * because `MeshNormalMaterial` wrote packed normals and both consumers call
 * `unpackRGBToNormal`. The node consumers do `normalNode.sample(uv).rgb.normalize()`
 * with NO unpack, so the texture must carry SIGNED values and therefore a
 * float format: it is `HalfFloatType` here. At the shipped half resolution that
 * is 1280x720 x RGBA16F = 7.4 MB against 3.7 MB, and it buys a normal that is
 * not quantised to 8 bits per axis. It is the smaller cost of the two available
 * — the alternative is to bake an unpack into a node that `ao()` would then have
 * to `.sample()`, and `sample` exists on a texture node, not on an expression.
 *
 * ── AND ONE DEFECT THE PORT WOULD HAVE INHERITED ─────────────────────────────
 * `DenoiseNode.generateDefaultNoise()` builds its 64x64 rotation texture from
 * `new SimplexNoise()`, whose default RNG is `Math` — the EXACT defect
 * `post.ts#seedAoDenoiseNoise` exists to fix on the WebGL side, arrived at
 * independently in three's node port. Unseeded it makes the screenshot harness
 * unable to produce the same image twice (27% of subpixels move between boots).
 * `seedDenoiseNoise()` below is the same fix with the same seed from
 * `ao-params.ts`, so both backends produce the same rotation field.
 */

import { DataTexture, HalfFloatType, RGBAFormat, RepeatWrapping, UnsignedByteType, Vector3 } from 'three/webgpu';
import type { Camera, DepthTexture, Node, TextureNode } from 'three/webgpu';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { float, getNormalFromDepth, mix, rtt, texture, uniform, uv } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

import { Rng } from '../../core/math';
import type { AoConfig } from '../renderer';
import {
  AO_HALF_RES_SCALE,
  AO_NOISE_SEED,
  AO_NOISE_SIZE,
  aoDenoiseParams,
  aoMarchParams,
  denoiseSampleDisc,
} from '../ao-params';

type Vec3 = Node<'vec3'>;
type Flt = Node<'float'>;

/**
 * An `RTTNode`: a texture node that owns the target it renders into.
 *
 * `@types/three` declares `rtt()` as returning a plain `TextureNode`, which
 * hides the two members the resolution rule is expressed through. Named here so
 * the cast happens once, at construction, rather than at every use.
 */
type RttNode = TextureNode & {
  setResolutionScale(scale: number): void;
  readonly renderTarget: { texture: { name: string }; dispose(): void };
};

/**
 * `getNormalFromDepth`'s second parameter is the DEPTH TEXTURE, not a node — it
 * does `textureLoad` at integer offsets, and that needs the texture object.
 * three's own `GTAONode` passes `this.depthNode.value` for exactly this reason.
 * `@types/three` declares the parameter as `Node`, so the call needs one named
 * cast; widening it here keeps the rest of the module honestly typed.
 */
const normalFromDepth = getNormalFromDepth as unknown as
  (uvNode: Node<'vec2'>, depth: DepthTexture, projectionMatrixInverse: Node) => Vec3;

/** The AO chain's resolution as a fraction of the drawing buffer. */
export function aoResolutionScale(halfRes: boolean): number {
  return halfRes ? AO_HALF_RES_SCALE : 1;
}

/**
 * One full-screen quad that reconstructs view-space normals from the scene's own
 * depth — the node-pipeline twin of `NORMAL_FROM_DEPTH_FRAG` in `post.ts`.
 *
 * The body is three's own `getNormalFromDepth`, which is the same nine-tap
 * "pick the continuous side across the depth discontinuity" heuristic that
 * `post.ts` transcribed out of `GTAOShader.js`. Using three's version rather
 * than porting ours keeps the two chains reconstructing the same normal from the
 * same depth, and means a three upgrade moves both together.
 *
 * `getNormalFromDepth` wants the DEPTH TEXTURE ITSELF, not a node — it does
 * `textureLoad` at integer offsets, which needs the texture object. That is why
 * this takes `pass.renderTarget.depthTexture` rather than
 * `pass.getTextureNode('depth')`.
 */
export function normalFromDepthTexture(
  depthTexture: DepthTexture,
  camera: Camera,
  resolutionScale: number,
): RttNode {
  const projectionMatrixInverse = uniform(camera.projectionMatrixInverse);
  const normals = rtt(
    normalFromDepth(uv(), depthTexture, projectionMatrixInverse),
    null,
    null,
    {
      // SIGNED values, so not an 8-bit target. See the file header.
      type: HalfFloatType,
      format: RGBAFormat,
      // A normal buffer has nothing to depth-test against; the quad covers it.
      depthBuffer: false,
      stencilBuffer: false,
    },
  );
  const node = normals as unknown as RttNode;
  node.setResolutionScale(resolutionScale);
  node.renderTarget.texture.name = 'AoNormalFromDepth';
  return node;
}

/**
 * RESEED THE DENOISE ROTATION FIELD. It ships seeded from `Math.random()`.
 *
 * Same fix, same seed and the same generator formula as
 * `post.ts#seedAoDenoiseNoise`, so a frame captured under either backend gets
 * the identical rotation field. See `AO_NOISE_SEED`.
 *
 * The texture is REPLACED rather than rewritten in place because `DenoiseNode`
 * has already wrapped the old one in a `texture()` node; assigning
 * `node.noiseNode` is what the shader will actually read.
 *
 * **AND THE REPLACEMENT MUST BE WRAPPED AGAIN.** `noiseNode` is a NODE, not a
 * texture: `DenoiseNode` constructs it as `texture( generateDefaultNoise() )`,
 * and its body calls `this.noiseNode.sample( uv )` and
 * `textureSize( this.noiseNode, 0 )`. Assigning the bare `DataTexture` threw
 * `TypeError: this.noiseNode.sample is not a function` on the FIRST REAL FRAME —
 * inside `THREE.TSL`'s own catch, so it printed three times and left the AO
 * silently absent instead of failing the boot.
 *
 * Nothing offline saw it. `tests/post-nodes.spec.ts` reads
 * `denoised.node.noiseNode.image.data` to prove the seed is deterministic, and a
 * `DataTexture` HAS `.image.data` — so the assertion passed on the wrong shape.
 * Fifth instance of this stage's standing lesson: offline compilation is
 * necessary and not sufficient. The spec asserts the node wrapper now.
 */
export function seedDenoiseNoise(node: { noiseNode: unknown }): DataTexture {
  const size = AO_NOISE_SIZE;
  const rng = new Rng(AO_NOISE_SEED);
  const simplex = new SimplexNoise({ random: () => rng.next() });
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const o = (i * size + j) * 4;
      data[o] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[o + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[o + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[o + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.name = 'AoDenoiseNoise';
  tex.needsUpdate = true;
  return tex;
}

/** What the two node objects need from config, plus the scene inputs. */
export interface CreateAoOptions {
  /** `pass(scene, camera).getTextureNode('depth')`. */
  depthNode: Node;
  /** `pass(scene, camera).renderTarget.depthTexture` — the raw texture. */
  depthTexture: DepthTexture;
  camera: Camera;
  cfg: AoConfig;
}

export interface AoNodes {
  /** The reconstructed view-normal texture, shared by the march and the denoise. */
  readonly normals: RttNode;
  /** three's `GTAONode`. Its uniforms are live; `applyAoNodeConfig` writes them. */
  readonly march: AoMarchNode;
  /** three's `DenoiseNode`, materialised into its own half-res target. */
  readonly denoised: RttNode;
  /**
   * `mix(1, ao, intensity)` — the factor the scene colour is MULTIPLIED by.
   *
   * `GTAOPass.OUTPUT.Default` composites with `GTAOBlendShader`, which is
   * `mix(vec3(1.0), aoTexel.rgb, intensity)` under a `DstColor/Zero` blend, i.e.
   * exactly this. In the node chain it is an expression folded into the frame's
   * composite rather than a pass of its own, which deletes the copy-then-blend
   * pair `installAoInPlaceComposite` had to unpick by hand — 6.02 ms of the
   * two, half of it a full-resolution RGBA16F copy that existed only to seed a
   * multiply.
   */
  occlusion(): Flt;
  applyConfig(cfg: AoConfig): void;
  dispose(): void;
}

/** The subset of `GTAONode` this module drives. Its uniforms are `UniformNode`s. */
interface AoMarchNode {
  resolutionScale: number;
  radius: { value: number };
  thickness: { value: number };
  distanceExponent: { value: number };
  scale: { value: number };
  samples: { value: number };
  useTemporalFiltering: boolean;
  getTextureNode(): TextureNode;
  dispose(): void;
}

/** The subset of `DenoiseNode` this module drives. */
interface DenoiseNodeLike {
  lumaPhi: { value: number };
  depthPhi: { value: number };
  normalPhi: { value: number };
  radius: { value: number };
  noiseNode: unknown;
  _sampleVectors?: { array: Vector3[] };
}

/**
 * Build the AO half of the chain.
 *
 * THE PASS COUNT IS THE SAME AS THE WEBGL CHAIN'S AND SO ARE THE RESOLUTIONS:
 * one quad reconstructs normals, one marches GTAO, one denoises, all three at
 * `aoResolutionScale(halfRes)`; the composite is an expression in the frame's
 * own pass rather than a fourth and fifth quad. `GTAOPass` at the same settings
 * runs normal-quad + march + denoise + copy + blend.
 */
export function createAoNodes(options: CreateAoOptions): AoNodes {
  const { depthNode, depthTexture, camera, cfg } = options;
  const scale = aoResolutionScale(cfg.halfRes);

  const normals = normalFromDepthTexture(depthTexture, camera, scale);

  const march = ao(depthNode, normals, camera) as unknown as AoMarchNode;
  march.resolutionScale = scale;
  /*
   * NO TEMPORAL FILTERING, AND IT IS NOT A TUNING CHOICE.
   *
   * `GTAONode.useTemporalFiltering` rotates the sample directions per FRAME ID
   * and requires `TRAANode` downstream to resolve the noise it deliberately
   * introduces. We have no TAA — CLAUDE.md bans motion blur and the chain ends
   * in SMAA, a morphological pass with no history buffer — so switching it on
   * would be a per-frame shimmer with nothing to average it. It also makes the
   * frame depend on a frame COUNTER, which is precisely what the shot harness
   * needs not to be true: `post.ts#seedAoDenoiseNoise` exists because 27% of
   * subpixels moved between two boots of one build.
   */
  march.useTemporalFiltering = false;

  const denoiseNode = denoise(march.getTextureNode(), depthNode, normals, camera);
  const denoiseLike = denoiseNode as unknown as DenoiseNodeLike;
  denoiseLike.noiseNode = texture(seedDenoiseNoise(denoiseLike));

  /*
   * MATCH `GTAOPass`'s SAMPLE DISC, WHICH IS NOT `DenoiseNode`'s.
   *
   * Both walk 16 taps over 2 rings, but `GTAOPass.pdRadiusExponent` is 2 and
   * `DenoiseNode` builds its array with exponent 1 — the taps end up evenly
   * spread along the radius instead of clustered toward the centre. Same
   * count, same cost, a different filter. `denoiseSampleDisc()` is the shared
   * transcription; if the private array is ever renamed we leave three's own
   * disc alone rather than half-applying this.
   */
  const disc = denoiseSampleDisc();
  const vectors = denoiseLike._sampleVectors;
  if (vectors !== undefined && Array.isArray(vectors.array) && vectors.array.length === disc.length) {
    for (let i = 0; i < disc.length; i++) {
      vectors.array[i].set(disc[i].x, disc[i].y, disc[i].z);
    }
  }

  /*
   * THE DENOISE IS MATERIALISED, NOT INLINED.
   *
   * `DenoiseNode` is a `TempNode` returning an expression, so consuming it
   * directly would inline a 16-tap bilateral filter into whatever pass reads it
   * — and the pass that reads it is the FULL-RESOLUTION composite, which would
   * run the filter at 4x the pixels the WebGL chain runs it at. `GTAOPass`
   * renders its denoise into `pdRenderTarget` at the AO resolution and the
   * blend samples that through a `LinearFilter`; `rtt` at the same scale is the
   * same arrangement, and `RenderTarget`'s default filters are linear.
   */
  const denoised = rtt(denoiseNode, null, null, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  }) as unknown as RttNode;
  denoised.setResolutionScale(scale);
  denoised.renderTarget.texture.name = 'AoDenoised';

  const intensity = uniform(cfg.intensity);

  const nodes: AoNodes = {
    normals,
    march,
    denoised,
    occlusion(): Flt {
      const term = (denoised as unknown as { r: Flt }).r;
      return mix(float(1), term, intensity);
    },
    applyConfig(next: AoConfig): void {
      const m = aoMarchParams(next);
      march.radius.value = m.radius;
      march.distanceExponent.value = m.distanceExponent;
      march.thickness.value = m.thickness;
      march.scale.value = m.scale;
      march.samples.value = m.samples;

      const d = aoDenoiseParams(next);
      denoiseLike.lumaPhi.value = d.lumaPhi;
      denoiseLike.depthPhi.value = d.depthPhi;
      denoiseLike.normalPhi.value = d.normalPhi;
      denoiseLike.radius.value = d.radius;

      intensity.value = next.intensity;

      /*
       * `halfRes` moves three render targets, so it is a TRANSITION rather than
       * a per-frame assignment — the same shape as `post.ts#applyAoConfig`,
       * where it cannot be folded in with the scalars because it re-drives
       * `setSize`. `RTTNode.setResolutionScale` and `GTAONode.resolutionScale`
       * are both read on the next `updateBefore`, so writing them is enough.
       */
      const nextScale = aoResolutionScale(next.halfRes);
      march.resolutionScale = nextScale;
      normals.setResolutionScale(nextScale);
      denoised.setResolutionScale(nextScale);
    },
    dispose(): void {
      march.dispose();
      normals.renderTarget.dispose();
      denoised.renderTarget.dispose();
    },
  };

  nodes.applyConfig(cfg);
  return nodes;
}

/** Re-exported so the chain and its tests name one resolution rule. */
export { AO_HALF_RES_SCALE };
export type { Vec3 };

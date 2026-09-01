/**
 * VOLTMARCH — src/render/post-nodes.ts
 * =============================================================================
 * THE POST CHAIN AS ONE TSL GRAPH. Stage B of the WebGPU migration.
 *
 * Same order as `post.ts`, and `PASS_ORDER` is imported rather than restated:
 *
 *      scene  ->  AO  ->  Irradiance  ->  Bloom  ->  Grade  ->  SMAA
 *      [ HDR, linear, RGBA16F .............]  [ LDR, sRGB ]
 *
 * Read `post.ts`'s header for WHY that order — the argument (tonemapping off the
 * renderer so HDR survives to the bloom threshold, AO before bloom so an
 * occluded crevice cannot bloom, SMAA last where edge detection wants to be) is
 * about the image and is identical under either renderer. This file records only
 * what changes when the chain stops being a list of passes and becomes a graph.
 *
 * ── A GRAPH IS NOT A PIPELINE, AND THE SPLIT HERE IS DELIBERATE ──────────────
 * `buildPostGraph()` takes a scene, a camera and config and returns nodes. It
 * needs NO renderer, NO GL context and NO device, so the whole of this stage is
 * testable in `npm test`: `tests/post-nodes.spec.ts` compiles the graph to WGSL
 * with three's own `WGSLNodeBuilder` and reads the emitted shader.
 *
 * That matters more here than it would elsewhere. `docs/RENDER_FINDINGS.md` §5:
 * the WebGL grade ran on its constructor literals for its ENTIRE LIFE because
 * `ShaderPass` deep-copies a plain shader description, and every guard pointed
 * at config passed throughout. The lesson recorded there is "read the uniform
 * off a booted page". A compiled-shader assertion is not a booted page — it
 * proves the graph, not the frame — but it is the first instrument this project
 * has had that looks at the SHADER rather than at the number that was supposed
 * to reach it, and it runs on every commit rather than on a browser someone
 * remembered to open.
 *
 * `createNodePostChain()` is then a thin binding of that graph to a
 * `RenderPipeline`, and is the only part that needs a live renderer.
 *
 * ── THREE PASSES THE WEBGL CHAIN PAYS FOR AND THIS ONE DOES NOT ──────────────
 * Not a claim about frame time — nobody has measured one, and the coordinator's
 * spike says WebGPU is 1.7-2.1x SLOWER above 1000 draws and indistinguishable at
 * our 54-76, so no speed claim belongs here at all. It is a claim about the
 * STRUCTURE, which is readable off both files:
 *
 *  1. GTAO's normal prepass. Gone by construction — see `nodes/ao-node.ts`.
 *     `installAoDepthGBuffer` had to reach into six private members of
 *     `GTAOPass` to delete it; `GTAONode` never had it.
 *  2. GTAO's copy-then-blend composite. `installAoInPlaceComposite` unpicked the
 *     copy by hand (measured at 6.02 ms for the pair, half of it a full-res
 *     RGBA16F copy existing only to seed a multiply). Here the occlusion term is
 *     an expression folded into the frame's own composite.
 *  3. The bloom additive blit. `UnrealBloomPass` ends with a full-screen
 *     additive quad over the read buffer; here the `.add()` is a term in the
 *     same composite.
 *
 * ── AND THE MATERIALISATIONS IT GAINS ─────────────────────────────────────────
 * Bloom's high pass and grade's unsharp mask SAMPLE their inputs at offsets, so
 * both must see textures rather than re-evaluated expressions. `bloomInput`
 * reproduces the full-resolution HDR buffer UnrealBloomPass reads; `gradeInput`
 * gives the grade its four neighbour taps. The WebGL composer gets both buffers
 * from its ping-pong chain. The node graph has to state them explicitly.
 */

import {
  DoubleSide,
  HalfFloatType,
  MeshBasicNodeMaterial,
  NodeUpdateType,
  RGBAFormat,
  RenderPipeline,
  UnsignedByteType,
  Vector2,
} from 'three/webgpu';
import type { Camera, DepthTexture, Material, Node, PerspectiveCamera, Renderer, Scene, TextureNode } from 'three/webgpu';
import {
  clamp,
  depthPass,
  equal,
  float,
  mrt,
  output as sceneOutput,
  pass,
  rtt,
  select,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';

import { PASS_ORDER, type PassId } from './post-order';
import { RENDER_CONFIG, type PostConfig } from './renderer';
import { createAoNodes, type AoNodes } from './nodes/ao-node';
import {
  createSsgiNodes,
  capabilityGatedSsgiPreset,
  requestedSsgiPreset,
  type SsgiNodes,
  type SsgiPreset,
} from './nodes/ssgi-node';
import { createBloomNodes, type BloomNodes } from './nodes/bloom-node';
import {
  applyGradeConfig,
  createGradeUniforms,
  gradeNode,
  setGradeTexel,
  type GradeNodeUniforms,
} from './nodes/grade-node';
import { createAtmosphereNodes, type AtmosphereNodes } from './nodes/atmosphere-node';
import { createIrradianceNodes, type IrradianceNodes } from './nodes/irradiance-node';
import { IRRADIANCE_FIELD_SIZE, type IrradianceFieldUpdate } from '../core/irradiance-field';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/**
 * Half float can represent much more, but no authored VOLTMARCH HDR source
 * needs energy above this. Bounding it also converts +/-Infinity to a finite
 * value before bloom downsamples the frame.
 */
export const POST_HDR_FINITE_LIMIT = 64;

/**
 * Last-resort containment at the HDR/post boundary.
 *
 * A NaN can originate in imported art, an instance attribute, SSGI, or a
 * future screen-space effect. `clamp(NaN)` is still NaN, so test each channel
 * against itself first (the IEEE value for which x != x is NaN), then select a
 * black fallback. This intentionally sits before temporal history and bloom:
 * one malformed object may lose its own pixel, but it cannot poison the whole
 * frame or persist in history.
 */
export function finiteHdrNode(input: Node<'vec4'>, label = 'postHdr'): Node<'vec4'> {
  const unchecked = (input as unknown as { rgb: Node<'vec3'> }).rgb
    .toVar(`${label}Unchecked`);
  const bounded = clamp(unchecked, 0, POST_HDR_FINITE_LIMIT)
    .toVar(`${label}Bounded`);
  const safe = vec3(
    select(equal(unchecked.r, unchecked.r), bounded.r, 0),
    select(equal(unchecked.g, unchecked.g), bounded.g, 0),
    select(equal(unchecked.b, unchecked.b), bounded.b, 0),
  )
    .toVar(`${label}Finite`);
  return vec4(safe, float(1)) as unknown as Node<'vec4'>;
}

/** An `RTTNode` — see the identical alias and reasoning in `nodes/ao-node.ts`. */
type RttNode = TextureNode & {
  setResolutionScale(scale: number): void;
  updateBeforeType: string;
  readonly renderTarget: { texture: { name: string }; dispose(): void };
};

/** The subset of `PassNode` this module drives. */
interface ScenePassNode {
  getTextureNode(name?: string): TextureNode;
  setResolutionScale(scale: number): void;
  setMRT(node: Node): void;
  overrideMaterial: Material | null;
  compileAsync(renderer: Renderer): Promise<void>;
  readonly renderTarget: {
    depthTexture: DepthTexture;
    texture: { name: string };
    /** Actual sample count baked into this live target, not the requested config. */
    samples: number;
    dispose(): void;
  };
  dispose(): void;
}

/** The subset of `SMAANode` this module drives. */
interface SmaaNodeLike {
  _renderTargetEdges?: { texture: { type: number; name?: string } };
  _renderTargetWeights?: { texture: { type: number; name?: string } };
  dispose(): void;
}

/** The public surface of Three's WebGPU temporal resolve used by this chain. */
interface TemporalAaNodeLike extends Node<'vec4'> {
  readonly isTRAANode?: true;
  readonly isTAAUNode?: true;
  maxVelocityLength: number;
  useSubpixelCorrection?: boolean;
  currentFrameWeight?: number;
  dispose(): void;
}

export type TemporalAaMode = 'traa' | 'taau';

export interface PostGraph {
  /** The finished `vec4`. Hand this to a `RenderPipeline` as its `outputNode`. */
  readonly output: Node<'vec4'>;
  /**
   * Whether the OUTPUT is already display-encoded.
   *
   * `false` means the grade did the tonemap and the sRGB write, so the pipeline
   * must NOT apply its own output transform — the node twin of `post.ts` forcing
   * `NoToneMapping` on the renderer whenever the grade pass is live. `true` means
   * the grade is disabled and the renderer's own transform should run, which is
   * the same fallback `rebuild()` takes.
   */
  readonly needsOutputColorTransform: boolean;
  /** Which passes are in this graph. Missing = disabled, exactly as `passes` in `post.ts`. */
  readonly built: Readonly<Partial<Record<PassId, true>>>;
  readonly scenePass: ScenePassNode;
  /** Dedicated motion-vector submission used only by the TRAA experiment. */
  readonly velocityPass: ScenePassNode | null;
  /**
   * A single-sample depth-only pass used when scene colour is multisampled.
   *
   * WebGPU cannot resolve a multisampled depth attachment into a sampleable
   * depth texture. AO performs integer `textureLoad` taps, so pointing it at
   * the scene pass's MSAA depth emits invalid WGSL (`textureDimensions` with a
   * mip argument on `texture_depth_multisampled_2d`). Colour keeps MSAA; this
   * small depth prepass gives AO a legal texture. Null in the normal 0x-MSAA
   * path and whenever AO is disabled.
   */
  readonly aoDepthPass: ScenePassNode | null;
  readonly ao: AoNodes | null;
  /** Fused HDR atmosphere expression; no independent render target or draw. */
  readonly atmosphere: AtmosphereNodes | null;
  /** Quality-selected local indirect diffuse on capable High/Ultra WebGPU boots. */
  readonly ssgi: SsgiNodes | null;
  /** Default-on world-space cache, present independently of the SSGI experiment. */
  readonly irradiance: IrradianceNodes;
  readonly indirectLighting: 'irradiance' | 'irradiance+gtao' | 'irradiance+ssgi';
  /** Why an explicitly requested SSGI path fell back to GTAO, if it did. */
  readonly ssgiFailure: string | null;
  readonly bloom: BloomNodes | null;
  /** Full-resolution HDR materialisation sampled by BloomNode's half-res high pass. */
  readonly bloomInput: RttNode | null;
  /** True when the grade composite samples bloom's existing HDR materialisation. */
  readonly reusesBloomInput: boolean;
  readonly gradeUniforms: GradeNodeUniforms | null;
  /** Experimental motion-aware AA, enabled only by `?aa=traa|taau` on WebGPU. */
  readonly temporalAa: TemporalAaNodeLike | null;
  /** Low-resolution HDR input materialisation owned by TAAU. */
  readonly temporalInput: RttNode | null;
  readonly antialiasing: TemporalAaMode | 'smaa' | 'off';
  /**
   * Construction errors, keyed by pass id. Empty on a healthy boot.
   *
   * The same contract as `PostChain.failures`, and it exists for the same
   * reason: `post.ts` builds every pass inside its own try/catch so that a pass
   * that cannot be constructed is OMITTED rather than taking the frame with it,
   * and the game never fails to draw. A graph is if anything more brittle than a
   * pass list — a node that throws in its constructor takes the whole output
   * expression with it — so the guard belongs here too.
   */
  readonly failures: Readonly<Partial<Record<PassId, string>>>;
  /** Push `RENDER_CONFIG.post` live; rebuild only when graph shape changes. */
  syncConfig(cfg: PostConfig): void;
  /** Drawing-buffer pixels. Only the grade's texel uniform needs telling. */
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface BuildPostGraphOptions {
  scene: Scene;
  camera: Camera;
  cfg: PostConfig;
  /** Initial drawing-buffer size, for the grade's texel uniform. */
  width: number;
  height: number;
  /** Already capability-gated by `createNodePostChain`; null keeps shipped GTAO. */
  ssgiPreset?: SsgiPreset | null;
  /** Reversible WebGPU experiment. The shipped/default graph remains SMAA. */
  temporalAa?: TemporalAaMode | false;
  /** Input-buffer scale for TAAU. Ignored by TRAA and clamped to 50-100%. */
  temporalScale?: number;
  /** Reversible frame-graph control. False reproduces the pre-Batch-9 graph. */
  reuseBloomInput?: boolean;
}

/**
 * Parse the development switch without making it part of persisted settings.
 *
 * A URL gate is deliberate for the first visual/performance scorecard: it lets
 * the same build produce an exact SMAA control and TRAA candidate without a
 * settings migration or a graph rebuild while a match is running.
 */
export function requestedTemporalAa(search: string): TemporalAaMode | null {
  const value = new URLSearchParams(search).get('aa')?.toLowerCase();
  return value === 'traa' || value === 'taau' ? value : null;
}

export function requestedTemporalScale(search: string): number {
  const raw = Number(new URLSearchParams(search).get('taauScale') ?? 0.75);
  return Number.isFinite(raw) ? Math.max(0.5, Math.min(1, raw)) : 0.75;
}

/**
 * Batch-9 A/B control for the redundant HDR expression evaluation.
 *
 * The optimized graph is the default. `?postreuse=legacy` keeps an exact
 * same-build rollback arm for visual and timing gates without persisting a
 * player-facing setting.
 */
export function requestedBloomInputReuse(search: string): boolean {
  return new URLSearchParams(search).get('postreuse')?.toLowerCase() !== 'legacy';
}

/**
 * TAAU's reconstruction filter intentionally suppresses high-frequency noise.
 * Restore only luma detail in the existing full-resolution grade rather than
 * paying for another pass or sharpening RGB channels into coloured halos.
 */
export function taauSharpen(base: number, inputScale: number): number {
  const scale = Math.max(0.5, Math.min(1, inputScale));
  return Math.min(1, Math.max(0, base) + (1 - scale) * 2);
}

/**
 * Which passes a config asks for.
 *
 * `render` is unconditional — it is the scene — and `post.ts#setPassEnabled`
 * refuses to touch it for the same reason. Pure and exported so
 * `tests/post-nodes.spec.ts` can enumerate every combination without building a
 * graph for each.
 */
export function enabledPasses(cfg: PostConfig): Record<PassId, boolean> {
  return {
    render: true,
    ao: cfg.ao.enabled,
    bloom: cfg.bloom.enabled,
    grade: cfg.grade.enabled,
    smaa: cfg.smaa.enabled,
  };
}

/** Rebuild signature for stages whose presence changes the node graph. */
export function postGraphSignature(cfg: PostConfig): string {
  return JSON.stringify({
    ...enabledPasses(cfg),
    atmosphere: cfg.atmosphere.enabled,
    /*
     * MSAA IS GRAPH SHAPE ON WEBGPU.
     *
     * `PassNode` bakes `samples` into its render target when the graph is
     * constructed. The shell builds the renderer first and only then applies
     * the persisted Graphics profile, so a saved `msaa: true` reaches this
     * module as `0 -> 4` after the initial graph already exists. Leaving the
     * sample count out of this signature made `syncConfig` take the uniform-only
     * branch: Settings displayed 4x MSAA while the live scene target remained
     * single-sampled for the entire match. Thin roof rails and panel edges then
     * broke into the exact black/dashed crawl that coverage AA is meant to fix.
     *
     * Include the effective integer count rather than the raw number so two
     * equivalent requests do not rebuild the whole pipeline needlessly.
     */
    msaaSamples: Number.isFinite(cfg.msaaSamples)
      ? Math.max(0, Math.floor(cfg.msaaSamples))
      : 0,
  });
}

/**
 * SMAA's two internal targets hold 0..1 MASKS. Give them 8 bits.
 *
 * The identical change, for the identical reason, as
 * `post.ts#demoteSmaaTargets`: `_renderTargetEdges` is a two-channel edge mask
 * and `_renderTargetWeights` is the blend-weight lookup, both defined on 0..1,
 * and Jimenez et al. specify RG8 and RGBA8 for exactly these. `SMAANode`
 * hardcodes `HalfFloatType` on both, same as `SMAAPass`. Four full-resolution
 * surfaces halve: 29.5 MB to 14.75 MB each at 2560x1440, on a frame that
 * profiling showed is bandwidth-bound.
 *
 * The precondition is the same one and it is still load-bearing: SMAA runs LAST,
 * on the image the grade has already encoded to display sRGB.
 * `tests/post-nodes.spec.ts` pins the ordering next to this reasoning so the two
 * cannot drift apart.
 *
 * Only the TYPE is changed, and only before the first render — `RenderTarget`
 * allocates lazily, so there is nothing to reallocate. If either member is ever
 * renamed upstream we leave the node exactly as three built it rather than
 * half-applying this.
 */
export function demoteSmaaMaskTargets(node: SmaaNodeLike): boolean {
  const edges = node._renderTargetEdges;
  const weights = node._renderTargetWeights;
  if (edges === undefined || weights === undefined) {
    if (DEV) console.warn('[post-nodes] SMAA internals not found — mask targets left half-float');
    return false;
  }
  edges.texture.type = UnsignedByteType;
  weights.texture.type = UnsignedByteType;
  // These names are also the stable timestamp labels used by WebGpuTimer.
  edges.texture.name = 'SMAAEdges';
  weights.texture.name = 'SMAAWeights';
  return true;
}

/**
 * Build the whole chain as nodes. No renderer required.
 *
 * A pass being disabled REMOVES IT FROM THE GRAPH rather than muting it, which
 * is why a toggle rebuilds: there is no `enabled` flag on a node the way there
 * is on a `Pass`. `createNodePostChain` handles that by marking the pipeline
 * dirty, which is the node twin of `post.ts#rebuild` setting `chainDirty` and
 * the next `render()` drawing a throwaway frame first.
 */
export function buildPostGraph(options: BuildPostGraphOptions): PostGraph {
  const { scene, camera, cfg } = options;
  const temporalMode = options.temporalAa || null;
  const useTemporalAa = temporalMode !== null;
  const temporalScale = temporalMode === 'taau'
    ? Math.max(0.5, Math.min(1, options.temporalScale ?? 0.75))
    : 1;
  const reuseBloomInput = options.reuseBloomInput ?? true;
  const want = enabledPasses(cfg);
  const built: Partial<Record<PassId, true>> = { render: true };
  const failures: Partial<Record<PassId, string>> = {};

  /*
   * MSAA GOES ON THE SCENE PASS AND NOWHERE ELSE, WHICH IS WHAT `post.ts`'s
   * HEADER SPENT A PAGE BUILDING BY HAND.
   *
   * There, `EffectComposer` clones the target it is handed, so `samples` on the
   * composer target multisampled every buffer in the chain and each pass then
   * forced its own resolve — five resolves where the geometry needed one, and a
   * measured 7-8 fps of ~22 on an integrated Radeon. `PassNode` owns exactly one
   * target and nothing downstream inherits from it, so the shape is correct by
   * construction here.
   *
   * NOT VERIFIED ON A DEVICE: whether a multisampled pass target still hands
   * `getNormalFromDepth` a resolved, sampleable depth texture under either
   * backend. `msaaSamples` defaults to 0 and no quality tier turns it on
   * (`PostConfig.msaaSamples` explains why it stays off), so this is wired but
   * unexercised. Anyone who turns it on should check the AO first.
   */
  const sceneSamples = useTemporalAa ? 0 : cfg.msaaSamples;
  const scenePass = pass(scene, camera, {
    // TRAA owns subpixel coverage and Three explicitly forbids pairing it with
    // MSAA. The current shipped config is already 0; keep the invariant local
    // so an experimental URL can never create an invalid combination.
    samples: sceneSamples,
  }) as unknown as ScenePassNode;
  scenePass.renderTarget.texture.name = 'PostHDR';
  scenePass.setResolutionScale(temporalScale);

  const colour = scenePass.getTextureNode('output');

  /*
   * A dedicated pass is intentional, even though an MRT on `scenePass` looks
   * cheaper. The real device gate proved that a global colour+velocity MRT
   * leaks into nested shadow renders and materials with custom fragment nodes;
   * those pipelines then have a second target with no matching output and
   * WebGPU correctly rejects them. An unlit override isolates motion vectors
   * from every specialised beauty/shadow material. GPU-driven visibility is
   * the later optimisation that can amortise this extra submission.
   */
  let velocityPass: ScenePassNode | null = null;
  let velocityNode: TextureNode | null = null;
  if (useTemporalAa) {
    velocityPass = pass(scene, camera, { samples: 0 }) as unknown as ScenePassNode;
    const velocityMaterial = new MeshBasicNodeMaterial();
    velocityMaterial.name = 'TemporalVelocityOverride';
    // Foliage and troop cards are authored two-sided. Missing their back faces
    // from motion vectors is worse than the small extra raster cost here.
    velocityMaterial.side = DoubleSide;
    velocityPass.overrideMaterial = velocityMaterial;
    velocityPass.setResolutionScale(temporalScale);
    velocityPass.setMRT(mrt({
      output: sceneOutput,
      velocity,
    }) as unknown as Node);
    velocityNode = velocityPass.getTextureNode('velocity');

    /*
     * PassNode.compileAsync() sets the MRT but, unlike updateBefore(), does not
     * install its override material. That asks every beauty material to compile
     * against the velocity MRT and reproduces the exact invalid pipelines this
     * dedicated pass exists to avoid. Keep precompile and render semantically
     * identical. This wrapper can disappear when Three does so upstream.
     */
    const compileVelocityPass = velocityPass.compileAsync.bind(velocityPass);
    velocityPass.compileAsync = async (renderer: Renderer): Promise<void> => {
      const previousOverride = scene.overrideMaterial;
      scene.overrideMaterial = velocityMaterial;
      try {
        await compileVelocityPass(renderer);
      } finally {
        scene.overrideMaterial = previousOverride;
      }
    };

    // Do not rename attachment 0: MRTNode maps dictionary keys to texture slots
    // by Texture.name, and `output` must remain exactly `output` or slot 0 turns
    // into a sparse hole in the generated WGSL OutputType.
    velocityPass.renderTarget.texture.name = 'output';
  }

  /*
   * DEPTH MSAA HAS NO RESOLVE OPERATION IN WEBGPU.
   *
   * A multisampled colour target resolves into the ordinary texture returned
   * by `getTextureNode('output')`; depth/stencil has no equivalent WebGPU
   * resolve. Three therefore exposes the pass depth as
   * `texture_depth_multisampled_2d`. `getNormalFromDepth` uses textureLoad and
   * textureDimensions with a mip level, which is legal for single-sample depth
   * and illegal for multisampled depth. The device reports the WGSL error and
   * AO silently disappears.
   *
   * Keep the requested MSAA on scene colour and render depth once more into a
   * single-sample depth-only pass. This costs a depth prepass only in the exact
   * quality combination that needs it (AO + MSAA), preserves edge quality, and
   * avoids paying for a second shaded scene.
   */
  const aoDepthPass = want.ao && sceneSamples > 0
    ? depthPass(scene, camera, { samples: 0 }) as unknown as ScenePassNode
    : null;
  if (aoDepthPass !== null) aoDepthPass.renderTarget.texture.name = 'AoDepthPrepass';
  const depthSource = aoDepthPass ?? scenePass;
  const depthNode = depthSource.getTextureNode('depth');

  /* ---- AO ---------------------------------------------------------------- */
  let ao: AoNodes | null = null;
  let ssgiNodes: SsgiNodes | null = null;
  let ssgiFailure: string | null = null;
  let lit: Node<'vec4'> = colour;
  if (want.ao) {
    if (options.ssgiPreset !== null && options.ssgiPreset !== undefined) {
      try {
        ssgiNodes = createSsgiNodes({
          beautyNode: colour,
          depthNode,
          depthTexture: depthSource.renderTarget.depthTexture,
          camera: camera as PerspectiveCamera,
          ao: cfg.ao,
          preset: options.ssgiPreset,
        });
        const occluded = (colour as unknown as { mul(f: Node<'float'>): Node<'vec4'> })
          .mul(ssgiNodes.occlusion());
        /*
         * SSGINode returns sampled source radiance, not light already evaluated
         * at the receiving surface. Adding that RGB directly painted yellow
         * ground light over purple faction materials. Approximate the missing
         * receiving-albedo term with the pre-composite scene colour: this keeps
         * local bounce geometry while preserving faction hue and dark values.
         */
        const receiver = clamp(
          (colour as unknown as { rgb: Node<'vec3'> }).rgb, 0, 1,
        ) as Node<'vec3'>;
        const receivedBounce = (
          ssgiNodes.indirect() as unknown as { mul(n: Node<'vec3'>): Node<'vec3'> }
        ).mul(receiver);
        const bounce = vec4(receivedBounce, 0) as unknown as Node<'vec4'>;
        lit = (occluded as unknown as { add(n: Node<'vec4'>): Node<'vec4'> }).add(bounce);
      } catch (err) {
        ssgiFailure = String(err);
        console.warn('[post-nodes] SSGI failed to construct; falling back to GTAO', err);
      }
    }

    if (ssgiNodes === null) {
      ao = createAoNodes({
        depthNode,
        depthTexture: depthSource.renderTarget.depthTexture,
        camera,
        cfg: cfg.ao,
      });
      // `vec4 * float` — the alpha rides along, exactly as `GTAOBlendShader`'s
      // `vec4(mix(vec3(1.), texel.rgb, intensity), texel.a)` under a DstColor
      // multiply leaves it. See `AoNodes.occlusion`.
      lit = (colour as unknown as { mul(f: Node<'float'>): Node<'vec4'> }).mul(ao.occlusion());
    }
    if (useTemporalAa) {
      // Rotate the GTAO/SSGI sample pattern only when a downstream history
      // resolve exists. The default SMAA graph remains deterministic per frame.
      if (ao !== null) ao.march.useTemporalFiltering = true;
      if (ssgiNodes !== null) ssgiNodes.march.useTemporalFiltering = true;
    }
    built.ao = true;
  }

  /* ---- World-space indirect light ---------------------------------------
   * Always part of the capable WebGPU graph. A neutral zero field makes this
   * an exact no-op until the worker result arrives, while constructing the
   * sampler and output pipeline under the loading curtain prevents a late
   * compile. The existing AO/SSGI normal target is reused when available.
   */
  const irradiance = createIrradianceNodes({
    input: lit,
    depthNode,
    camera,
    normalNode: ssgiNodes?.normals ?? ao?.normals ?? null,
  });
  lit = irradiance.node;

  // Contain any upstream invalid HDR value before temporal history or bloom
  // can amplify it into a persistent whole-frame failure.
  lit = finiteHdrNode(lit, 'postPreTemporalHdr');

  /* ---- Temporal resolve --------------------------------------------------
   * Resolve scene + indirect lighting before bloom and grading. This gives
   * thin foliage, subpixel troops and AO one stable HDR history, while bloom
   * still sees a stable bright-pass source and the display transform remains
   * outside history. SMAA is omitted when this node is active: stacking both
   * softens UI-scale world detail and spends a second full-screen AA pass.
   */
  let temporalAa: TemporalAaNodeLike | null = null;
  let temporalInput: RttNode | null = null;
  if (useTemporalAa && velocityNode !== null) {
    if (temporalMode === 'taau') {
      // Materialise scene + AO/SSGI at the same lower resolution as depth and
      // velocity. Passing the expression directly would make TAAU's implicit
      // RTT full-size, erasing both the reconstruction ratio and much of the
      // intended GPU saving.
      temporalInput = rtt(lit) as unknown as RttNode;
      temporalInput.setResolutionScale(temporalScale);
      temporalInput.renderTarget.texture.name = 'TAAU.input';
      temporalAa = taau(temporalInput, depthNode, velocityNode, camera) as unknown as TemporalAaNodeLike;
      temporalAa.currentFrameWeight = 0.05;
    } else {
      temporalAa = traa(lit, depthNode, velocityNode, camera) as unknown as TemporalAaNodeLike;
      temporalAa.useSubpixelCorrection = true;
    }
    // Reject very fast motion sooner than Three's generic 128 px default. RTS
    // camera cuts and fast projectiles should prefer a fresh sample to a trail.
    temporalAa.maxVelocityLength = 64;
    lit = temporalAa;
  }

  /* ---- Cinematic atmosphere ---------------------------------------------
   * Fused into the next materialisation (bloom input or grade input), so this
   * adds no pass, target or submission. It sits after temporal reconstruction:
   * the world-locked cloud field moves slowly, but it has no motion vectors and
   * therefore must not be accumulated into experimental TAA history.
   */
  const atmosphere = cfg.atmosphere.enabled
    ? createAtmosphereNodes(
        lit,
        depthNode,
        camera,
        cfg.atmosphere,
        RENDER_CONFIG.fog.color,
        RENDER_CONFIG.sky.horizon,
      )
    : null;
  if (atmosphere !== null) lit = atmosphere.node;

  // Atmosphere is intentionally outside temporal history. Sanitize once more
  // at the final HDR boundary so it—and any future stage inserted here—cannot
  // feed an invalid value into bloom.
  lit = finiteHdrNode(lit, 'postPreBloomHdr');

  /* ---- Bloom -------------------------------------------------------------
   * Additive over the AO-multiplied scene. `UnrealBloomPass` does this blend
   * itself; `BloomNode` returns the bloom alone, so the `.add()` here IS the
   * composite and its absence would show the bloom on black. See
   * `nodes/bloom-node.ts`.
   */
  let bloom: BloomNodes | null = null;
  let bloomInput: RttNode | null = null;
  let composited: Node<'vec4'> = lit;
  if (want.bloom) {
    /*
     * UnrealBloomPass downsamples a MATERIALISED full-resolution HDR buffer.
     * Feeding BloomNode `lit` directly makes its half-resolution high pass
     * re-evaluate the expression there instead: bilinear(colour) *
     * bilinear(ao), not bilinear(colour * ao). Even with AO disabled the scene
     * expression's sampling footprint produced a measurably tighter halo.
     */
    bloomInput = rtt(lit, null, null, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    }) as unknown as RttNode;
    // The irradiance expression is fused into this existing materialisation;
    // retain its truthful pass label. Its incremental cost is evaluated by
    // whole-chain A/B until a genuinely isolated timestamp seam exists.
    bloomInput.renderTarget.texture.name = 'PostBloomInput';
    // This texture now has two consumers. RTTNode's default RENDER cadence
    // would redraw it once inside each nested post render; FRAME cadence keeps
    // the shared materialisation genuinely shared while still refreshing it
    // for every presented frame.
    if (reuseBloomInput) bloomInput.updateBeforeType = NodeUpdateType.FRAME;
    bloom = createBloomNodes(bloomInput, cfg.bloom);
    /*
     * Bloom already paid to materialise `lit` at full resolution. Reusing that
     * exact half-float texture here stops the grade-input pass from evaluating
     * the scene/AO/atmosphere expression a second time. The legacy arm remains
     * URL-selectable until the visual and timing gates have been repeated on a
     * representative device matrix.
     */
    const hdrForComposite = reuseBloomInput ? bloomInput : lit;
    composited = (hdrForComposite as unknown as { add(n: Node<'vec4'>): Node<'vec4'> }).add(bloom.node);
    built.bloom = true;
  }

  /* ---- Grade -------------------------------------------------------------
   * The one stage that needs its input MATERIALISED: the unsharp mask taps four
   * neighbours, and an expression cannot be sampled at an offset. Half-float and
   * full resolution — the same descriptor the composer's HDR pair carries, for
   * the same reason (values above 1.0 must survive).
   */
  let gradeUniforms: GradeNodeUniforms | null = null;
  let gradeInput: RttNode | null = null;
  let display: Node<'vec4'> = composited;
  if (want.grade) {
    gradeInput = rtt(composited, null, null, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    }) as unknown as RttNode;
    gradeInput.renderTarget.texture.name = 'PostGradeInput';
    gradeUniforms = createGradeUniforms();
    applyGradeConfig(gradeUniforms, cfg.grade);
    if (temporalMode === 'taau') {
      gradeUniforms.sharpen.value = taauSharpen(gradeUniforms.sharpen.value, temporalScale);
    }
    setGradeTexel(gradeUniforms, options.width, options.height);
    display = gradeNode({ input: gradeInput, uniforms: gradeUniforms });
    built.grade = true;
  }

  /* ---- SMAA --------------------------------------------------------------
   * THE ONLY PASS BUILT INSIDE A TRY/CATCH, AND IT IS NOT A HYPOTHETICAL.
   *
   * `SMAANode`'s constructor allocates `new Image()` for its area and search
   * lookup tables — a DOM API. Everything else in this graph is arithmetic over
   * textures and compiles anywhere; this one line makes SMAA the single pass
   * that cannot be constructed outside a browser, which is why
   * `tests/post-nodes.spec.ts` has to shim `Image` to exercise the full chain.
   *
   * `post.ts` wraps EVERY pass the same way and records the reason in
   * `failures`, so that a pass which cannot be built is omitted rather than
   * taking the frame with it. A graph is if anything more brittle — a throwing
   * constructor takes the whole output expression, not just its own pass — so
   * the same guard applies, and losing SMAA is a softer image rather than a
   * black one.
   */
  let smaaNode: SmaaNodeLike | null = null;
  let output: Node<'vec4'> = display;
  if (want.smaa && temporalAa === null) {
    try {
      const n = smaa(display);
      smaaNode = n as unknown as SmaaNodeLike;
      demoteSmaaMaskTargets(smaaNode);
      output = n as unknown as Node<'vec4'>;
      built.smaa = true;
    } catch (err) {
      failures.smaa = String(err);
      console.warn('[post-nodes] pass "smaa" failed to construct; continuing without it', err);
    }
  }

  const graph: PostGraph = {
    output,
    needsOutputColorTransform: !want.grade,
    built,
    scenePass,
    velocityPass,
    aoDepthPass,
    ao,
    atmosphere,
    ssgi: ssgiNodes,
    irradiance,
    indirectLighting: !want.ao
      ? 'irradiance'
      : ssgiNodes === null ? 'irradiance+gtao' : 'irradiance+ssgi',
    ssgiFailure,
    bloom,
    bloomInput,
    reusesBloomInput: bloomInput !== null && reuseBloomInput,
    gradeUniforms,
    temporalAa,
    temporalInput,
    antialiasing: temporalAa !== null && temporalMode !== null
      ? temporalMode
      : built.smaa === true ? 'smaa' : 'off',
    failures,

    syncConfig(next: PostConfig): void {
      ao?.applyConfig(next.ao);
      atmosphere?.applyConfig(
        next.atmosphere,
        RENDER_CONFIG.fog.color,
        RENDER_CONFIG.sky.horizon,
      );
      ssgiNodes?.applyAoConfig(next.ao);
      bloom?.applyConfig(next.bloom);
      if (gradeUniforms !== null) applyGradeConfig(gradeUniforms, next.grade);
      if (gradeUniforms !== null && temporalMode === 'taau') {
        gradeUniforms.sharpen.value = taauSharpen(gradeUniforms.sharpen.value, temporalScale);
      }
    },

    setSize(width: number, height: number): void {
      // Every node target sizes itself from `renderer.getDrawingBufferSize()` in
      // its own `updateBefore`, so there is nothing else to drive here. The
      // grade's texel is the exception because it describes the INPUT texture
      // rather than a target — and `RENDER_FINDINGS.md` §5's third defect was
      // exactly this value being stale (a 1920x1080 grid sampled at 1440p).
      if (gradeUniforms !== null) setGradeTexel(gradeUniforms, width, height);
    },

    dispose(): void {
      ao?.dispose();
      atmosphere?.dispose();
      ssgiNodes?.dispose();
      irradiance.dispose();
      bloom?.dispose();
      bloomInput?.renderTarget.dispose();
      smaaNode?.dispose();
      temporalAa?.dispose();
      temporalInput?.renderTarget.dispose();
      velocityPass?.overrideMaterial?.dispose();
      velocityPass?.dispose();
      gradeInput?.renderTarget.dispose();
      aoDepthPass?.dispose();
      scenePass.dispose();
    },
  };

  if (DEV) {
    const list = PASS_ORDER.filter((id) => built[id] === true);
    const failed = Object.keys(failures);
    console.info(
      `[post-nodes] graph: ${list.join(' -> ')}` +
      `  [Irradiance ${IRRADIANCE_FIELD_SIZE}x${IRRADIANCE_FIELD_SIZE}]` +
      (ssgiNodes !== null
        ? `  [SSGI ${ssgiNodes.preset.quality} @ ${Math.round(ssgiNodes.preset.resolutionScale * 100)}%]`
        : '') +
      (scenePass.renderTarget.samples > 1
        ? `  [MSAA ${scenePass.renderTarget.samples}x]`
        : '') +
      (temporalAa !== null
        ? `  [AA ${temporalMode?.toUpperCase()} + velocity @ ${Math.round(temporalScale * 100)}%]`
        : '') +
      (failed.length > 0 ? `  (failed: ${failed.join(', ')})` : ''),
    );
  }

  return graph;
}

/* ========================================================================== */
/* Binding the graph to a renderer                                            */
/* ========================================================================== */

export interface NodePostChain {
  readonly pipeline: RenderPipeline;
  readonly graph: PostGraph;
  render(dt: number): void;
  syncConfig(): void;
  setWeatherIntensity(intensity: number): void;
  /** Adopt/reupload one retained 64x64 field; false rejects malformed input. */
  setIrradianceField(field: IrradianceFieldUpdate | null): boolean;
  setIrradianceMood(gain: number, red: number, green: number, blue: number): void;
  /** Human-readable live graph order for the performance overlay. */
  postLabel(): string;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface CreateNodePostChainOptions {
  /** A `WebGPURenderer`. Typed structurally so this module needs no seam import. */
  renderer: Renderer;
  scene: Scene;
  camera: Camera;
  cfg?: PostConfig;
}

/**
 * Bind a graph to a `RenderPipeline`.
 *
 * `PostProcessing` is DEPRECATED since r183 and is a shim over `RenderPipeline`
 * that logs a warning once; the migration plan names the old class because that
 * was the published name when it was written. Using the new one avoids a console
 * warning on every boot and a rename later.
 *
 * A pass toggle REBUILDS THE GRAPH, because a node has no `enabled` flag. That
 * is the node twin of `post.ts#rebuild()` — same trigger, same consequence, and
 * `needsUpdate` on the pipeline is what recompiles the output material, which is
 * the thing `warmUp()` exists to keep off the first presented frame.
 */
export function createNodePostChain(options: CreateNodePostChainOptions): NodePostChain {
  const { renderer, scene, camera } = options;
  const cfg = options.cfg ?? RENDER_CONFIG.post;

  /*
   * The second SSGI candidate is selected by normal quality policy after
   * raising its working resolution and applying receiving-surface colour in
   * the composite. Its R11G11B10 GI attachment requires an optional WebGPU
   * feature; unsupported/lower tiers keep GTAO. Query controls remain lab A/B.
   */
  const requestedSsgi = requestedSsgiPreset(
    typeof location === 'undefined' ? '' : location.search,
  );
  const rendererFeatures = renderer as unknown as {
    hasFeature?(feature: string): boolean;
  };
  const perspective = (camera as unknown as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
  const ssgiPreset = capabilityGatedSsgiPreset(
    typeof location === 'undefined' ? '' : location.search,
    RENDER_CONFIG.quality,
    perspective,
    rendererFeatures.hasFeature?.('rg11b10ufloat-renderable') === true,
  );
  if (requestedSsgi !== null && ssgiPreset === null) {
    console.warn(
      '[post-nodes] SSGI requested but unavailable on this camera/device; using GTAO',
    );
  }
  const temporalAa = requestedTemporalAa(
    typeof location === 'undefined' ? '' : location.search,
  );
  const temporalScale = requestedTemporalScale(
    typeof location === 'undefined' ? '' : location.search,
  );
  const reuseBloomInput = requestedBloomInputReuse(
    typeof location === 'undefined' ? '' : location.search,
  );

  /*
   * `getDrawingBufferSize` TAKES A `Vector2`, NOT A DUCK. It calls `target.set(
   * w, h )` and returns it, so a plain `{ width, height }` literal throws
   * `TypeError: e.set is not a function` — which is what the first boot of the
   * real game on the node path did, inside `createPostChain`, before a single
   * frame. Nothing offline caught it: `buildPostGraph` needs no renderer and the
   * spec never reaches this function.
   *
   * ONE SCRATCH, reused by both readers below. This runs at construction and on
   * a pass toggle, never in the frame loop, but allocating a Vector2 to ask for
   * a size that is already known is pointless either way.
   */
  const r = renderer as unknown as { getDrawingBufferSize(target: Vector2): Vector2 };
  const sizeScratch = new Vector2();
  const size = r.getDrawingBufferSize(sizeScratch);

  let graph = buildPostGraph({
    scene,
    camera,
    cfg,
    width: size.width,
    height: size.height,
    ssgiPreset,
    temporalAa: temporalAa ?? false,
    temporalScale,
    reuseBloomInput,
  });

  const pipeline = new RenderPipeline(renderer, graph.output);

  let passSignature = postGraphSignature(cfg);
  let elapsed = 0;
  let rainIntensity = 0;
  let irradianceField: IrradianceFieldUpdate | null = null;
  let irradianceMoodGain = 1;
  let irradianceMoodRed = 1;
  let irradianceMoodGreen = 1;
  let irradianceMoodBlue = 1;

  const chain: NodePostChain = {
    pipeline,
    get graph() {
      return graph;
    },

    render(dt: number): void {
      elapsed += Math.max(0, Math.min(dt, 0.25));
      if (graph.gradeUniforms !== null) graph.gradeUniforms.time.value = elapsed;
      if (graph.atmosphere !== null) graph.atmosphere.uniforms.time.value = elapsed;
      pipeline.render();
    },

    syncConfig(): void {
      const signature = postGraphSignature(cfg);
      if (signature !== passSignature) {
        passSignature = signature;
        const s = r.getDrawingBufferSize(sizeScratch);
        graph.dispose();
        graph = buildPostGraph({
          scene,
          camera,
          cfg,
          width: s.width,
          height: s.height,
          ssgiPreset,
          temporalAa: temporalAa ?? false,
          temporalScale,
          reuseBloomInput,
        });
        if (graph.gradeUniforms !== null) {
          graph.gradeUniforms.time.value = elapsed;
          graph.gradeUniforms.rain.value = rainIntensity;
        }
        if (graph.atmosphere !== null) graph.atmosphere.uniforms.time.value = elapsed;
        if (irradianceField !== null) graph.irradiance.setField(irradianceField);
        graph.irradiance.setMood(
          irradianceMoodGain, irradianceMoodRed, irradianceMoodGreen, irradianceMoodBlue,
        );
        pipeline.outputNode = graph.output;
        pipeline.outputColorTransform = graph.needsOutputColorTransform;
        pipeline.needsUpdate = true;
        return;
      }
      graph.syncConfig(cfg);
    },

    setWeatherIntensity(intensity: number): void {
      rainIntensity = Math.max(-1, Math.min(1, intensity));
      if (graph.gradeUniforms !== null) graph.gradeUniforms.rain.value = rainIntensity;
    },

    setIrradianceField(field: IrradianceFieldUpdate | null): boolean {
      const adopted = graph.irradiance.setField(field);
      if (adopted) irradianceField = field;
      return adopted;
    },

    setIrradianceMood(gain: number, red: number, green: number, blue: number): void {
      irradianceMoodGain = gain;
      irradianceMoodRed = red;
      irradianceMoodGreen = green;
      irradianceMoodBlue = blue;
      graph.irradiance.setMood(gain, red, green, blue);
    },

    postLabel(): string {
      const stages = ['render'];
      const liveSamples = graph.scenePass.renderTarget.samples;
      if (liveSamples > 1) stages.push(`msaa${liveSamples}x`);
      if (graph.built.ao === true) stages.push('ao');
      stages.push('irradiance');
      if (graph.antialiasing === 'traa' || graph.antialiasing === 'taau') {
        stages.push(graph.antialiasing);
      }
      if (graph.atmosphere !== null) stages.push('atmosphere');
      if (graph.built.bloom === true) stages.push('bloom');
      if (graph.built.grade === true) stages.push('grade');
      if (graph.antialiasing === 'smaa') stages.push('smaa');
      return stages.join('+');
    },

    setSize(width: number, height: number): void {
      graph.setSize(width, height);
    },

    dispose(): void {
      graph.dispose();
      pipeline.dispose();
    },
  };

  pipeline.outputColorTransform = graph.needsOutputColorTransform;
  return chain;
}

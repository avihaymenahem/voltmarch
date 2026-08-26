/**
 * VOLTMARCH — src/render/post-nodes.ts
 * =============================================================================
 * THE POST CHAIN AS ONE TSL GRAPH. Stage B of the WebGPU migration.
 *
 * Same order as `post.ts`, and `PASS_ORDER` is imported rather than restated:
 *
 *      scene  ->  AO  ->  Bloom  ->  Grade  ->  SMAA
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

import { HalfFloatType, RGBAFormat, RenderPipeline, UnsignedByteType, Vector2 } from 'three/webgpu';
import type { Camera, DepthTexture, Node, PerspectiveCamera, Renderer, Scene, TextureNode } from 'three/webgpu';
import { depthPass, pass, rtt, vec4 } from 'three/tsl';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';

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

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/** An `RTTNode` — see the identical alias and reasoning in `nodes/ao-node.ts`. */
type RttNode = TextureNode & {
  setResolutionScale(scale: number): void;
  readonly renderTarget: { texture: { name: string }; dispose(): void };
};

/** The subset of `PassNode` this module drives. */
interface ScenePassNode {
  getTextureNode(name?: string): TextureNode;
  readonly renderTarget: {
    depthTexture: DepthTexture;
    texture: { name: string };
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
  /** Experimental indirect diffuse. Non-null only for a capable `?gi=` WebGPU boot. */
  readonly ssgi: SsgiNodes | null;
  readonly indirectLighting: 'gtao' | 'ssgi' | 'off';
  /** Why an explicitly requested SSGI path fell back to GTAO, if it did. */
  readonly ssgiFailure: string | null;
  readonly bloom: BloomNodes | null;
  /** Full-resolution HDR materialisation sampled by BloomNode's half-res high pass. */
  readonly bloomInput: RttNode | null;
  readonly gradeUniforms: GradeNodeUniforms | null;
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
  /** Push `RENDER_CONFIG.post` into every live uniform. Cheap; no rebuilds. */
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
  const scenePass = pass(scene, camera, {
    samples: cfg.msaaSamples,
  }) as unknown as ScenePassNode;
  scenePass.renderTarget.texture.name = 'PostHDR';

  const colour = scenePass.getTextureNode('output');

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
  const aoDepthPass = want.ao && cfg.msaaSamples > 0
    ? depthPass(scene, camera, { samples: 0 }) as unknown as ScenePassNode
    : null;
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
        const bounce = vec4(ssgiNodes.indirect(), 0) as unknown as Node<'vec4'>;
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
    built.ao = true;
  }

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
    bloomInput.renderTarget.texture.name = 'PostBloomInput';
    bloom = createBloomNodes(bloomInput, cfg.bloom);
    composited = (lit as unknown as { add(n: Node<'vec4'>): Node<'vec4'> }).add(bloom.node);
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
  if (want.smaa) {
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
    aoDepthPass,
    ao,
    ssgi: ssgiNodes,
    indirectLighting: !want.ao ? 'off' : ssgiNodes === null ? 'gtao' : 'ssgi',
    ssgiFailure,
    bloom,
    bloomInput,
    gradeUniforms,
    failures,

    syncConfig(next: PostConfig): void {
      ao?.applyConfig(next.ao);
      ssgiNodes?.applyAoConfig(next.ao);
      bloom?.applyConfig(next.bloom);
      if (gradeUniforms !== null) applyGradeConfig(gradeUniforms, next.grade);
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
      ssgiNodes?.dispose();
      bloom?.dispose();
      bloomInput?.renderTarget.dispose();
      smaaNode?.dispose();
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
      (ssgiNodes !== null
        ? `  [SSGI ${ssgiNodes.preset.quality} @ ${Math.round(ssgiNodes.preset.resolutionScale * 100)}%]`
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
  render(): void;
  syncConfig(): void;
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
   * SSGI is a development switch until it has survived the visual scorecard
   * and the 1440p GPU budget. Its R11G11B10 GI attachment requires an optional
   * WebGPU feature; refusing the experiment here means the graph below never
   * constructs a node the active device cannot compile. The normal GTAO graph
   * is therefore both the unsupported-device and the no-query fallback.
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
    perspective,
    rendererFeatures.hasFeature?.('rg11b10ufloat-renderable') === true,
  );
  if (requestedSsgi !== null && ssgiPreset === null) {
    console.warn(
      '[post-nodes] SSGI requested but unavailable on this camera/device; using GTAO',
    );
  }

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
  });

  const pipeline = new RenderPipeline(renderer, graph.output);

  let passSignature = JSON.stringify(enabledPasses(cfg));

  const chain: NodePostChain = {
    pipeline,
    get graph() {
      return graph;
    },

    render(): void {
      pipeline.render();
    },

    syncConfig(): void {
      const signature = JSON.stringify(enabledPasses(cfg));
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
        });
        pipeline.outputNode = graph.output;
        pipeline.outputColorTransform = graph.needsOutputColorTransform;
        pipeline.needsUpdate = true;
        return;
      }
      graph.syncConfig(cfg);
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

/**
 * COMPILE A TSL NODE GRAPH TO WGSL WITHOUT A GPU, A CANVAS OR A BROWSER.
 *
 * `docs/RENDER_FINDINGS.md` §5's lesson is "a test that reads the CONFIG proves
 * nothing about the SHADER — when it matters, read the uniform off a booted
 * page". A booted page is not available to `npm test`, which runs in Node with
 * `environment: 'node'`. This harness is the next best instrument and it is a
 * genuinely different one from a config scan: it drives three's own
 * `WGSLNodeBuilder` over the real node graph and hands back the shader text and
 * the uniform layout three would upload.
 *
 * WHAT IT PROVES: that a uniform is REFERENCED by the compiled shader, that a
 * constant survived the port, that a code path exists or does not. That is
 * exactly the class of fact §5 says config assertions cannot reach — grain and
 * CA would have failed a search of the emitted source on the day they shipped,
 * while every config assertion passed.
 *
 * WHAT IT DOES NOT PROVE: any pixel. Nothing here executes a shader. Numeric
 * equivalence between the GLSL grade and the TSL grade needs a device, and the
 * honest statement about that is in `tests/post-nodes.spec.ts`.
 *
 * THE STUB RENDERER. `NodeBuilder.prebuild()` reads exactly two things off the
 * renderer that a plain object cannot supply by accident — `contextNode`, which
 * must be a real `context()` node, and `library.fromMaterial()`, which resolves
 * a material to its node material. Everything else it touches is a scalar or a
 * getter. The stub is deliberately minimal: if a three upgrade starts reading
 * something new, this throws rather than silently compiling a different graph.
 */

import { GLSLNodeBuilder, HalfFloatType, Mesh, NodeMaterial, PerspectiveCamera, PlaneGeometry, Scene, WGSLNodeBuilder, WebGLCoordinateSystem, WebGPUCoordinateSystem, WebGPURenderer } from 'three/webgpu';
import type { BufferGeometry, Material, Node } from 'three/webgpu';
import { context } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any -- the stub is deliberately structural */

export interface CompiledNode {
  /** The generated WGSL fragment stage. */
  fragment: string;
  /** The generated WGSL vertex stage. Rarely interesting for a post pass. */
  vertex: string;
  /** Every uniform three collected for the fragment stage, by generated name. */
  uniformNames: string[];
  /** The builder, for tests that want to poke at three's own bookkeeping. */
  builder: any;
}

function stubRenderer(webgl: boolean): any {
  const coordinateSystem = webgl ? WebGLCoordinateSystem : WebGPUCoordinateSystem;
  return {
    contextNode: context(),
    backend: {
      getDomElement: () => null,
      coordinateSystem,
      // `generateTextureDimension` asks the backend how many samples a texture
      // carries so it can pick `textureDimensions` overloads. 1 = not
      // multisampled, which is true of every target in this chain: `post.ts`'s
      // header spends a page on why nothing downstream of the scene may be.
      utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
    },
    coordinateSystem,
    getRenderTarget: () => null,
    getMRT: () => null,
    getOutputRenderTarget: () => null,
    toneMapping: 0,
    currentToneMapping: 0,
    outputColorSpace: 'srgb',
    logarithmicDepthBuffer: false,
    reversedDepthBuffer: false,
    library: { fromMaterial: (m: unknown) => m },
    // `WGSLNodeBuilder.isUnfilterable` asks this before it will emit a sampled
    // texture binding. Answering `true` is the permissive branch — the one a
    // real device with `float32-filterable` takes — so the graph compiles with
    // ordinary `textureSample` calls rather than the `textureLoad` workaround.
    hasFeature: () => true,
    // `PassNode.setup` sizes its own colour target from this. Half-float is what
    // the shipping chain uses and what `post.ts` gives the composer, for the
    // reason its header opens with: values above 1.0 must survive to the bloom
    // threshold.
    getOutputBufferType: () => HalfFloatType,
    samples: 0,
    getDrawingBufferSize: (t: { set(w: number, h: number): unknown }) => t.set(1280, 720),
  };
}

/**
 * Compile `node` as the fragment output of a node material and return the WGSL.
 *
 * The node is used as `fragmentNode`, i.e. it becomes the whole colour output —
 * the same position a post pass's expression occupies in a real
 * `RenderPipeline`, whose output quad is also a `NodeMaterial` with a
 * `fragmentNode`.
 */
/**
 * The two backends `WebGPURenderer` can run, and both must be checked.
 *
 * the WebGPU migration §4.5: a WebGPU build still serves the WebGL2
 * fallback to browsers without a device, and that is a THIRD renderer — node
 * materials over WebGL2, with its own generator. Two backends means two grade
 * baselines. `GLSLNodeBuilder` is exported alongside `WGSLNodeBuilder` and runs
 * headlessly on the same stub, so "does it still compile on both" costs nothing
 * and is a unit test rather than a browser capture.
 */
export type NodeBackend = 'wgsl' | 'glsl';

export function compileFragmentNode(node: Node, backend: NodeBackend = 'wgsl'): CompiledNode {
  const material = new NodeMaterial();
  (material as any).fragmentNode = node;

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  const scene = new Scene();
  scene.add(mesh);
  const camera = new PerspectiveCamera();

  const Builder = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
  const builder: any = new Builder(mesh, stubRenderer(backend === 'glsl'));
  builder.material = material;
  builder.scene = scene;
  builder.camera = camera;
  builder.geometry = mesh.geometry;
  builder.build();

  const uniformNames: string[] = [];
  const groups = builder.uniforms ?? {};
  for (const stage of Object.keys(groups)) {
    const list = groups[stage];
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      if (u && typeof u.name === 'string') uniformNames.push(`${stage}:${u.name}`);
    }
  }

  return {
    fragment: String(builder.fragmentShader ?? ''),
    vertex: String(builder.vertexShader ?? ''),
    uniformNames,
    builder,
  };
}

/* ==========================================================================
 * A WHOLE MATERIAL, NOT JUST A FRAGMENT EXPRESSION
 *
 * `compileFragmentNode` above answers "does this post-pass expression build",
 * which is the shape Stage B needed. A ported MATERIAL is a different question:
 * it has a vertex stage, geometry attributes, varyings and material flags, and
 * every one of those is a place a port can break while the fragment expression
 * alone still compiles.
 *
 * `tests/terrain-node-material.spec.ts` grew its own copy of this for Stage C.
 * That one is left exactly where it is — it seeds the terrain's `aUp`/`aTop` —
 * and this is the general version Stage E and anything after it calls. Both
 * drive three's real builders, so a green run means the same thing in both.
 * ========================================================================== */

export interface CompiledMaterial {
  vertex: string;
  fragment: string;
}

/**
 * A `WebGPURenderer` constructed and never initialised.
 *
 * The node builders reach the renderer for `contextNode` and
 * `library.fromMaterial`, both of which exist the moment the object does.
 * `hasFeature` is stubbed because `Renderer.hasFeature` throws by contract
 * before the backend is up; `false` is the honest answer for every 8-bit
 * texture in this project.
 */
export function offlineRenderer(): WebGPURenderer {
  const canvas = {
    width: 4, height: 4, style: {},
    addEventListener() { /* nothing is ever fired offline */ },
    removeEventListener() { /* ditto */ },
    getContext() { return null; },
  } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  (renderer as unknown as { hasFeature: () => boolean }).hasFeature = () => false;
  return renderer;
}

/**
 * Compile a node material's full graph offline, on either backend.
 *
 * @param geometry Optional — pass one carrying every attribute the material
 *                 declares. `attribute()` WARNS AND SUBSTITUTES when the
 *                 geometry lacks a name, which silently compiles a DIFFERENT
 *                 shader from the one the game runs.
 */
export function compileNodeMaterial(
  material: Material, backend: NodeBackend = 'wgsl', geometry?: BufferGeometry,
): CompiledMaterial {
  const geo = geometry ?? new PlaneGeometry(1, 1, 1, 1);
  const mesh = new Mesh(geo, material);
  const scene = new Scene();
  scene.add(mesh);

  const Builder = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
  const builder: any = new Builder(mesh, offlineRenderer());
  builder.material = material;
  builder.scene = scene;
  builder.camera = new PerspectiveCamera();
  builder.geometry = geo;
  builder.build();

  return {
    vertex: String(builder.vertexShader ?? ''),
    fragment: String(builder.fragmentShader ?? ''),
  };
}

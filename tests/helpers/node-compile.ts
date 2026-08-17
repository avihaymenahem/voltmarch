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

import { HalfFloatType, Mesh, NodeMaterial, PerspectiveCamera, PlaneGeometry, Scene, WGSLNodeBuilder, WebGPUCoordinateSystem } from 'three/webgpu';
import type { Node } from 'three/webgpu';
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

function stubRenderer(): any {
  return {
    contextNode: context(),
    backend: {
      getDomElement: () => null,
      coordinateSystem: WebGPUCoordinateSystem,
      // `generateTextureDimension` asks the backend how many samples a texture
      // carries so it can pick `textureDimensions` overloads. 1 = not
      // multisampled, which is true of every target in this chain: `post.ts`'s
      // header spends a page on why nothing downstream of the scene may be.
      utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
    },
    coordinateSystem: WebGPUCoordinateSystem,
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
export function compileFragmentNode(node: Node): CompiledNode {
  const material = new NodeMaterial();
  (material as any).fragmentNode = node;

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  const scene = new Scene();
  scene.add(mesh);
  const camera = new PerspectiveCamera();

  const builder: any = new WGSLNodeBuilder(mesh, stubRenderer());
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

/**
 * ============================================================================
 * VOLTMARCH — src/render/gpu-path-install.ts
 * ============================================================================
 * THE NODE PATH, ASSEMBLED. Stage F of the WebGPU migration.
 *
 * **NOTHING MAY EVER IMPORT THIS STATICALLY.** It is reached from exactly one
 * place — the `await import('./gpu-path-install')` inside
 * `gpu-path.ts#prepareGpuPath`, which is behind `requestedBackend(search) ===
 * 'webgpu'`. That single dynamic import is what makes Rollup emit the whole node
 * system as a separate chunk instead of folding it into the entry, and it is why
 * a WebGL player still downloads zero bytes of `three/webgpu`.
 *
 * `tests/webgpu-bundle-isolation.spec.ts` greps the built entry chunk for node
 * symbols and fails if any appear. That test is the mechanism; this comment is
 * not. Stage B measured the baseline at literally 0 occurrences and the point of
 * the cutover was to keep it there.
 *
 * ── WHAT IS AND IS NOT IN HERE ──────────────────────────────────────────────
 * This file is glue and nothing else. Every material it hands back was written
 * by Stages B..E (or, for the three the stage inventory missed, by `sky-nodes.ts`
 * and `ground-overlay-nodes.ts`); the only logic that lives here is
 * `createRenderer` — which is the WebGPU device request — and the post-chain
 * adapter that makes a node `RenderPipeline` answer `PostChain`'s questions.
 * ============================================================================
 */

import * as THREE from 'three';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';

import {
  installNodePath,
  type NodePath,
  type NodePostChainLike,
  type NodeRendererLike,
} from './gpu-path';
import { createNodePostChain } from './post-nodes';
import { classifyNodeRenderPass } from './node-pass-accounting';
import { shouldSkipShadowOnlyObject } from './shadow-only';
import { createSkyNodeMaterial } from './sky-nodes';
import {
  createContactShadowNodeMaterial, createDecalNodeMaterial,
} from './ground-overlay-nodes';
import {
  createShroudNodeMaterial, createShroudTintedStandardNodeMaterial,
} from './shroud-nodes';
import { createTerrainNodeMaterials } from '../world/TerrainNodeMaterial';
import { createWaterNodeMaterial } from '../world/WaterNodeMaterial';
import { createRoadNodeMaterials } from '../world/RoadNodeMaterial';
import {
  createEnvironmentPropNodeMaterials, createPropNodeMaterials,
} from '../world/PropNodeMaterial';
import { createUnitNodeMaterial } from '../art/UnitNodeMaterial';
import { createPadNodeMaterial, createStructureNodeMaterial } from '../art/StructureNodeMaterial';
import {
  createVfxAdditiveNodeMaterial, createVfxDebrisNodeMaterial, createVfxLitNodeMaterial,
  createVfxRibbonNodeMaterial,
} from '../vfx/vfx-node-materials';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/* ==========================================================================
 * 1. THE DEVICE
 * ========================================================================== */

/**
 * The private field on `Renderer` that holds three's own fallback factory.
 *
 * Named once, here, so the reach into three's internals below is a single
 * grep-able constant rather than a string literal buried in a cast — and so a
 * three upgrade that renames it fails at the guard rather than silently
 * reinstating the crash. See `disableThreeFallback`.
 */
const THREE_FALLBACK_FIELD = '_getFallback';

/**
 * **REMOVE THREE'S WEBGL FALLBACK. IT CANNOT WORK ON A SHARED CANVAS AND IT IS
 * WHAT KILLED A PLAYER'S PAGE.**
 *
 * `WebGPURenderer`'s constructor installs `parameters.getFallback = () => new
 * WebGLBackend( parameters )` for every construction that is not `forceWebGL` —
 * unconditionally, with no option to decline. `Renderer.init()` then calls it on
 * ANY throw out of `WebGPUBackend.init`, and `WebGLBackend.init` runs
 * `renderer.domElement.getContext( 'webgl2', … )` on the SAME canvas. A canvas
 * holds one context type for its whole life, so on `index.html`'s single `#gl`
 * that call returns `null` and the very next line, `new WebGLExtensions( this )`,
 * dereferences it:
 *
 *     TypeError: Cannot read properties of null (reading 'getSupportedExtensions')
 *
 * That is the crash as reported, and it replaced the REAL cause — a driver reset
 * making `requestDevice()` fail — with a message about a WebGL extension list.
 *
 * So the fallback is not merely unwanted, it is a lie generator: on this canvas
 * its only two outcomes are that TypeError, or (on a canvas where WebGL2 does
 * open) a `webgl2-fallback` renderer that `assertBackend` refuses anyway. Nulling
 * it makes `init()` reject with the ORIGINAL error, which is the one worth
 * showing. `renderer.ts#prepareRenderer` catches that rejection and
 * `device-loss.ts` turns it into words.
 *
 * **THE GUARD IS LOAD-BEARING.** This writes a private field, so a three upgrade
 * that renames or removes it would leave the broken fallback armed again with
 * nothing failing. Checking the field is present before writing it turns that
 * into a build-time-visible warning instead of a silent regression; the write is
 * skipped rather than forced, because inventing a private on three's renderer is
 * strictly worse than leaving it alone.
 */
function disableThreeFallback(renderer: object): boolean {
  if (!(THREE_FALLBACK_FIELD in renderer)) {
    console.warn(
      `[render] three's WebGPURenderer no longer carries '${THREE_FALLBACK_FIELD}'. Its WebGL ` +
        'fallback could not be disabled, and on a shared canvas that fallback crashes inside ' +
        'WebGLExtensions rather than reporting the real device failure. ' +
        'See src/render/device-loss.ts.',
    );
    return false;
  }
  (renderer as unknown as Record<string, unknown>)[THREE_FALLBACK_FIELD] = null;
  return true;
}

/**
 * Construct and INITIALISE a `WebGPURenderer`.
 *
 * `await renderer.init()` is not optional and not deferrable: `Renderer.render()`
 * throws `.render() called before the backend is initialized` outright. It used
 * to be where the fallback fired — `init()` caught the `requestDevice()` failure
 * and swapped in a `WebGLBackend` behind a single `console.warn`, then RESOLVED.
 * `disableThreeFallback` above removes that path, so `init()` now REJECTS with
 * the real cause and this function's caller decides what to do about it.
 *
 * A successful await still proves nothing about which backend is live if the
 * guard could not fire; that question is settled by
 * `assertBackend(liveBackendOf(renderer))` back in `renderer.ts`, on
 * `backend.isWebGPUBackend`. See `RENDER_FINDINGS.md` §7c.
 *
 * `alpha: false` and `powerPreference` carry over from the WebGL construction
 * for the reasons written there — the opaque-canvas argument is about the
 * compositor and is renderer-independent. **`powerPreference` IS A HINT**: Stage
 * A asked for `'high-performance'` and observed an integrated `amd`/`gcn-5`
 * adapter on a box holding an RTX 3080, which is why the adapter is now read
 * back off the device and published rather than assumed.
 */
async function createNodeRenderer(
  canvas: HTMLCanvasElement, antialias: boolean,
): Promise<NodeRendererLike> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias,
    alpha: false,
    powerPreference: 'high-performance',
    /*
     * FORCE THE WEBGPU BACKEND RATHER THAN LETTING THREE PICK.
     * `forceWebGL: false` is the default, but stating it means a future default
     * flip cannot silently put this project on the node-over-WebGL2 path, which
     * Stage A measured as the SLOWEST of the three arms (1.3-4.1x the shipping
     * renderer) and which `assertBackend` refuses anyway.
     */
    forceWebGL: false,
    // Requests the optional device feature at boot. The perf panel disables
    // writes while hidden and enables them only during an active sample.
    trackTimestamp: true,
  });
  disableThreeFallback(renderer);
  await renderer.init();
  return renderer as unknown as NodeRendererLike;
}

/* ==========================================================================
 * 2. THE POST CHAIN ADAPTER
 * ========================================================================== */

/**
 * Bind the node graph and answer `PostChain`'s questions.
 *
 * Every common-Renderer submission delegates through its public `renderObject`
 * method. We snapshot Info immediately around that delegate, so instancing,
 * draw ranges and double-sided submissions are counted by three itself rather
 * than reimplemented here. This seam is intentionally below
 * `setRenderObjectFunction`: ShadowNode temporarily replaces that callback, so
 * instrumenting it would silently miss every shadow draw and label the residual
 * as post work.
 */
function createNodePostAdapter(
  renderer: NodeRendererLike, scene: THREE.Scene, camera: THREE.Camera,
): NodePostChainLike {
  type ChainScene = Parameters<typeof createNodePostChain>[0]['scene'];
  type ChainCamera = Parameters<typeof createNodePostChain>[0]['camera'];
  type ChainRenderer = Parameters<typeof createNodePostChain>[0]['renderer'];

  let liveScene = scene;
  let liveCamera = camera;
  let rainIntensity = 0;
  const draws = { shadow: 0, colour: 0, ao: 0, post: 0, total: 0 };
  const triangles = { shadow: 0, colour: 0, ao: 0, post: 0, total: 0 };
  const previousRenderObject = renderer.renderObject;
  const accountingStack: Array<{ draws: number; triangles: number }> = [];

  renderer.renderObject = function accountingRenderObject(
    object, renderScene, renderCamera, geometry, material, group,
    lightsNode, clippingContext, passId,
  ) {
    const bucket = classifyNodeRenderPass(
      object, renderScene, liveScene, clippingContext ?? null,
      renderer.getRenderTarget(),
    );
    // A shadow proxy is deliberately scene-visible so Three discovers it for
    // shadow maps. Its normal-pass material writes neither colour nor depth,
    // but the renderer still used to build/submit that useless draw.
    if (shouldSkipShadowOnlyObject(object, bucket === 'shadow')) return;

    const nested = { draws: 0, triangles: 0 };
    accountingStack.push(nested);
    const before = renderer.info.render.drawCalls;
    const trianglesBefore = renderer.info.render.triangles;
    try {
      previousRenderObject.call(
        renderer,
        object, renderScene, renderCamera, geometry, material, group,
        lightsNode, clippingContext, passId,
      );
    } finally {
      const inclusiveDraws = Math.max(0, renderer.info.render.drawCalls - before);
      const inclusiveTriangles = Math.max(0, renderer.info.render.triangles - trianglesBefore);
      accountingStack.pop();
      const parent = accountingStack[accountingStack.length - 1];
      if (parent !== undefined) {
        parent.draws += inclusiveDraws;
        parent.triangles += inclusiveTriangles;
      }
      // Node updateBefore hooks can recursively render whole targets while the
      // outer object's pipeline is being prepared. Charge those inner draws to
      // their own targets, then only the exclusive remainder to this object.
      const delta = Math.max(0, inclusiveDraws - nested.draws);
      const triangleDelta = Math.max(0, inclusiveTriangles - nested.triangles);
      draws[bucket] += delta;
      triangles[bucket] += triangleDelta;
    }
  };
  let chain = createNodePostChain({
    renderer: renderer as unknown as ChainRenderer,
    scene: liveScene as unknown as ChainScene,
    camera: liveCamera as unknown as ChainCamera,
  });

  function rebuild(): void {
    chain.dispose();
    chain = createNodePostChain({
      renderer: renderer as unknown as ChainRenderer,
      scene: liveScene as unknown as ChainScene,
      camera: liveCamera as unknown as ChainCamera,
    });
    chain.setWeatherIntensity(rainIntensity);
  }

  return {
    render(dt: number): void {
      draws.shadow = 0;
      draws.colour = 0;
      draws.ao = 0;
      draws.post = 0;
      draws.total = 0;
      triangles.shadow = 0;
      triangles.colour = 0;
      triangles.ao = 0;
      triangles.post = 0;
      triangles.total = 0;
      chain.render(dt);
      draws.total = renderer.info.render.drawCalls;
      triangles.total = renderer.info.render.triangles;
      // Any upstream pass shape we did not recognise remains visible as post
      // work instead of making the exhaustive sum lie.
      const measured = draws.shadow + draws.colour + draws.ao + draws.post;
      if (measured < draws.total) draws.post += draws.total - measured;
      const measuredTriangles = triangles.shadow + triangles.colour + triangles.ao + triangles.post;
      if (measuredTriangles < triangles.total) triangles.post += triangles.total - measuredTriangles;
    },
    syncConfig(): void { chain.syncConfig(); },
    setWeatherIntensity(intensity: number): void {
      rainIntensity = Math.max(-1, Math.min(1, intensity));
      chain.setWeatherIntensity(rainIntensity);
    },
    postLabel(): string { return chain.postLabel(); },
    setSize(w: number, h: number): void { chain.setSize(w, h); },
    drawCallsByPass() { return draws; },
    trianglesByPass() { return triangles; },
    setScene(next: THREE.Scene): void {
      if (next === liveScene) return;
      liveScene = next;
      rebuild();
    },
    setCamera(next: THREE.Camera): void {
      if (next === liveCamera) return;
      liveCamera = next;
      rebuild();
    },
    dispose(): void {
      renderer.renderObject = previousRenderObject;
      chain.dispose();
    },
  };
}

/* ==========================================================================
 * 3. THE BUNDLE
 * ========================================================================== */

export function install(): void {
  const path: NodePath = {
    createRenderer: createNodeRenderer,

    createPmrem(renderer) {
      // three exports a SECOND `PMREMGenerator` from `three/webgpu`
      // (`renderers/common/extras/`) that drives a node `Renderer`. The core
      // one takes a `WebGLRenderer` and would throw on the first `render()`.
      const gen = new PMREMGenerator(renderer as never);
      return {
        fromScene(sceneToBake, sigma, near, far) {
          return gen.fromScene(sceneToBake as never, sigma, near, far) as unknown as THREE.RenderTarget;
        },
        dispose(): void { gen.dispose(); },
      };
    },

    createPostChain: createNodePostAdapter,

    createSkyMaterial() {
      const set = createSkyNodeMaterial();
      return { material: set.material, uniforms: set.uniforms };
    },

    createTerrainMaterials: (options) => createTerrainNodeMaterials(options),
    createWaterMaterial: (options) => createWaterNodeMaterial(options),
    createRoadMaterials: (anisotropy) => createRoadNodeMaterials(anisotropy),
    createShroudMaterial: (look) => createShroudNodeMaterial(look),
    createContactShadowMaterial: () => createContactShadowNodeMaterial(),
    createDecalMaterial: (atlas, cols, inset) => createDecalNodeMaterial(atlas, cols, inset),

    createUnitMaterial: (atlas, name) => createUnitNodeMaterial(atlas, name),
    createStructureMaterial: (atlas, name, coat) => createStructureNodeMaterial(atlas, name, coat),
    createPadMaterial: (atlas, name) => createPadNodeMaterial(atlas, name),

    createPropMaterials() {
      const set = createPropNodeMaterials();
      return {
        material: set.material,
        // See `PropMaterialSetLike.depthMaterial`: the node path's wind reaches
        // the shadow pass through `castShadowPositionNode`, which
        // `createPropNodeMaterials` already set.
        depthMaterial: null,
        setTime: (t) => set.setTime(t),
        dispose: () => set.dispose(),
      };
    },

    createEnvironmentPropMaterials(params) {
      const set = createEnvironmentPropNodeMaterials(params);
      return {
        material: set.material,
        depthMaterial: null,
        setTime: (t) => set.setTime(t),
        dispose: () => set.dispose(),
      };
    },

    createShroudTintedStandard: (params) => createShroudTintedStandardNodeMaterial(params),

    createRibbonMaterial(ramp, rampRows, name, depthTest) {
      const set = createVfxRibbonNodeMaterial(ramp, rampRows, name, depthTest);
      return {
        material: set.material,
        get pxScale() { return set.pxScale; },
        setFov: (fovDeg) => set.setFov(fovDeg),
        dispose: () => set.dispose(),
      };
    },

    createAdditiveSpriteMaterial: (atlas, ramps) =>
      createVfxAdditiveNodeMaterial(atlas, ramps).material,

    createLitSpriteMaterial(atlas, ramps) {
      const set = createVfxLitNodeMaterial(atlas, ramps);
      return { material: set.material, uniforms: set.uniforms };
    },

    createDebrisMaterial: () => createVfxDebrisNodeMaterial(),
  };

  installNodePath(path);
  if (DEV) console.info('[render] node path installed — materials will be built as TSL graphs');
}

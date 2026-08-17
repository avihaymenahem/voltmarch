/**
 * ============================================================================
 * VOLTMARCH — src/render/gpu-path-install.ts
 * ============================================================================
 * THE NODE PATH, ASSEMBLED. Stage F of `docs/WEBGPU_MIGRATION_PLAN.md`.
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
import { createPropNodeMaterials } from '../world/PropNodeMaterial';
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
 * Construct and INITIALISE a `WebGPURenderer`.
 *
 * `await renderer.init()` is not optional and not deferrable: `Renderer.render()`
 * throws `.render() called before the backend is initialized` outright. It is
 * also where the fallback fires — `init()` catches the `requestDevice()` failure
 * and swaps in a `WebGLBackend` behind a single `console.warn`, and RESOLVES.
 * So a successful await here proves nothing about which backend is live; that
 * question is settled by `assertBackend(liveBackendOf(renderer))` back in
 * `renderer.ts`, on `backend.isWebGPUBackend`. See `RENDER_FINDINGS.md` §7c.
 *
 * `alpha: false` and `powerPreference` carry over from the WebGL construction
 * for the reasons written there — the opaque-canvas argument is about the
 * compositor and is renderer-independent.
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
  });
  await renderer.init();
  return renderer as unknown as NodeRendererLike;
}

/* ==========================================================================
 * 2. THE POST CHAIN ADAPTER
 * ========================================================================== */

/**
 * Bind the node graph and answer `PostChain`'s questions.
 *
 * **`drawCallsByPass()` RETURNS NULL, AND THAT IS THE HONEST ANSWER RATHER THAN
 * A GAP NOBODY NOTICED.** The WebGL split is produced by wrapping
 * `WebGLRenderer.shadowMap.render` and reading `info.render.calls` on either
 * side of it — a seam that exists because the shadow pass is a distinct method
 * call on that renderer. The node `Renderer` has no such seam: shadows are drawn
 * inside `_renderScene`, `Info` publishes `render.drawCalls` as a per-frame TOTAL
 * and nothing else, and there is no per-pass counter to read. Faking a split by
 * counting `render()` invocations would produce a number that looks like the
 * WebGL one and means something different, which is precisely the class of
 * defect `normaliseInfo()` exists to stop.
 *
 * So on the node path `stats().drawCallsByPass` reports zeros with the true
 * TOTAL, `MAX_DRAW_CALLS` cannot be checked, and `tools/shot-compare.mjs draws`
 * compares totals only. **The per-pass instrument is WebGL-only.**
 */
function createNodePostAdapter(
  renderer: NodeRendererLike, scene: THREE.Scene, camera: THREE.Camera,
): NodePostChainLike {
  type ChainScene = Parameters<typeof createNodePostChain>[0]['scene'];
  type ChainCamera = Parameters<typeof createNodePostChain>[0]['camera'];
  type ChainRenderer = Parameters<typeof createNodePostChain>[0]['renderer'];

  let liveScene = scene;
  let liveCamera = camera;
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
  }

  return {
    render(): void { chain.render(); },
    syncConfig(): void { chain.syncConfig(); },
    setSize(w: number, h: number): void { chain.setSize(w, h); },
    drawCallsByPass(): null { return null; },
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
    dispose(): void { chain.dispose(); },
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

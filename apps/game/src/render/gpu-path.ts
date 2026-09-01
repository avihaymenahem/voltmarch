/**
 * ============================================================================
 * VOLTMARCH — src/render/gpu-path.ts
 * ============================================================================
 * THE ONE PLACE THE TWO RENDERERS MEET, AND THE REASON IT CONTAINS NO THREE.
 *
 * Stage F of the WebGPU migration. Stages B..E ported every shader in
 * the project to a TSL node graph; each of those modules imports `three/webgpu`
 * at its top level, and `three/webgpu` is the WHOLE node system — the builders,
 * both backends, the node material library. Measured at Stage B: it is **absent
 * from `dist/` entirely** (`grep -c WGSLNodeBuilder dist/assets/index-*.js` = 0)
 * precisely because nothing in `src/main.ts`'s import graph reaches it.
 *
 * **THAT MUST SURVIVE THE CUTOVER.** A WebGL player must not download a renderer
 * they will never run. So this file — which every material site DOES import — is
 * structural: it declares what a node path must supply, holds a nullable slot for
 * it, and imports nothing from three at all beyond types that erase. The slot is
 * filled by `./gpu-path-install.ts`, which is reached ONLY through a dynamic
 * `import()` inside `prepareGpuPath()`, behind `requestedBackend()`.
 *
 * The shape at every call site is therefore:
 *
 *     const np = nodePath();
 *     const mat = np !== null ? np.createXNodeMaterial(...) : createXMaterial(...);
 *
 * — one branch, evaluated once at construction, never in the frame loop.
 *
 * ── WHY A REGISTRY AND NOT A PARAMETER ──────────────────────────────────────
 * Because the material sites are twenty-odd files deep in three different
 * subsystems (`src/art/`, `src/world/`, `src/vfx/`, `src/render/`) and most of
 * them are reached from a `*.system.ts` that receives no renderer. Threading a
 * factory bundle through every one of those would be a larger and more invasive
 * diff than the port itself, and it would put a live object in the signature of
 * functions that are pure today.
 *
 * The cost of a registry is that it is GLOBAL STATE, so it is written exactly
 * once per page (`installNodePath` throws on a second call with a different
 * bundle) and read through one accessor.
 *
 * ── THE "LIKE" INTERFACES ───────────────────────────────────────────────────
 * A GLSL material set and its node twin were deliberately given the same method
 * names by Stages C..E, but not the same TYPES: `TerrainMaterialSet.material` is
 * a `MeshStandardMaterial` and `TerrainNodeMaterialSet.material` is a
 * `MeshStandardNodeMaterial`, and their `uniforms` blocks are `{ value }` objects
 * on one side and TSL uniform nodes on the other. What every CONSUMER actually
 * uses is the methods plus `material` as a bare `THREE.Material` to hand to a
 * `Mesh`. The `*Like` interfaces below are that intersection, and both concrete
 * sets are assignable to them without a cast.
 * ============================================================================
 */

import type * as THREE from 'three';

import type { GpuBackend } from './backend';
import { requestedBackend } from './backend';
import type { DeviceLike } from './device-loss';
import type { ShroudLook } from '../core/types';
import type { BiomeDef } from '../world/Biomes';
import type { CreateTerrainMaterialOptions } from '../world/TerrainMaterial';
import type { WaterLightRig, WaterMaterialOptions } from '../world/WaterMaterial';
import type { RoadSurfaceKind } from '../world/road-markings';
import type { GreebleAtlas } from '../art/Greeble';
import type { StructureCoat } from '../art/BuildingFactory';
import type { IrradianceFieldUpdate } from '../core/irradiance-field';
import type { SurfaceEnvironmentState } from '../world/surface-environment';

/**
 * The four texture slots shared by generated atlases and imported animated units.
 * Keeping this structural avoids inventing a second gait material implementation
 * just because an approved GLB does not carry GreebleAtlas build metadata.
 */
export interface UnitMaterialTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  ormMap: THREE.Texture;
  emissiveMap: THREE.Texture;
}

/* ==========================================================================
 * 1. THE STRUCTURAL MATERIAL-SET INTERFACES
 * ========================================================================== */

/** What `Terrain.ts` uses of a terrain material set. */
export interface TerrainMaterialSetLike {
  readonly material: THREE.Material;
  readonly texturesAdopted: boolean;
  setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void;
  applyBiome(biome: BiomeDef): void;
  setAnisotropy(a: number): void;
  setSurfaceEnvironment(state: SurfaceEnvironmentState): void;
  dispose(): void;
}

/** What `Water.ts` uses of a water material set. */
export interface WaterMaterialSetLike {
  readonly material: THREE.Material;
  readonly texturesAdopted: boolean;
  setField(tex: THREE.Texture | null): void;
  setWake(tex: THREE.Texture | null): void;
  setWaterLevel(y: number): void;
  setTime(t: number): void;
  setSeaState(v: number): void;
  setAnisotropy(a: number): void;
  applyPalette(palette: WaterMaterialOptions['palette'], rampDepth: number): void;
  applyLighting(rig: WaterLightRig): void;
  dispose(): void;
}

/** What `RoadNetwork.buildMeshes` uses of a road material set. */
export interface RoadMaterialSetLike {
  readonly materials: Readonly<Record<RoadSurfaceKind, THREE.Material>>;
  setSurfaceEnvironment(state: SurfaceEnvironmentState): void;
  dispose(): void;
}

/** What `FogOfWar` uses of the shroud carpet's material set. */
export interface ShroudMaterialSetLike {
  readonly material: THREE.Material;
  setFogTexture(tex: THREE.Texture): void;
  setTime(t: number): void;
  applyLook(look: ShroudLook): void;
  dispose(): void;
}

/** What `PropLibrary` and `Scatter` use. `depthMaterial` is null on the node path. */
export interface PropMaterialSetLike {
  readonly material: THREE.Material;
  /**
   * The `customDepthMaterial`, or NULL on the node path.
   *
   * `object.customDepthMaterial` is read in exactly one file in three 0.185 —
   * `WebGLShadowMap.js`. The node renderer instead harvests
   * `castShadowPositionNode` off the object's own material, which is what
   * `render/cast-shadow-nodes.ts` supplies and what `PropNodeMaterial` sets.
   * `MeshDepthMaterial` is not in `StandardNodeLibrary` at all, so this is null
   * rather than merely unused. See `docs/RENDER_FINDINGS.md` §7e.
   */
  readonly depthMaterial: THREE.Material | null;
  setTime(t: number): void;
  dispose(): void;
}

/** One indexed delivery consumed by the WebGPU foliage compaction pilot. */
export interface FoliageComputeDeliverySpec {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly triangles: number;
}

/**
 * One CPU-authoritative foliage identity copied into immutable GPU source
 * storage. `chunkRanges` stores `(start,end)` pairs into these source columns;
 * only `live` may change after construction.
 */
export interface FoliageComputeBatchSpec {
  readonly key: string;
  readonly matrices: Float32Array;
  /** RGBA storage layout; A is deliberately unused so WGSL never pads RGB behind our back. */
  readonly colours: Float32Array;
  readonly phases: Float32Array;
  readonly stableIds: Uint32Array;
  readonly live: Uint32Array;
  readonly chunkRanges: Uint32Array;
  readonly colour: readonly FoliageComputeDeliverySpec[];
  readonly shadow: FoliageComputeDeliverySpec | null;
}

/** Complete world-level input to the two-dispatch WebGPU foliage pilot. */
export interface FoliageComputeSpec {
  readonly batches: readonly FoliageComputeBatchSpec[];
  /** Four floats per chunk: minimum XYZ plus padding. */
  readonly chunkMins: Float32Array;
  /** Four floats per chunk: maximum XYZ plus padding. */
  readonly chunkMaxs: Float32Array;
  readonly chunkCount: number;
  readonly lod1Metres: number;
  readonly lod2Metres: number;
  readonly transitionBandMetres: number;
  readonly windPhaseAttribute: string;
}

export interface FoliageComputeAuditCommand {
  readonly key: string;
  readonly pass: 'lod0' | 'lod1' | 'lod2' | 'shadow';
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly firstIndex: number;
  readonly baseVertex: number;
  readonly firstInstance: number;
  readonly capacity: number;
  readonly triangles: number;
  readonly stableIds: readonly number[];
}

export interface FoliageComputeAudit {
  readonly commands: readonly FoliageComputeAuditCommand[];
  readonly visibleInstances: number;
  readonly visibleLod0: number;
  readonly visibleLod1: number;
  readonly visibleLod2: number;
  readonly visibleTriangles: number;
  readonly visibleShadowTriangles: number;
}

/** GPU-owned render presentation; simulation never receives this object. */
export interface FoliageComputeControllerLike {
  readonly objects: readonly THREE.Object3D[];
  readonly colourDraws: number;
  readonly shadowDraws: number;
  /** Complete initialization payload, including mutable live/indirect seed words. */
  readonly initialUploadBytes: number;
  readonly storageBytes: number;
  readonly dispatchesPerUpdate: number;
  readonly sourceInstances: number;
  readonly lastSubmitMs: number;
  readonly lastCpuUploadBytes: number;
  readonly dispatches: number;
  /** CPU still owns the 256 broad-phase AABB flags in the bounded pilot. */
  update(camera: THREE.Camera, dirty: boolean, visibleChunks?: Uint8Array): void;
  setLive(key: string, sourceIndex: number, live: boolean): void;
  audit(): Promise<FoliageComputeAudit>;
  dispose(): void;
}

/** The two things `RibbonBatch` and `BeamSystem.pxToMetres` reach through. */
export interface RibbonMaterialSetLike {
  readonly material: THREE.Material;
  /** `2 * tan(fovY/2) / 1440` — metres per reference pixel per unit depth. */
  readonly pxScale: number;
  setFov(fovDeg: number): void;
  dispose(): void;
}

/** The fourteen lit-smoke uniforms, of which `Particles` writes eight. */
export interface LitSmokeUniformSink {
  uSunDirView: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uUpView: { value: THREE.Vector3 };
  uHemiSky: { value: THREE.Vector3 };
  uHemiGround: { value: THREE.Vector3 };
  uFxPosView: { value: THREE.Vector3 };
  uFxColor: { value: THREE.Vector3 };
  uFxRange: { value: number };
}

/* ==========================================================================
 * 2. THE BUNDLE
 * ========================================================================== */

/**
 * A minimal, structural view of `THREE.WebGPURenderer`.
 *
 * Typed here rather than imported for the reason at the top of this file. Only
 * the members `renderer.ts` and `Bootstrap.ts` actually drive are listed; every
 * one of them exists on `Renderer` in three 0.185.
 */
export interface NodeRendererLike {
  readonly domElement: HTMLCanvasElement;
  /**
   * `Info` from `renderers/common/`, NOT `WebGLInfo`, and the overlap is the
   * danger: `render.calls` exists on both and means different things — draws
   * this frame on WebGL, `render()` invocations since page load here, which
   * `reset()` does not clear. Read it through `normaliseInfo()`.
   */
  readonly info: {
    autoReset: boolean;
    reset(): void;
    readonly render: {
      calls: number; drawCalls: number; triangles: number; points: number; lines: number;
      /** Milliseconds resolved from WebGPU timestamp queries. */
      timestamp: number;
    };
    readonly memory: { geometries: number; textures: number; programs: number };
  };
  /**
   * `device` IS THE ONLY WAY TO LEARN THE DEVICE DIED OR WHICH GPU IT CAME FROM.
   *
   * three keeps the `GPUAdapter` as a local in `WebGPUBackend.init` and never
   * stores it, so `device.adapterInfo` is the only surviving read of the vendor
   * and architecture — and `powerPreference: 'high-performance'` is a hint that
   * Windows hybrid setups ignore, so the answer is not knowable any other way.
   * `device.lost` is the loss signal. Both are read through `backend.ts` and
   * `device-loss.ts`; nothing here dereferences a GPU type, which is what keeps
   * this file free of `three/webgpu` and of `@webgpu/types`.
   */
  readonly backend: {
    readonly isWebGPUBackend?: boolean;
    readonly isWebGLBackend?: boolean;
    readonly device?: DeviceLike;
    /** Enabled only while the performance panel is sampling. */
    trackTimestamp?: boolean;
  };
  readonly isWebGPURenderer: true;
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  autoClear: boolean;
  sortObjects: boolean;
  shadowMap: {
    enabled: boolean;
    type: THREE.ShadowMapType;
    autoUpdate: boolean;
    needsUpdate: boolean;
  };
  setPixelRatio(v: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setRenderTarget(t: THREE.RenderTarget | null): void;
  getRenderTarget(): THREE.RenderTarget | null;
  setScissorTest(enabled: boolean): void;
  getScissorTest(): boolean;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  /**
   * Draws one frame. THROWS unless `await renderer.init()` has resolved —
   * which is why `prepareRenderer()` exists and why nothing constructs this
   * renderer inside `bootstrap()`.
   */
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  /** Public draw seam used for passive per-pass accounting. */
  renderObject: NodeRenderObjectFunction;
  getRenderTarget(): { texture?: { name?: string } | null } | null;
  /** Resolve accumulated timestamp queries and return the latest frame's GPU ms. */
  resolveTimestampsAsync(type?: string): Promise<number | undefined>;
  /**
   * THE ONLY READBACK THIS RENDERER HAS. `WebGLRenderer.readRenderTargetPixels`
   * — synchronous, caller-supplied buffer — does not exist on `Renderer` at all;
   * this returns a freshly allocated typed array a frame or more later.
   *
   * Typed as `ArrayBufferView` because the element type follows the target's
   * GPU format: three picks it from `_getTypedArrayType(format)`, and an
   * RGBA8/RGBA8-sRGB target yields `Uint8Array`. The caller narrows, because a
   * float target would hand back `Float32Array` and quietly mean something else.
   *
   * The GPU copy is ENCODED AND SUBMITTED SYNCHRONOUSLY inside this call — an
   * `async` body runs to its first `await`, and three's is `mapAsync` — so the
   * bytes are captured against the render that preceded the call, and disposing
   * the render target afterwards cannot corrupt them.
   */
  readRenderTargetPixelsAsync(
    renderTarget: THREE.RenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    textureIndex?: number,
    faceIndex?: number,
  ): Promise<ArrayBufferView>;
  getMaxAnisotropy(): number;
  compile(scene: THREE.Object3D, camera: THREE.Camera): unknown;
  /** Synchronous after the renderer's boot-time `init()` has resolved. */
  hasFeature(name: string): boolean;
  /** Synchronous after the renderer's boot-time `init()` has resolved. */
  compute(computeNodes: unknown | readonly unknown[], dispatchSize?: unknown): void;
  /** Harness-only storage readback. Never used in the steady-state frame path. */
  getArrayBufferAsync(
    attribute: THREE.BufferAttribute,
    target?: null,
    offset?: number,
    count?: number,
  ): Promise<ArrayBuffer>;
  dispose(): void;
}

export type NodeRenderObjectFunction = (
  object: THREE.Object3D,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  group: THREE.Group | null,
  lightsNode: unknown,
  clippingContext?: { shadowPass?: boolean } | null,
  passId?: string | null,
) => void;

/** The post chain, reduced to what `PostChain` needs to forward. */
export interface NodePostChainLike {
  render(dt: number): void;
  syncConfig(): void;
  setWeatherIntensity(intensity: number): void;
  setIrradianceField(field: IrradianceFieldUpdate | null): boolean;
  setIrradianceMood(gain: number, red: number, green: number, blue: number): void;
  postLabel(): string;
  setSize(width: number, height: number): void;
  /**
   * Draw calls, split by pass, for the LAST frame — or null when the node
   * pipeline cannot supply the split. See `drawCallsByPass` in `post.ts`.
   */
  drawCallsByPass(): { shadow: number; colour: number; ao: number; post: number; total: number } | null;
  /** Triangle submissions by the same exhaustive buckets. WebGPU supplies this exactly. */
  trianglesByPass(): { shadow: number; colour: number; ao: number; post: number; total: number } | null;
  setScene(scene: THREE.Scene): void;
  setCamera(camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * Everything the node path supplies. One object, installed once.
 *
 * Names mirror the GLSL factory they stand in for, so a reader can grep either
 * name and land on both halves.
 */
export interface NodePath {
  /* -- boot ------------------------------------------------------------- */
  createRenderer(canvas: HTMLCanvasElement, antialias: boolean): Promise<NodeRendererLike>;
  createPmrem(renderer: NodeRendererLike): {
    fromScene(scene: THREE.Scene, sigma: number, near: number, far: number): THREE.RenderTarget;
    dispose(): void;
  };
  createPostChain(
    renderer: NodeRendererLike, scene: THREE.Scene, camera: THREE.Camera,
  ): NodePostChainLike;

  /* -- world ------------------------------------------------------------ */
  createSkyMaterial(): { material: THREE.Material; uniforms: SkyUniformSinkLike };
  createTerrainMaterials(options: CreateTerrainMaterialOptions): TerrainMaterialSetLike;
  createWaterMaterial(options: WaterMaterialOptions): WaterMaterialSetLike;
  createRoadMaterials(anisotropy: number): RoadMaterialSetLike;
  createShroudMaterial(look?: ShroudLook): ShroudMaterialSetLike;
  createContactShadowMaterial(): THREE.Material;
  createDecalMaterial(
    atlas: THREE.Texture, atlasCols: number, tileInset: number,
  ): {
    material: THREE.Material;
    setTime(t: number): void;
    setLightPoolGain(gain: number): void;
    dispose(): void;
  };

  /* -- art -------------------------------------------------------------- */
  createUnitMaterial(atlas: UnitMaterialTextures, name: string): THREE.Material;
  createSovietHarvesterCargoMaterial(): THREE.Material;
  createStructureMaterial(atlas: GreebleAtlas, name: string, coat?: StructureCoat): THREE.Material;
  createPadMaterial(atlas: GreebleAtlas, name: string): THREE.Material;
  createPropMaterials(): PropMaterialSetLike;
  createEnvironmentPropMaterials(
    params: THREE.MeshStandardMaterialParameters,
  ): PropMaterialSetLike;
  createFoliageComputeController(
    renderer: NodeRendererLike,
    spec: FoliageComputeSpec,
  ): FoliageComputeControllerLike;
  /**
   * A `MeshStandardNodeMaterial` carrying the shroud self-tint and nothing else
   * — the node twin of the three one-line `applyShroudTint` sites
   * (`ContactShadows`, `ore.system`, `entity-props.system`).
   */
  createShroudTintedStandard(params: THREE.MeshStandardMaterialParameters): THREE.Material;

  /* -- vfx -------------------------------------------------------------- */
  createRibbonMaterial(
    ramp: THREE.Texture, rampRows: number, name: string, depthTest: boolean,
  ): RibbonMaterialSetLike;
  createAdditiveSpriteMaterial(atlas: THREE.Texture, ramps: THREE.Texture): THREE.Material;
  createLitSpriteMaterial(
    atlas: THREE.Texture, ramps: THREE.Texture,
  ): { material: THREE.Material; uniforms: LitSmokeUniformSink };
  createDebrisMaterial(): THREE.Material;
}

/** The nine sky uniforms, as `{ value }` slots either backend can write. */
export interface SkyUniformSinkLike {
  uZenith: { value: THREE.Vector3 };
  uHorizon: { value: THREE.Vector3 };
  uGround: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uSunSize: { value: number };
  uSunIntensity: { value: number };
  uHazeWidth: { value: number };
  uExposure: { value: number };
}

/* ==========================================================================
 * 3. THE SLOT
 * ========================================================================== */

let installed: NodePath | null = null;

/**
 * Install the node path. Called exactly once, from `gpu-path-install.ts`.
 *
 * IDEMPOTENT ON THE SAME BUNDLE and a hard error on a different one. A second
 * install with a different object would mean two node systems in one page, which
 * is the class of bug where half the scene is built by one module registry and
 * half by another — silent, and visible only as materials that do not tint.
 */
export function installNodePath(path: NodePath): void {
  if (installed !== null && installed !== path) {
    throw new Error('[gpu-path] a different node path is already installed');
  }
  installed = path;
}

/** The installed node path, or null — which is the shipping WebGL case. */
export function nodePath(): NodePath | null {
  return installed;
}

/** True when materials must be built as node graphs. */
export function onNodePath(): boolean {
  return installed !== null;
}

/**
 * TEST SEAM ONLY. Clears the slot so a spec can install a fake and undo it.
 * Never called from product code.
 */
export function resetNodePathForTests(): void {
  installed = null;
}

/* ==========================================================================
 * 4. THE ASYNC DOOR
 * ========================================================================== */

/**
 * Resolve the requested backend and, for `webgpu`, load the node path.
 *
 * **THIS IS THE ONLY `import('three/webgpu')` REACHABLE FROM THE PRODUCT.** It
 * is a dynamic import inside a branch on `requestedBackend`, so Rollup emits the
 * node system as a SEPARATE CHUNK that a WebGL boot never fetches. Verified after
 * every build by `tests/webgpu-bundle-isolation.spec.ts`, which greps the emitted
 * entry chunk for node symbols.
 *
 * MUST be awaited BEFORE `bootstrap()`. `createRenderer` is synchronous — it is
 * called from a synchronous `bootstrap()` which is called from a synchronous
 * `Shell.startMatch` window that CLAUDE.md documents as load-bearing — and
 * `WebGPURenderer.render()` throws outright if `await renderer.init()` has not
 * resolved. So the async work happens here, once, before the engine exists.
 *
 * Returns the backend that will actually be attempted. It does NOT assert the
 * live backend: that is `assertBackend`'s job and it happens after the device is
 * real, because `navigator.gpu` and even a live adapter are both true in the
 * failing case (`docs/RENDER_FINDINGS.md` §7c).
 */
export async function prepareGpuPath(search: string): Promise<GpuBackend> {
  const want = requestedBackend(search);
  if (want !== 'webgpu') return 'webgl';
  if (installed === null) {
    const mod = await import('./gpu-path-install');
    mod.install();
  }
  return 'webgpu';
}

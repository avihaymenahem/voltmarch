/**
 * ============================================================================
 * VOLTMARCH — tools/terrain-node-compare/page.ts
 * ============================================================================
 * THE VISUAL PROOF FOR STAGE C. Renders ONE generated terrain chunk set with
 * the shipping GLSL material and with the TSL node material, across several
 * renderer/backend combinations, and lets the driver screenshot each canvas.
 *
 * WHY THIS EXISTS SEPARATELY FROM `npm run shots`. The shot harness photographs
 * the whole game, which needs the renderer seam wired end to end and a grade
 * baseline per backend. This asks a much narrower question — does the ported
 * shader draw the same ground — and can answer it before any of that lands.
 *
 * WHAT IS DELIBERATELY MISSING, and why the diff is still worth something: no
 * shadows, no post chain, no tone mapping. Each is a place the two renderers
 * could differ for reasons that have nothing to do with this material.
 *
 * TWO CONTROLS, AND NEITHER IS OPTIONAL
 * -------------------------------------
 *  - `glsl-webgpu` renders the SHIPPING `MeshStandardMaterial` under
 *    `WebGPURenderer`, where `onBeforeCompile` is silently dead. If that arm
 *    ever resembled the reference the instrument would be measuring nothing.
 *  - `stock-webgl` / `stock-webgpu` render a PLAIN grey standard material on
 *    each renderer. That pair is the floor: whatever they differ by is three's
 *    two lighting models disagreeing, and this port cannot be blamed for it.
 *    Without this arm, every pixel of difference gets attributed to the port.
 *
 * THE READBACK IS THE DRIVER'S JOB. An earlier version measured the environment
 * sweep in-page by `drawImage`-ing the WebGPU canvas into a 2D context and
 * diffing the bytes. Every row came back zero — INCLUDING THE CONTROL — which
 * is the signature of a dead instrument rather than a null result, and is the
 * exact failure `RENDER_FINDINGS.md` §6c warns about twice. The page now only
 * SETS STATE and re-renders; the driver screenshots and diffs, through the same
 * path that produces the non-zero arm numbers.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { TERRAIN_CHUNK_METRES, TERRAIN_LAYER_TEXTURE_SIZE } from '../../apps/game/src/core/config';
import { BIOMES, type BiomeName } from '../../apps/game/src/world/Biomes';
import { SPLAT_N, TerrainFields, buildTerrainChunks } from '../../apps/game/src/world/terrain-gen';
import { createTerrainMaterials } from '../../apps/game/src/world/TerrainMaterial';
import { createTerrainNodeMaterials } from '../../apps/game/src/world/TerrainNodeMaterial';

const WIDTH = 640;
const HEIGHT = 480;

type Arm =
  | 'glsl-webgl' | 'tsl-webgpu' | 'tsl-webgl2' | 'glsl-webgpu'
  | 'stock-webgl' | 'stock-webgpu';

interface ArmReport { arm: Arm; backend: string; ms: number }

/** The environment sweep's steps, driven one at a time from Node. */
type EnvStep =
  | 'matIntensity0' | 'matIntensity8'
  | 'sceneIntensity0' | 'sceneIntensity6'
  | 'ownMap0' | 'ownMap8'
  | 'sunOn' | 'sunOff'
  | 'restore';

declare global {
  interface Window {
    __TNC: {
      ready: Promise<void>;
      arms: ArmReport[];
      error: string | null;
      /** Set one environment state on the `env` canvas and re-render it. */
      envStep(step: EnvStep): Promise<void>;
      /** The scene environment intensity the restore step lands on. */
      restoreIntensity: number;
    };
  }
}

/* ==========================================================================
 * 1. THE WORLD — generated on the CPU, exactly as the game does
 * ========================================================================== */

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 4242);
const biomeName = (params.get('biome') ?? 'temperate') as BiomeName;
const biome = BIOMES[biomeName] ?? BIOMES.temperate;

/**
 * `?dither=off` turns the ordered dither off on BOTH materials.
 *
 * It exists to attribute the residual. The dither is a deliberate +/-0.5/255 of
 * per-pixel noise, and the two paths derive its grid position from
 * `gl_FragCoord` and from `screenCoordinate` — the same quantity, but the two
 * generated hashes need not land on the same value for a given pixel. So a
 * comparison with dithering ON reports most of the frame as "changed" at a mean
 * delta near 1, and reports it whether or not the shader is correct. Turning it
 * off on both sides is the only way to see what is underneath.
 */
const DITHER = (params.get('dither') ?? 'on') !== 'off';

/**
 * `TerrainFields` is the generator half — no THREE, no meshes, and the class
 * `Terrain` extends. Using it here keeps generation exactly where the migration
 * requires it to stay: on the CPU, deterministic, untouched by this port.
 */
const fields = new TerrainFields({
  seed,
  biome: biomeName,
  starts: [{ x: 128, z: 128 }, { x: 384, z: 384 }],
});
fields.generate();

const chunks = buildTerrainChunks(fields.height, fields.wallUp, fields.wallTop);

function splatTexture(data: Uint8Array, name: string): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, SPLAT_N, SPLAT_N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 2. THE SCENE — one geometry set, one material, nothing else
 * ========================================================================== */

function buildScene(material: THREE.Material): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161c);

  /*
   * HemisphereLight only, per the project's standing rule — a flat ambient
   * kills the shadow tint the whole grade depends on, and using one here would
   * make this page lie about a material that is always read under a hemisphere.
   */
  scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x4a4436, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-60, 90, 40);
  scene.add(sun);

  for (const c of chunks) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(c.normal, 3));
    geo.setAttribute('aUp', new THREE.BufferAttribute(c.up, 1));
    geo.setAttribute('aTop', new THREE.BufferAttribute(c.top, 1));
    geo.setIndex(new THREE.BufferAttribute(c.index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(c.cx * TERRAIN_CHUNK_METRES, 0, c.cz * TERRAIN_CHUNK_METRES);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
  }

  /*
   * Posed to frame a terrace, not open ground. A camera over a plain exercises
   * the ground branch only, and the cliff branch is where the port had the most
   * to get wrong — the triplanar, the striation, the cap, the skirt and the
   * face-normal substitution all live there.
   */
  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.5, 2000);
  camera.position.set(150, 62, 210);
  camera.lookAt(196, 6, 150);
  return { scene, camera };
}

/* ==========================================================================
 * 3. THE ARMS
 * ========================================================================== */

function canvasFor(arm: Arm | 'env'): HTMLCanvasElement {
  const el = document.getElementById(arm) as HTMLCanvasElement;
  el.width = WIDTH;
  el.height = HEIGHT;
  return el;
}

/** Both renderers get the same colour posture, or the diff measures that instead. */
function configure(r: THREE.WebGLRenderer | WebGPURenderer): void {
  r.setPixelRatio(1);
  r.setSize(WIDTH, HEIGHT, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
}

function glslSet() {
  const set = createTerrainMaterials({ biome, layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE, seed });
  set.setSplat(splatTexture(fields.splatA, 'a'), splatTexture(fields.splatB, 'b'));
  set.material.dithering = DITHER;
  return set;
}

function tslSet() {
  const set = createTerrainNodeMaterials({ biome, layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE, seed });
  set.setSplat(splatTexture(fields.splatA, 'a'), splatTexture(fields.splatB, 'b'));
  set.material.dithering = DITHER;
  return set;
}

/**
 * The lighting-model floor. Identical inputs, one material class per renderer,
 * no custom shader on either side. `0.42` grey at `roughness 0.9` sits in the
 * same part of the response curve the terrain layers do.
 */
function stockWebGL(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, metalness: 0 });
}
function stockNode(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.color = new THREE.Color(0x6b6b6b);
  m.roughness = 0.9;
  m.metalness = 0;
  return m;
}

function runWebGL(arm: Arm, material: THREE.Material): ArmReport {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(arm), antialias: false, preserveDrawingBuffer: true,
  });
  configure(renderer);
  const { scene, camera } = buildScene(material);
  const t0 = performance.now();
  renderer.render(scene, camera);
  return { arm, backend: 'webgl', ms: performance.now() - t0 };
}

interface NodeArm {
  report: ArmReport;
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

async function runNode(
  arm: Arm | 'env', material: THREE.Material, forceWebGL: boolean,
): Promise<NodeArm> {
  const renderer = new WebGPURenderer({ canvas: canvasFor(arm), antialias: false, forceWebGL });
  configure(renderer);
  await renderer.init();
  const { scene, camera } = buildScene(material);
  const t0 = performance.now();
  await renderer.renderAsync(scene, camera);
  const ms = performance.now() - t0;
  /*
   * `navigator.gpu` and a real adapter are BOTH true when three has silently
   * fallen back to WebGL2, so neither is evidence. This is.
   */
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl2-fallback';
  return { report: { arm: arm as Arm, backend, ms }, renderer, scene, camera };
}

/* ==========================================================================
 * 4. THE ENVIRONMENT ARM — `RENDER_FINDINGS.md` §6c, re-run on the node path
 *
 * §6c measured `material.envMapIntensity` 0 -> 8 at ZERO pixels changed and
 * attributed it to this material's custom-program path. This repeats the
 * measurement on a material that HAS no custom-program path, plus the two rows
 * that turn a null result into a diagnosis:
 *
 *   - `scene.environmentIntensity` as the CONTROL, so "0 changed" is a fact
 *     about the knob rather than about the probe;
 *   - the same sweep AFTER `setEnvironment` gives the material its own map,
 *     which is the documented condition under which three reads the
 *     per-material value at all.
 * ========================================================================== */

/**
 * A raw equirectangular environment, NOT pre-filtered here.
 *
 * `PMREMGenerator` was tried first and is WRONG on this path: it renders with a
 * raw `ShaderMaterial`, which the node renderer refuses — the console said
 * `THREE.NodeBuilder: Material "ShaderMaterial" is not compatible`, the returned
 * target was empty, and the whole environment sweep read zero INCLUDING ITS
 * CONTROL. `EnvironmentNode` wraps a non-PMREM value in `pmremTexture()` itself,
 * which is the node system's own pre-filter, so handing it the raw equirect is
 * both simpler and the supported route.
 */
function makeEnvironment(): THREE.Texture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // A simple sky gradient: bright above, warm and dim below.
      const t = y / (size - 1);
      data[i] = Math.round(230 - t * 150);
      data[i + 1] = Math.round(240 - t * 140);
      data[i + 2] = Math.round(255 - t * 190);
      data[i + 3] = 255;
    }
  }
  const src = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  src.mapping = THREE.EquirectangularReflectionMapping;
  src.colorSpace = THREE.SRGBColorSpace;
  src.needsUpdate = true;
  return src;
}

/* ==========================================================================
 * 5. RUN
 * ========================================================================== */

const arms: ArmReport[] = [];
let error: string | null = null;

/** State for the environment sweep, filled by `main`. */
let envArm: NodeArm | null = null;
let envSet: ReturnType<typeof tslSet> | null = null;
let envTexture: THREE.Texture | null = null;
const RESTORE_INTENSITY = 1;

/**
 * Install the environment as a NODE, not a texture.
 *
 * `scene.environment = <equirect DataTexture>` was measured INERT on this path:
 * with the harness proven live by a sun 2.4 -> 0 control that moved 99.758% of
 * pixels at max delta 102, `scene.environmentIntensity` 0 -> 6 moved ZERO. The
 * node system reaches a scene environment through `pmremTexture()`, and a raw
 * `DataTexture` is not something it pre-filters here.
 *
 * `scene.environmentNode` is the node system's own door and needs no PMREM at
 * all: `MeshStandardNodeMaterial.setupEnvironment` picks it up as
 * `builder.environmentNode` and wraps it in the same `EnvironmentNode` — which
 * is the object that multiplies by `materialEnvIntensity`, i.e. exactly the
 * quantity under test.
 */
function setSceneEnv(scene: THREE.Scene): void {
  (scene as unknown as { environmentNode: unknown }).environmentNode = vec3(0.62, 0.70, 0.86);
}

async function envStep(step: EnvStep): Promise<void> {
  if (!envArm || !envSet || !envTexture) throw new Error('env arm not built');
  const { renderer, scene, camera } = envArm;
  const material = envSet.material;

  switch (step) {
    case 'matIntensity0':
      setSceneEnv(scene);
      scene.environmentIntensity = RESTORE_INTENSITY;
      material.envMap = null;
      material.envMapIntensity = 0;
      break;
    case 'matIntensity8':
      material.envMapIntensity = 8;
      break;
    case 'sceneIntensity0':
      setSceneEnv(scene);
      material.envMap = null;
      material.envMapIntensity = 1;
      scene.environmentIntensity = 0;
      break;
    case 'sceneIntensity6':
      scene.environmentIntensity = 6;
      break;
    case 'ownMap0':
      setSceneEnv(scene);
      scene.environmentIntensity = RESTORE_INTENSITY;
      envSet.setEnvironment(envTexture, 0);
      break;
    case 'ownMap8':
      envSet.setEnvironment(envTexture, 8);
      break;
    /*
     * THE CONTROL ON THE CONTROL. If `sunOff` does not change the frame, the
     * screenshots are stale and every row above is a fact about the harness
     * rather than about the environment. Cost: two renders.
     */
    case 'sunOn':
    case 'sunOff': {
      const sun = scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight);
      if (sun) (sun as THREE.DirectionalLight).intensity = step === 'sunOff' ? 0 : 2.4;
      break;
    }
    case 'restore':
      /*
       * THE STATE THAT MATCHES TODAY. With the material's own map set to the
       * SCENE's intensity, `materialEnvIntensity` resolves to the same number
       * three would have used with no map at all — so the dial is live and the
       * ground's brightness is unchanged. That is the whole point: the knob
       * comes alive at the value it already had.
       */
      setSceneEnv(scene);
      scene.environmentIntensity = RESTORE_INTENSITY;
      envSet.setEnvironment(envTexture, RESTORE_INTENSITY);
      break;
  }
  material.needsUpdate = true;
  await renderer.renderAsync(scene, camera);
}

async function main(): Promise<void> {
  // 1. the reference: shipping GLSL material, shipping renderer.
  arms.push(runWebGL('glsl-webgl', glslSet().material));

  // 2. the port, on the node renderer's real WebGPU backend where available.
  arms.push((await runNode('tsl-webgpu', tslSet().material, false)).report);

  // 3. the port, forced onto the node renderer's WebGL2 backend. Same graph,
  //    other compiler — a difference here is a TSL portability bug.
  arms.push((await runNode('tsl-webgl2', tslSet().material, true)).report);

  // 4. CONTROL: the shipping GLSL material under the node renderer, where
  //    `onBeforeCompile` never fires. Must look nothing like arm 1.
  arms.push((await runNode('glsl-webgpu', glslSet().material, false)).report);

  // 5. CONTROL: the lighting-model floor, same plain material on each renderer.
  arms.push(runWebGL('stock-webgl', stockWebGL()));
  arms.push((await runNode('stock-webgpu', stockNode(), false)).report);

  // 6. the environment sweep, on its own canvas so the arms above stay put.
  envSet = tslSet();
  envArm = await runNode('env', envSet.material, false);
  envTexture = makeEnvironment();
  await envStep('matIntensity0');
}

window.__TNC = {
  arms,
  error,
  envStep,
  restoreIntensity: RESTORE_INTENSITY,
  ready: main()
    .catch((e: unknown) => { error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); })
    .then(() => { window.__TNC.arms = arms; window.__TNC.error = error; }),
};

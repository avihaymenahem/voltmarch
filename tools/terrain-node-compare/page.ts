/**
 * ============================================================================
 * VOLTMARCH — tools/terrain-node-compare/page.ts
 * ============================================================================
 * THE VISUAL PROOF FOR STAGE C. Renders ONE terrain chunk set with the shipping
 * GLSL material and with the TSL node material, on three renderer/backend
 * combinations, and hands the frames back for a pixel diff.
 *
 * WHY THIS EXISTS SEPARATELY FROM `npm run shots`. The shot harness photographs
 * the whole game, which needs the renderer seam wired end to end and a grade
 * baseline per backend. This asks a much narrower question — does the ported
 * shader draw the same ground — and it can answer it before any of that lands.
 *
 * WHAT IS DELIBERATELY MISSING FROM THE SCENE, and why the diff is still worth
 * something: no shadows, no post chain, no tone mapping, no environment (except
 * in the env arm, which asks for one on purpose). Every one of those is a place
 * the two renderers could differ for reasons that have nothing to do with this
 * material, and the question here is about this material. A scene this plain
 * makes any difference in the frame attributable to the shader under test.
 *
 * THE CONTROL ARM IS NOT OPTIONAL. `glsl-webgpu` renders the SHIPPING
 * `MeshStandardMaterial` under `WebGPURenderer`, where `onBeforeCompile` is
 * silently dead — so it draws flat white ground. If that arm ever matched the
 * reference, the instrument would be measuring nothing and every other number
 * on the page would be worthless.
 * ============================================================================
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { TERRAIN_CHUNK_METRES, TERRAIN_LAYER_TEXTURE_SIZE } from '../../src/core/config';
import { BIOMES, type BiomeName } from '../../src/world/Biomes';
import { SPLAT_N, TerrainFields, buildTerrainChunks } from '../../src/world/terrain-gen';
import { createTerrainMaterials } from '../../src/world/TerrainMaterial';
import { createTerrainNodeMaterials } from '../../src/world/TerrainNodeMaterial';

const WIDTH = 640;
const HEIGHT = 480;

type Arm = 'glsl-webgl' | 'tsl-webgpu' | 'tsl-webgl2' | 'glsl-webgpu';

interface ArmReport {
  arm: Arm;
  backend: string;
  ms: number;
}

interface EnvReport {
  /** Pixels changed by `material.envMapIntensity` with NO own envMap. */
  intensityWithoutMap: number;
  /** Pixels changed by `material.envMapIntensity` once `setEnvironment` ran. */
  intensityWithMap: number;
  /** Pixels changed by `scene.environmentIntensity`, the control. */
  sceneIntensity: number;
  total: number;
  /** The intensity that reproduces today's appearance. */
  matchingIntensity: number;
}

declare global {
  interface Window {
    __TNC: {
      ready: Promise<void>;
      arms: ArmReport[];
      env: EnvReport | null;
      error: string | null;
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
 * `TerrainFields` is the generator half — no THREE, no meshes, and the same
 * class `Terrain` extends. Using it here rather than `Terrain` keeps this page
 * off the scene-graph plumbing it does not need, and keeps generation exactly
 * where it must stay: on the CPU, deterministic, unchanged by this port.
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
 * 2. THE SCENE — one geometry set, two materials, nothing else
 * ========================================================================== */

function buildScene(material: THREE.Material): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161c);

  /*
   * HemisphereLight only, per the project's standing rule — a flat ambient
   * kills the shadow tint the whole grade depends on, and using one here would
   * make this page lie about a material that is read under a hemisphere.
   */
  const hemi = new THREE.HemisphereLight(0xbfd4ea, 0x4a4436, 1.1);
  scene.add(hemi);
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
   * Posed to frame a terrace, not open ground. A camera over a flat plain would
   * exercise the ground branch only, and the cliff branch is where the port had
   * the most to get wrong — the triplanar, the striation, the cap, the skirt
   * and the face-normal substitution all live there.
   */
  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.5, 2000);
  camera.position.set(150, 62, 210);
  camera.lookAt(196, 6, 150);
  return { scene, camera };
}

/* ==========================================================================
 * 3. THE ARMS
 * ========================================================================== */

function canvasFor(arm: Arm): HTMLCanvasElement {
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
  const set = createTerrainMaterials({
    biome, layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE, seed,
  });
  set.setSplat(splatTexture(fields.splatA, 'a'), splatTexture(fields.splatB, 'b'));
  return set;
}

function tslSet() {
  const set = createTerrainNodeMaterials({
    biome, layerTextureSize: TERRAIN_LAYER_TEXTURE_SIZE, seed,
  });
  set.setSplat(splatTexture(fields.splatA, 'a'), splatTexture(fields.splatB, 'b'));
  return set;
}

async function runWebGL(arm: Arm, material: THREE.Material): Promise<ArmReport> {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(arm), antialias: false, preserveDrawingBuffer: true,
  });
  configure(renderer);
  const { scene, camera } = buildScene(material);
  const t0 = performance.now();
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  return { arm, backend: 'webgl', ms };
}

async function runNode(
  arm: Arm, material: THREE.Material, forceWebGL: boolean,
): Promise<{ report: ArmReport; renderer: WebGPURenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }> {
  const renderer = new WebGPURenderer({
    canvas: canvasFor(arm), antialias: false, forceWebGL,
  });
  configure(renderer);
  await renderer.init();
  const { scene, camera } = buildScene(material);
  const t0 = performance.now();
  await renderer.renderAsync(scene, camera);
  const ms = performance.now() - t0;
  /*
   * `navigator.gpu` and a real adapter are BOTH true when three has silently
   * fallen back, so neither is evidence. `backend.isWebGPUBackend` is.
   */
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl2-fallback';
  return { report: { arm, backend, ms }, renderer, scene, camera };
}

/* ==========================================================================
 * 4. THE ENVIRONMENT ARM — `RENDER_FINDINGS.md` §6c, re-run on the node path
 *
 * §6c measured `material.envMapIntensity` 0 -> 8 at ZERO pixels changed and
 * attributed it to this material's custom-program path. This repeats the same
 * measurement on a material that has no custom-program path at all, plus the
 * two rows that turn a null result into a diagnosis:
 *
 *   - `scene.environmentIntensity` as the CONTROL, so "0 changed" is a fact
 *     about the knob and not about the probe;
 *   - the same `envMapIntensity` sweep AFTER `setEnvironment` gives the material
 *     its own map, which is the documented condition under which three reads the
 *     per-material value at all.
 * ========================================================================== */

function readPixels(renderer: WebGPURenderer, canvas: HTMLCanvasElement): Uint8ClampedArray {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  void renderer;
  return ctx.getImageData(0, 0, off.width, off.height).data;
}

function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

/**
 * A minimal cube environment. Procedural, one colour per face, because the
 * question is whether the SCALE reaches the pixels and not what the probe looks
 * like.
 */
function makeEnvironment(renderer: WebGPURenderer): THREE.Texture {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 180; data[i * 4 + 1] = 200; data[i * 4 + 2] = 235; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  void renderer;
  return tex;
}

/* ==========================================================================
 * 5. RUN
 * ========================================================================== */

const arms: ArmReport[] = [];
let env: EnvReport | null = null;
let error: string | null = null;

async function main(): Promise<void> {
  // 1. the reference: shipping GLSL material, shipping renderer.
  arms.push(await runWebGL('glsl-webgl', glslSet().material));

  // 2. the port, on the node renderer's real WebGPU backend where available.
  const tslGpu = await runNode('tsl-webgpu', tslSet().material, false);
  arms.push(tslGpu.report);

  // 3. the port, forced onto the node renderer's WebGL2 backend. Same graph,
  //    other compiler — a difference here is a TSL portability bug.
  arms.push((await runNode('tsl-webgl2', tslSet().material, true)).report);

  // 4. THE CONTROL. The shipping GLSL material under the node renderer, where
  //    `onBeforeCompile` never fires. This must look nothing like arm 1.
  arms.push((await runNode('glsl-webgpu', glslSet().material, false)).report);

  // 5. the environment sweep, on the arm that is the actual port.
  const set = tslSet();
  const node = await runNode('tsl-webgpu', set.material, false);
  const canvas = canvasFor('tsl-webgpu');

  const shot = async (): Promise<Uint8ClampedArray> => {
    await node.renderer.renderAsync(node.scene, node.camera);
    return readPixels(node.renderer, canvas);
  };

  const environment = makeEnvironment(node.renderer);
  node.scene.environment = environment;
  node.scene.environmentIntensity = 1;

  set.material.envMapIntensity = 0;
  set.material.needsUpdate = true;
  const a0 = await shot();
  set.material.envMapIntensity = 8;
  set.material.needsUpdate = true;
  const a8 = await shot();

  node.scene.environmentIntensity = 0;
  const s0 = await shot();
  node.scene.environmentIntensity = 6;
  const s6 = await shot();
  node.scene.environmentIntensity = 1;

  // Now give the material its OWN map, which is the documented switch.
  set.setEnvironment(environment, 0);
  const b0 = await shot();
  set.setEnvironment(environment, 8);
  const b8 = await shot();

  env = {
    intensityWithoutMap: changed(a0, a8),
    sceneIntensity: changed(s0, s6),
    intensityWithMap: changed(b0, b8),
    total: canvas.width * canvas.height,
    matchingIntensity: 1,
  };

  // Leave the page in the state that MATCHES TODAY: scene intensity 1, and the
  // per-material dial set to the same number, so the last frame on screen is
  // the one the port is claimed to reproduce.
  set.setEnvironment(environment, node.scene.environmentIntensity);
  await node.renderer.renderAsync(node.scene, node.camera);
}

window.__TNC = {
  arms,
  env,
  error,
  ready: main()
    .catch((e: unknown) => { error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); })
    .then(() => { window.__TNC.arms = arms; window.__TNC.env = env; window.__TNC.error = error; }),
};

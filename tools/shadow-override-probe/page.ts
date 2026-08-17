/**
 * ============================================================================
 * VOLTMARCH — tools/shadow-override-probe/page.ts
 * ============================================================================
 * THE PAGE HALF of the measurement `StageDNodeMaterial.STAGE_D_TSL_GAPS` #1 asks
 * for: **does `material.allowOverride = false` close the node path's shadow gap,
 * and what does it cost?** Driven by `tools/shadow-override-probe.mjs`; the port
 * and browser rules are that file's and are not repeated here.
 *
 * THE GAP, IN ONE SENTENCE. `object.customDepthMaterial` is read in exactly one
 * file in three 0.185 (`WebGLShadowMap.js`); the node renderer instead sets
 * `scene.overrideMaterial` to a shared depth material and harvests four fields
 * off the object's own material, none of which is `setupPosition`. So every
 * MODEL-SPACE vertex displacement in this project — the construction sink, the
 * bay door, the radar spin, the walk cycle, the wind sway — is invisible to the
 * shadow pass, and a half-built structure casts its FINISHED silhouette.
 *
 * WHAT IS ON SCREEN, AND WHY THE CAMERA POINTS AT THE GROUND. The subject is the
 * SHADOW, not the object. A row of structures at `buildProgress` 0.30 — seven
 * tenths of each one still below the ground cut — and a row of props under a
 * frozen wind, thrown across a plane by one directional light at a low angle.
 * The structures are the decisive case (the silhouette changes SIZE, so a broken
 * shadow pass is unmissable); the props are the second half of the same gap
 * (`PropLibrary`'s `depthMaterial`, whose whole job is that a swaying canopy
 * never casts a frozen shadow).
 *
 * THE FIVE ARMS AND WHY EACH ONE IS NEEDED
 * ----------------------------------------
 *   glsl-webgl                the shipping renderer with `customDepthMaterial`.
 *                             THE REFERENCE — this is the correct picture.
 *   glsl-webgl-nodepth        the same renderer with the custom depth materials
 *                             REMOVED. THE CONTROL: the defect reproduced on a
 *                             renderer we trust, so a diff that cannot separate
 *                             it from the reference is an instrument that cannot
 *                             see the thing being measured.
 *   tsl-override              the node path as Stage D left it.
 *   tsl-nooverride            the node path with `material.allowOverride = false`
 *                             — the one-line route Stage D said to measure first.
 *   tsl-nooverride-noreceive  the same, with `receiveShadow` off the CASTERS.
 *                             THE DIAGNOSTIC, added after the run below.
 *
 * WHAT IT FOUND, so nobody re-runs it to learn the same thing:
 *
 *     glsl-webgl-nodepth        0 devErrs   3.040% darker   <- the defect
 *     tsl-override              0 devErrs   3.040% darker   <- the same defect
 *     tsl-nooverride            2 devErrs  89.312% darker   <- BLANK FRAME
 *     tsl-nooverride-noreceive  0 devErrs   0.470% darker   <- correct
 *
 * `allowOverride = false` raises
 * `GPUValidationError: [Texture "ShadowDepthTexture"] usage ... includes
 * writable usage and another usage in the same synchronization scope`, because
 * the caster's own lit material SAMPLES the shadow map the pass is WRITING. The
 * command buffer is invalidated and the frame draws nothing — which is what the
 * 89% is. The fifth arm removes the sampler and the shadow comes out correct, so
 * the flag really does reach `setupPosition`; it is simply unusable, because
 * every caster in this game receives shadows. `StructureNodeMaterial`'s
 * `STAGE_D_TSL_GAPS` #1 carries the conclusion.
 *
 * WHAT THIS PAGE CANNOT MEASURE. `renderer.info.programs` is a WebGL array; the
 * node `Renderer` has none, so "the shadow pass now compiles the full physical
 * shader as well as the depth one" stayed unquantified. It is reported as 0 and
 * labelled rather than omitted.
 * ============================================================================
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GreebleFactory } from '../../src/art/Greeble';
import {
  buildingTime, createStructureDepthMaterial, createStructureMaterial,
} from '../../src/art/BuildingFactory';
import { specForPalette } from '../../src/art/UnitFactory';
import { RA3_ALLIED_STRUCTURE } from '../../src/core/config';
import { createStructureNodeMaterial } from '../../src/art/StructureNodeMaterial';
import { createPropMaterial } from '../../src/world/PropLibrary';
import { createPropNodeMaterials } from '../../src/world/PropNodeMaterial';
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from '../../src/world/prop-wind';
import { shroudUniforms } from '../../src/render/FogOfWar';

const WIDTH = 640;
const HEIGHT = 480;

type Arm =
  | 'glsl-webgl' | 'glsl-webgl-nodepth'
  | 'tsl-override' | 'tsl-nooverride' | 'tsl-nooverride-noreceive';

interface ArmReport {
  arm: Arm;
  backend: string;
  ms: number;
  /** `renderer.info` after one frame with the shadow map rebuilt. */
  drawCalls: number;
  triangles: number;
  /**
   * `renderer.info.programs` — WebGL only. The node `Renderer` has no such
   * array, so this is 0 on every node arm and is reported rather than silently
   * omitted: "the shadow pass now compiles a second, much larger program" is a
   * real cost that this instrument CANNOT measure, and saying so is better than
   * printing a zero that looks like an answer.
   */
  programs: number;
  /**
   * Every `GPUValidationError` the device raised while this arm rendered.
   *
   * THE FIELD THE PROBE TURNED OUT TO BE ABOUT. A WebGPU validation error
   * invalidates the whole command buffer, so the arm draws NOTHING and the pixel
   * diff reports a huge number that looks like a shader difference. Without this
   * column the result would read as "the flag changes the picture a lot".
   */
  deviceErrors: string[];
}

declare global {
  interface Window {
    __SOP: {
      ready: Promise<void>;
      arms: ArmReport[];
      error: string | null;
      warnings: string[];
    };
  }
}

/**
 * Frozen, for the reason `stage-d-node-compare/page.ts` gives: both paths read a
 * uniform, so a wall clock would make the arms disagree about the TIME rather
 * than about the shadow, and the difference would look exactly like the defect.
 * 3.7 s puts the bay door part-open and the wind well off zero.
 */
const FROZEN_TIME = 3.7;

/**
 * Seven tenths of every structure is still underground.
 *
 * This is the number the whole page turns on, and at 0.30 the sink (4.9 m) is
 * deeper than the block is tall, so every structure vertex falls below the
 * ground cut and the CORRECT answer is: three invisible structures casting no
 * shadow at all. That reads as a stronger demonstration than a partial
 * silhouette, not a weaker one — the broken arms show three hard black slabs on
 * an empty plane, thrown by objects that are not there. It is also exactly what
 * a player sees at the start of a build.
 *
 * At `buildProgress` 1 the two shadows are identical and this page measures
 * nothing. Anything above 0.5 leaves a visible sliver; that is a fair test too,
 * and a duller picture.
 */
const BUILD_PROGRESS = 0.30;

/* ==========================================================================
 * 1. THE SHROUD
 *
 * OFF, deliberately, and this page is the one place in the migration where that
 * is the right setting. `uFogAmount` 0 makes the self-tint the identity, so
 * nothing here can be a fog difference wearing a shadow's clothes.
 * ========================================================================== */

function installShroud(): void {
  shroudUniforms.uFogAmount.value = 0;
}

/* ==========================================================================
 * 2. THE SUBJECTS
 * ========================================================================== */

const STRUCTURE_INSTANCES = 3;
const PROP_INSTANCES = 4;

/** Per-instance channels every batched mesh in the game carries. */
function addInstanceState(
  geo: THREE.BufferGeometry, state: readonly number[], count: number,
): void {
  const s = new Float32Array(count * 4);
  const t = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    s.set(state, i * 4);
    t.set([0.85, 0.2, 0.15], i * 3);
    s[i * 4 + 3] = state[3] + i * 0.31;
  }
  geo.setAttribute('aState', new THREE.InstancedBufferAttribute(s, 4));
  geo.setAttribute('aTeamColor', new THREE.InstancedBufferAttribute(t, 3));
}

/**
 * A tall block. Height is what makes the construction sink legible in a shadow:
 * `aFeature.y` is the rise height, and the vertex drops by
 * `( 1 - buildProgress ) * riseHeight`, so a 7 m tower at 0.30 sinks 4.9 m.
 */
function structureGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(4, 7, 4, 1, 3, 1).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const feature = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    // `plain` (code 0) everywhere: no door, no spin. The SINK is the subject and
    // a second animation on the same silhouette would only muddy the diff.
    feature[i * 4] = 0;
    feature[i * 4 + 1] = 7;   // rise height, metres
    feature[i * 4 + 2] = 0;
    feature[i * 4 + 3] = 0;
  }
  geo.setAttribute('aFeature', new THREE.BufferAttribute(feature, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
  addInstanceState(geo, [1, BUILD_PROGRESS, 0, 0.2], STRUCTURE_INSTANCES);
  return geo;
}

/** A thin tall prop, so the wind offset moves the tip several metres of shadow. */
function propGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1.1, 8, 1.1, 1, 4, 1).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const sway = new Float32Array(n);
  const emit = new Float32Array(n);
  const gloss = new Float32Array(n);
  const colour = new Float32Array(n * 3).fill(0.55);
  for (let i = 0; i < n; i++) {
    // Zero at the foot, largest at the tip — a trunk does not move.
    sway[i] = Math.max(0, pos.getY(i) / 4) * 2.2;
  }
  geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  geo.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
  geo.setAttribute('aGloss', new THREE.BufferAttribute(gloss, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colour, 3));

  const phase = new Float32Array(PROP_INSTANCES);
  for (let i = 0; i < PROP_INSTANCES; i++) {
    const worldX = (i - (PROP_INSTANCES - 1) / 2) * 7;
    phase[i] = worldX * PROP_WIND.phaseX + 14 * PROP_WIND.phaseZ;
  }
  geo.setAttribute(PROP_WIND_PHASE_ATTRIBUTE, new THREE.InstancedBufferAttribute(phase, 1));
  addInstanceState(geo, [1, 1, 0, 0], PROP_INSTANCES);
  return geo;
}

const structureGeo = structureGeometry();
const propGeo = propGeometry();

function placeRow(mesh: THREE.InstancedMesh, count: number, z: number, spacing: number): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    q.setFromEuler(new THREE.Euler(0, 0.4 * (i + 1), 0));
    p.set((i - (count - 1) / 2) * spacing, 3.5, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ==========================================================================
 * 3. THE SCENE
 * ========================================================================== */

interface MaterialSet {
  structure: THREE.Material;
  structureDepth: THREE.Material | null;
  prop: THREE.Material;
  propDepth: THREE.Material | null;
  ground: THREE.Material;
  /**
   * Whether the CASTERS also receive shadows, which they do in the game.
   *
   * Only the `noreceive` arm turns this off, and only to isolate the cause of
   * the validation error `allowOverride = false` raises. It is a diagnostic, not
   * an option: a building that cannot be shadowed by the building next to it is
   * not a rendering the look bible would accept.
   */
  castersReceive: boolean;
}

function buildScene(mats: MaterialSet): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161c);

  // HemisphereLight only, per the project's standing rule. Weak, because the
  // subject is a shadow and ambient fill is what washes one out.
  scene.add(new THREE.HemisphereLight(0x9fb4ca, 0x2a2620, 0.35));

  const sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
  // A LOW sun. The shadow is thrown long across the plane and toward the
  // camera, so a silhouette that is 4.9 m too tall is metres of extra darkness
  // rather than a few pixels at the base.
  sun.position.set(-34, 26, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -40; cam.right = 40; cam.top = 40; cam.bottom = -40;
  cam.near = 1; cam.far = 140;
  cam.updateProjectionMatrix();
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const structures = new THREE.InstancedMesh(structureGeo, mats.structure, STRUCTURE_INSTANCES);
  placeRow(structures, STRUCTURE_INSTANCES, -6, 11);
  structures.castShadow = true;
  structures.receiveShadow = mats.castersReceive;
  if (mats.structureDepth !== null) structures.customDepthMaterial = mats.structureDepth;
  scene.add(structures);

  const props = new THREE.InstancedMesh(propGeo, mats.prop, PROP_INSTANCES);
  placeRow(props, PROP_INSTANCES, 14, 7);
  props.castShadow = true;
  props.receiveShadow = mats.castersReceive;
  if (mats.propDepth !== null) props.customDepthMaterial = mats.propDepth;
  scene.add(props);

  // High and looking down, because the SHADOW is the subject.
  const camera = new THREE.PerspectiveCamera(42, WIDTH / HEIGHT, 0.5, 400);
  camera.position.set(6, 40, 46);
  camera.lookAt(0, 0, 2);
  return { scene, camera };
}

/* ==========================================================================
 * 4. THE ARMS
 * ========================================================================== */

function canvasFor(arm: Arm): HTMLCanvasElement {
  const el = document.getElementById(arm) as HTMLCanvasElement;
  el.width = WIDTH;
  el.height = HEIGHT;
  return el;
}

const greeble = new GreebleFactory();
const atlas = greeble.atlas(specForPalette('sop.allies', RA3_ALLIED_STRUCTURE, 256, 4242));

/** A plain, matte, un-ported receiver. It is the screen the shadow lands on. */
function groundGlsl(): THREE.Material {
  return new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.95, metalness: 0 });
}

function glslSet(withDepth: boolean): MaterialSet {
  const props = createPropMaterial();
  props.setTime(FROZEN_TIME);
  const structure = createStructureMaterial(atlas, 'sop.structure');
  return {
    structure,
    structureDepth: withDepth ? createStructureDepthMaterial() : null,
    prop: props.material,
    propDepth: withDepth ? props.depthMaterial : null,
    ground: groundGlsl(),
    castersReceive: true,
  };
}

function tslSet(allowOverride: boolean, castersReceive = true): MaterialSet {
  const props = createPropNodeMaterials();
  props.setTime(FROZEN_TIME);
  const structure = createStructureNodeMaterial(atlas, 'sop.structure.node');
  /*
   * THE ONE LINE THE WHOLE PROBE IS ABOUT. `Renderer.renderObject` reads
   * `material.allowOverride === true && scene.overrideMaterial !== null` before
   * it swaps in the shadow pass's shared depth material, so `false` means the
   * object is drawn into the shadow map with ITS OWN material — and therefore
   * with its own `setupPosition`, which is the hook the construction sink and
   * the wind sway both live in.
   */
  structure.allowOverride = allowOverride;
  props.material.allowOverride = allowOverride;
  return {
    structure,
    // There is no node twin of `customDepthMaterial` and there cannot be — that
    // is the gap. Both node arms therefore pass null and differ only in the flag.
    structureDepth: null,
    prop: props.material,
    propDepth: null,
    // The node renderer needs a node material for the receiver too.
    ground: groundNode(),
    castersReceive,
  };
}

function groundNode(): THREE.Material {
  const m = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.95, metalness: 0 });
  return m;
}

function configure(r: THREE.WebGLRenderer | WebGPURenderer): void {
  r.setPixelRatio(1);
  r.setSize(WIDTH, HEIGHT, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
  r.shadowMap.enabled = true;
  // PCF, matching `src/render/renderer.ts`. Soft is deprecated in three 0.185
  // and VSM would put moments in the shadow map's COLOUR channel, which is the
  // one thing `allowOverride = false` genuinely could break — noted rather than
  // measured, because the game does not use it.
  r.shadowMap.type = THREE.PCFShadowMap;
}

function runWebGL(arm: Arm, mats: MaterialSet): ArmReport {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(arm), antialias: false, preserveDrawingBuffer: true,
  });
  configure(renderer);
  const { scene, camera } = buildScene(mats);
  renderer.info.autoReset = false;
  renderer.info.reset();
  const t0 = performance.now();
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  return {
    arm, backend: 'webgl', ms,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0,
    deviceErrors: [],
  };
}

async function runNode(arm: Arm, mats: MaterialSet): Promise<ArmReport> {
  const renderer = new WebGPURenderer({ canvas: canvasFor(arm), antialias: false });
  configure(renderer);
  await renderer.init();

  /*
   * LISTEN TO THE DEVICE, PER ARM.
   *
   * three logs uncaptured errors to the console, which lands them in one
   * undifferentiated pile shared by four renderers. A validation error
   * invalidates the entire command buffer — the arm draws nothing and the pixel
   * diff then reports an enormous difference that reads like a shader change.
   * Attributing the error to the arm that raised it is the difference between
   * "the flag changes the picture" and "the flag makes the frame invalid".
   */
  const deviceErrors: string[] = [];
  const device = (renderer.backend as { device?: GPUDevice }).device;
  device?.addEventListener('uncapturederror', (e: Event) => {
    const err = (e as GPUUncapturedErrorEvent).error;
    deviceErrors.push(`${err.constructor.name}: ${err.message}`);
  });

  const { scene, camera } = buildScene(mats);
  /*
   * TWO FRAMES, TIMED ON THE SECOND. The first compiles every pipeline the scene
   * needs — including, in the `nooverride` arms, the full physical shader for the
   * shadow pass — and a first-frame millisecond reading is a compile time, not a
   * render time.
   */
  renderer.render(scene, camera);
  renderer.info.reset();
  const t0 = performance.now();
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl2-fallback';
  return {
    arm, backend, ms,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0,
    deviceErrors,
  };
}

/* ==========================================================================
 * 5. THE RUN
 * ========================================================================== */

const arms: ArmReport[] = [];
const warnings: string[] = [];
let error: string | null = null;

const realWarn = console.warn.bind(console);
console.warn = (...a: unknown[]): void => { warnings.push(a.map(String).join(' ')); realWarn(...a); };

const ready = (async () => {
  try {
    installShroud();
    buildingTime.value = FROZEN_TIME;

    arms.push(runWebGL('glsl-webgl', glslSet(true)));
    arms.push(runWebGL('glsl-webgl-nodepth', glslSet(false)));
    arms.push(await runNode('tsl-override', tslSet(true)));
    arms.push(await runNode('tsl-nooverride', tslSet(false)));
    /*
     * THE DIAGNOSTIC ARM. If `allowOverride = false` fails because the object's
     * OWN material samples the shadow map it is being rendered into, then taking
     * `receiveShadow` off the casters removes the sampler and the frame becomes
     * valid. That is a hypothesis about a WebGPU rule, and this is the one change
     * that separates it from every other explanation.
     */
    arms.push(await runNode('tsl-nooverride-noreceive', tslSet(false, false)));
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }
})();

window.__SOP = {
  ready,
  get arms() { return arms; },
  get error() { return error; },
  get warnings() { return warnings; },
};

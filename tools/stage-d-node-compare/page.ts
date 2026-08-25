/**
 * ============================================================================
 * VOLTMARCH — tools/stage-d-node-compare/page.ts
 * ============================================================================
 * THE PAGE HALF of the Stage D visual proof. Driven by
 * `tools/stage-d-node-compare.mjs`; see that file for the port and browser
 * rules, which are `tools/shoot.mjs`'s and are not repeated here.
 *
 * WHAT IT DRAWS. Three `InstancedMesh`es, one per material family — a structure
 * part, a unit hull, a scatter prop — under one hemisphere and one directional
 * light, rendered four ways.
 *
 * THE GEOMETRY IS DELIBERATELY NOT THE GAME'S MODELS, AND THAT IS THE POINT.
 * `BuildingFactory` and `UnitFactory` build their meshes through `MassList`, and
 * standing one up here would drag half the art pipeline into a page whose whole
 * question is "do two implementations of ONE MATERIAL agree". Both arms get the
 * same primitives with the same attributes, so any difference is the shader.
 * What this page cannot answer is whether the models look right; that is
 * `npm run shots`, and it belongs to Stage F.
 *
 * THE ATTRIBUTES ARE POSED, NOT ZEROED. A structure at `buildProgress` 0.55 with
 * a door code and a spin code, at 0.30 HP so it soots and burns, selected so it
 * pulses; a soldier mid-stride; a prop with a lit head and a glossy panel. Every
 * branch this port had to translate is therefore on screen at once. Zeroed
 * attributes would produce two identical pictures out of two shaders that agree
 * about nothing.
 *
 * THE SHROUD IS ON. `shroudUniforms.uFogAmount` is 1 and the mask is a real
 * gradient, so the self-tint is measured rather than assumed — and so is the
 * `onRenderUpdate` MIRROR in `render/shroud-nodes.ts`, which is the only part of
 * this port that has no offline test at all.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { GreebleFactory } from '../../apps/game/src/art/Greeble';
import { createStructureMaterial } from '../../apps/game/src/art/BuildingFactory';
import { buildingTime } from '../../apps/game/src/art/BuildingFactory';
import { createUnitMaterial, specForPalette } from '../../apps/game/src/art/UnitFactory';
import { RA3_ALLIED_STRUCTURE } from '../../apps/game/src/core/config';
import { createStructureNodeMaterial } from '../../apps/game/src/art/StructureNodeMaterial';
import { createUnitNodeMaterial } from '../../apps/game/src/art/UnitNodeMaterial';
import { createPropMaterial } from '../../apps/game/src/world/PropLibrary';
import { createPropNodeMaterials, PROP_WIND_PHASE_ATTRIBUTE } from '../../apps/game/src/world/PropNodeMaterial';
import { PROP_WIND } from '../../apps/game/src/world/prop-wind';
import { shroudUniforms } from '../../apps/game/src/render/FogOfWar';
import { gaitUniforms } from '../../apps/game/src/render/Gait';

const WIDTH = 640;
const HEIGHT = 480;

type Arm =
  | 'glsl-webgl' | 'tsl-webgpu' | 'tsl-webgl2' | 'glsl-webgpu'
  | 'stock-webgl' | 'stock-webgpu';

interface ArmReport { arm: Arm; backend: string; ms: number }

declare global {
  interface Window {
    __SDC: {
      ready: Promise<void>;
      arms: ArmReport[];
      error: string | null;
      warnings: string[];
    };
  }
}

const params = new URLSearchParams(location.search);
const DITHER = (params.get('dither') ?? 'on') !== 'off';

/**
 * The wind and building clocks are FROZEN at a chosen instant.
 *
 * Both shaders read a uniform, so a wall clock would make the two arms disagree
 * about the time rather than about the shader — and the difference would look
 * exactly like a port defect. 3.7 s is picked because it puts the bay door
 * part-open (`fract( 3.7 / 9 ) = 0.411`, inside the closing ramp) rather than at
 * either rail.
 */
const FROZEN_TIME = 3.7;

/* ==========================================================================
 * 1. THE SHROUD, MADE VISIBLE
 * ========================================================================== */

/**
 * A real 128x128 R8 mask with a horizontal gradient: unexplored at the left,
 * remembered through the middle, fully visible at the right.
 *
 * That covers all three branches of the tint in one frame — `vmRem` at 1, the
 * `vmFog` ramp between the two `smoothstep`s, and the untinted tail.
 */
function installShroud(): void {
  const n = 128;
  const bytes = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) bytes[y * n + x] = Math.round((x / (n - 1)) * 255);
  }
  const tex = new THREE.DataTexture(bytes, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.name = 'StageDShroudMask';
  tex.needsUpdate = true;
  shroudUniforms.uFogMask.value = tex;
  shroudUniforms.uFogTint.value.set(0.05, 0.07, 0.11, 0.55);
  shroudUniforms.uFogDark.value.set(0.01, 0.012, 0.02, 0.92);
  shroudUniforms.uFogAmount.value = 1;
}

/* ==========================================================================
 * 2. THE THREE SUBJECTS
 * ========================================================================== */

/** Per-instance channels every batched mesh in the game carries. */
function addInstanceState(
  geo: THREE.BufferGeometry, state: readonly number[], team: readonly number[], count: number,
): void {
  const s = new Float32Array(count * 4);
  const t = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    s.set(state, i * 4);
    t.set(team, i * 3);
    // The seed channel is per entity, so give each instance its own or the
    // burn flicker and the door phase lock together across the row.
    s[i * 4 + 3] = state[3] + i * 0.31;
  }
  geo.setAttribute('aState', new THREE.InstancedBufferAttribute(s, 4));
  geo.setAttribute('aTeamColor', new THREE.InstancedBufferAttribute(t, 3));
}

/** Fill a per-vertex float attribute from a function of the vertex position. */
function addVertexAttr(
  geo: THREE.BufferGeometry, name: string, size: number,
  fill: (x: number, y: number, z: number, out: Float32Array, at: number) => void,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * size);
  for (let i = 0; i < pos.count; i++) {
    fill(pos.getX(i), pos.getY(i), pos.getZ(i), out, i * size);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, size));
}

/** Vertex colours: units and props both declare `vertexColors: true`. */
function addVertexColors(geo: THREE.BufferGeometry, tint: readonly number[]): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // A crude cavity gradient, which is what the real bake carries.
    const k = 0.55 + 0.45 * Math.min(1, Math.max(0, pos.getY(i) * 0.4 + 0.5));
    c[i * 3] = tint[0] * k; c[i * 3 + 1] = tint[1] * k; c[i * 3 + 2] = tint[2] * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

const STRUCTURE_INSTANCES = 3;
const UNIT_INSTANCES = 4;
const PROP_INSTANCES = 5;

/**
 * A structure part: mid-build, hurt, selected, and carrying a bay door on the
 * lower half and a radar spin on the upper.
 */
function structureGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(4, 6, 4, 2, 4, 2);
  addVertexColors(geo, [1, 1, 1]);
  // aFeature = (code, riseHeight, animParam, phase). Codes: 2 door, 3 spin.
  addVertexAttr(geo, 'aFeature', 4, (_x, y, _z, out, at) => {
    const door = y < -1;
    out[at] = door ? 2 : 3;
    out[at + 1] = 6;                 // riseHeight, in metres of model space
    out[at + 2] = door ? 1.1 : 0.55; // door travel / dish radians per second
    out[at + 3] = 0;
  });
  addInstanceState(geo, [0.30, 0.55, 1, 0.0], [0.85, 0.13, 0.10], STRUCTURE_INSTANCES);
  return geo;
}

/** A unit hull: one limb group swinging about a pivot, mid-stride. */
function unitGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(2.0, 24, 16);
  addVertexColors(geo, [1, 1, 1]);
  // aGait = (swingSign, pivotY). Everything below the equator swings.
  addVertexAttr(geo, 'aGait', 2, (_x, y, _z, out, at) => {
    out[at] = y < 0 ? 1 : 0;
    out[at + 1] = 0;
  });
  // aState.w is the walk phase in TURNS; 0.18 is mid-stride, not a rail.
  addInstanceState(geo, [0.72, 1, 1, 0.18], [0.16, 0.42, 0.88], UNIT_INSTANCES);
  return geo;
}

/** A prop: swaying canopy, a lit head, and a glossy panel down one side. */
function propGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(1.8, 5, 18, 4);
  addVertexColors(geo, [0.42, 0.62, 0.30]);
  addVertexAttr(geo, 'aSway', 1, (_x, y, _z, out, at) => {
    out[at] = Math.max(0, y + 2.5) * 0.09;   // zero at the foot, most at the tip
  });
  addVertexAttr(geo, 'aEmit', 1, (_x, y, _z, out, at) => { out[at] = y > 1.6 ? 1 : 0; });
  addVertexAttr(geo, 'aGloss', 1, (x, _y, _z, out, at) => { out[at] = x > 0 ? 1 : 0; });
  const phase = new Float32Array(PROP_INSTANCES);
  for (let i = 0; i < PROP_INSTANCES; i++) {
    /*
     * The same phase `Scatter` now publishes, computed the same way: the
     * instance's world X and Z through the two coefficients. This page builds
     * its own geometry rather than standing up a real scatter (see the header),
     * so it fills the column itself — but it is no longer standing in for a
     * missing feature, and if the two formulas ever diverge
     * `tests/scatter-wind-phase.spec.ts` is what says so.
     */
    const worldX = (i - 2) * 6;
    const worldZ = 8;
    phase[i] = worldX * PROP_WIND.phaseX + worldZ * PROP_WIND.phaseZ;
  }
  geo.setAttribute(PROP_WIND_PHASE_ATTRIBUTE, new THREE.InstancedBufferAttribute(phase, 1));
  addInstanceState(geo, [1, 1, 0, 0], [1, 1, 1], PROP_INSTANCES);
  return geo;
}

const structureGeo = structureGeometry();
const unitGeo = unitGeometry();
const propGeo = propGeometry();

function placeRow(
  mesh: THREE.InstancedMesh, count: number, y: number, z: number, spacing: number, yaw: number,
): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    // A per-instance YAW, which is the whole reason the displacements had to
    // stay in model space: a world-space sway or swing shows up here as a row
    // of props leaning together instead of each along its own axis.
    q.setFromEuler(new THREE.Euler(0, yaw * (i + 1), 0));
    p.set((i - (count - 1) / 2) * spacing, y, z);
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
  unit: THREE.Material;
  prop: THREE.Material;
}

function buildScene(mats: MaterialSet): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161c);

  /*
   * HemisphereLight only, per the project's standing rule — a flat ambient
   * kills the shadow tint the whole grade depends on, and using one here would
   * make this page lie about materials that are always read under a hemisphere.
   */
  scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x4a4436, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-60, 90, 40);
  scene.add(sun);

  const structures = new THREE.InstancedMesh(structureGeo, mats.structure, STRUCTURE_INSTANCES);
  placeRow(structures, STRUCTURE_INSTANCES, 3, -8, 9, 0.6);
  scene.add(structures);

  const units = new THREE.InstancedMesh(unitGeo, mats.unit, UNIT_INSTANCES);
  placeRow(units, UNIT_INSTANCES, 2.2, 2, 6, 0.9);
  scene.add(units);

  const props = new THREE.InstancedMesh(propGeo, mats.prop, PROP_INSTANCES);
  placeRow(props, PROP_INSTANCES, 2.6, 12, 6, 1.3);
  scene.add(props);

  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.5, 400);
  camera.position.set(2, 16, 42);
  camera.lookAt(0, 3, 0);
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

/** Both renderers get the same colour posture, or the diff measures that instead. */
function configure(r: THREE.WebGLRenderer | WebGPURenderer): void {
  r.setPixelRatio(1);
  r.setSize(WIDTH, HEIGHT, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
}

const greeble = new GreebleFactory();
/* 256 rather than the shipping 512: this page compares SHADERS, and a
 * quarter of the texels is a quarter of the generation time for a question
 * neither arm asks differently. */
const atlas = greeble.atlas(specForPalette('cmp.allies', RA3_ALLIED_STRUCTURE, 256, 4242));

function glslSet(): MaterialSet {
  const props = createPropMaterial();
  props.setTime(FROZEN_TIME);
  const structure = createStructureMaterial(atlas, 'cmp.structure');
  const unit = createUnitMaterial(atlas, 'cmp.unit');
  structure.dithering = DITHER;
  unit.dithering = DITHER;
  props.material.dithering = DITHER;
  return { structure, unit, prop: props.material };
}

function tslSet(): MaterialSet {
  const props = createPropNodeMaterials();
  props.setTime(FROZEN_TIME);
  const structure = createStructureNodeMaterial(atlas, 'cmp.structure.node');
  const unit = createUnitNodeMaterial(atlas, 'cmp.unit.node');
  structure.dithering = DITHER;
  unit.dithering = DITHER;
  props.material.dithering = DITHER;
  return { structure, unit, prop: props.material };
}

/**
 * THE LIGHTING-MODEL FLOOR, and the row without which no other number here can
 * be read.
 *
 * `WebGLRenderer` and `WebGPURenderer` do not share a lighting implementation,
 * and the difference between them is not this port's doing. One
 * `MeshPhysicalMaterial` and one `MeshPhysicalNodeMaterial` over the same
 * geometry, the same lights and the same colour posture, with no custom shader
 * on either side, measures exactly that difference. Whatever `stock` reports is
 * the floor the two TSL arms are allowed to sit at.
 */
function stockWebGLSet(): MaterialSet {
  const make = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({
    color: 0x8a8a8a, roughness: 0.52, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.38,
  });
  return { structure: make(), unit: make(), prop: make() };
}

function stockNodeSet(): MaterialSet {
  const make = (): MeshPhysicalNodeMaterial => {
    const m = new MeshPhysicalNodeMaterial();
    m.color = new THREE.Color(0x8a8a8a);
    m.roughness = 0.52;
    m.metalness = 0;
    m.clearcoat = 0.3;
    m.clearcoatRoughness = 0.38;
    return m;
  };
  return { structure: make(), unit: make(), prop: make() };
}

function runWebGL(arm: Arm, mats: MaterialSet): ArmReport {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(arm), antialias: false, preserveDrawingBuffer: true,
  });
  configure(renderer);
  const { scene, camera } = buildScene(mats);
  const t0 = performance.now();
  renderer.render(scene, camera);
  return { arm, backend: 'webgl', ms: performance.now() - t0 };
}

async function runNode(arm: Arm, mats: MaterialSet, forceWebGL: boolean): Promise<ArmReport> {
  const renderer = new WebGPURenderer({ canvas: canvasFor(arm), antialias: false, forceWebGL });
  configure(renderer);
  await renderer.init();
  const { scene, camera } = buildScene(mats);
  const t0 = performance.now();
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  /*
   * `navigator.gpu` and a real adapter are BOTH true when three has silently
   * fallen back to WebGL2, so neither is evidence. This is.
   */
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl2-fallback';
  return { arm, backend, ms };
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
    gaitUniforms.uGaitSwing.value = 0.55;

    arms.push(runWebGL('glsl-webgl', glslSet()));
    arms.push(await runNode('tsl-webgpu', tslSet(), false));
    arms.push(await runNode('tsl-webgl2', tslSet(), true));
    /*
     * THE CONTROL THAT MAKES THE OTHER THREE MEAN SOMETHING. The shipping GLSL
     * materials, handed to `WebGPURenderer`. `onBeforeCompile` fails SILENTLY on
     * that renderer — no warning, no error — so this arm should differ from the
     * reference by a LOT. If it does not, the diff instrument is dead and every
     * other number on this page is worthless.
     */
    arms.push(await runNode('glsl-webgpu', glslSet(), false));
    arms.push(runWebGL('stock-webgl', stockWebGLSet()));
    arms.push(await runNode('stock-webgpu', stockNodeSet(), false));
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }
})();

window.__SDC = { ready, arms, error, warnings };

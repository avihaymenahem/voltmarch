/**
 * ============================================================================
 * VOLTMARCH — tools/road-node-compare/page.ts
 * ============================================================================
 * THE PAGE HALF of the Stage D2 visual proof — the three road marking shaders.
 * Driven by `tools/road-node-compare.mjs`; the port and browser rules are that
 * file's and are not repeated here.
 *
 * WHY A BROWSER AT ALL, WHEN `tests/road-node-material.spec.ts` ALREADY BUILDS
 * BOTH BACKENDS. Because three stages of this migration each found a different
 * way for a broken node port to pass every offline gate, and the worst of them
 * compiled clean on both backends and shipped two varyings as (0,0):
 *
 *   Stage D  `.setLayout()` on a body that reads module scope generates valid
 *            WGSL and is REFUSED BY CHROME. `WGSLNodeBuilder.build()` generates
 *            a module; nothing in Node compiles one.
 *   Stage E  `varying()` around a module-scope `toVar` assigns where the node
 *            RESOLVES. Both varyings shipped as (0,0) and all 28 tests passed.
 *
 * Offline generation is necessary and NOT sufficient. This page is the sufficient
 * half: a real device, a real pipeline, and a real frame.
 *
 * WHAT IT DRAWS, AND WHY IT IS A SYNTHETIC ROAD RATHER THAN A REAL ONE.
 * `RoadNetwork.generate()` needs a `Terrain`, a seed, a decal field and 17-49k
 * triangles of routing, and none of that is under test — the question is whether
 * ONE MATERIAL paints the same stripes. So the geometry is three flat strips
 * carrying hand-authored `aRoad` / `aKerb` / `aPave` channels, chosen to put
 * EVERY branch of the shaders on screen at once:
 *
 *   u  -6.8 .. +6.8   a four-lane arterial, so `lanes >= 4` fires and the
 *                     divider dashes and the STRAIGHT arrow are drawn
 *   v      0 .. 64    ten dash periods of 5.8 m
 *   dEnd  -4 .. 30    NEGATIVE at one end (inside a junction pad, everything
 *                     suppressed), through the crosswalk band (3.2-7.8 m), the
 *                     stop bar (9.3-9.6 m) and the arrow box (11.0-16.4 m), out
 *                     to open road
 *   kerb  paint 0/1/2 concrete, red corner arc, yellow crossing dashes; profile
 *                     sweeps the face, the top edge and the top face
 *   pave  outerFrac   0 .. 1, so the soldier course appears at its own edge
 *
 * Zeroed channels would produce two identical pictures out of two shaders that
 * agree about nothing.
 *
 * THE SUN IS OVERHEAD AND THE CAMERA IS NEAR-TOP-DOWN. This page is about
 * ALBEDO — where the paint is — and a grazing key would trade that for a
 * specular argument the roughness lerp is only a small part of.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import {
  ROAD_ATTRIBUTE_NAMES, ROAD_SURFACE_KINDS, type RoadSurfaceKind,
} from '../../apps/game/src/world/road-markings';
import { createRoadNodeMaterials } from '../../apps/game/src/world/RoadNodeMaterial';
import { createRoadGlslMaterials } from '../../apps/game/src/world/Roads';
import { ROAD_KERB_HEIGHT, ROAD_KERB_TOP, ROAD_PAVEMENT_WIDTH } from '../../apps/game/src/core/config';

const WIDTH = 640;
const HEIGHT = 480;

type Arm = 'glsl-webgl' | 'tsl-webgpu' | 'tsl-webgl2' | 'glsl-webgpu';

interface ArmReport { arm: Arm; backend: string; ms: number }

declare global {
  interface Window {
    __RNC: {
      ready: Promise<void>;
      arms: ArmReport[];
      error: string | null;
      warnings: string[];
    };
  }
}

const params = new URLSearchParams(location.search);
const DITHER = (params.get('dither') ?? 'on') !== 'off';

/* ==========================================================================
 * 1. THE THREE STRIPS
 * ========================================================================== */

/** A four-lane arterial: `ROAD_LANE_WIDTH` 3.4 x 4 / 2 = 6.8 m each side. */
const HALF_WIDTH = 6.8;
const ALONG_METRES = 64;
/** Metres of `v` per row of the strip. Fine enough for the dashes to be smooth. */
const ROW_METRES = 0.5;

/**
 * One flat strip in the XZ plane, `spanU` metres across and `ALONG_METRES` long,
 * with a vec4 channel filled per vertex by the caller.
 *
 * FLAT, and the whole road network is too: `ROAD_CONFORM_METRES` drapes the
 * surface over the heightfield, but every quad is still horizontal in its own
 * neighbourhood and the shaders never read Y. Draping is geometry and this page
 * is about materials.
 */
function strip(
  name: string, attrName: string, spanU: number, xOffset: number, columns: number,
  fill: (u: number, v: number, out: Float32Array, at: number) => void,
): THREE.BufferGeometry {
  const rows = Math.round(ALONG_METRES / ROW_METRES) + 1;
  const verts = rows * columns;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const ext = new Float32Array(verts * 4);
  const idx: number[] = [];

  for (let r = 0; r < rows; r++) {
    const v = r * ROW_METRES;
    for (let c = 0; c < columns; c++) {
      const t = columns === 1 ? 0 : c / (columns - 1);
      const u = (t - 0.5) * spanU;
      const i = r * columns + c;
      pos[i * 3] = xOffset + u;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = v - ALONG_METRES / 2;
      nrm[i * 3 + 1] = 1;
      // The mesh builders divide their UVs by the tile size; the same rule here
      // or the surface texture tiles at the square of its intended period.
      uv[i * 2] = v / 6.0;
      uv[i * 2 + 1] = (u + spanU / 2) / 6.0;
      fill(u, v, ext, i * 4);
    }
  }
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      const a = r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute(attrName, new THREE.Float32BufferAttribute(ext, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.name = name;
  return g;
}

/**
 * `dEnd` runs from -4 m (inside a junction pad, where the shader suppresses
 * everything) up through the crosswalk, the stop bar and the arrow box.
 *
 * It is a function of `v` and NOT of the row index, so the bands land at their
 * real metre positions and a stripe drawn at the wrong distance is visible as
 * one rather than hidden by a rescale.
 */
function dEndAt(v: number): number {
  return v - 4;
}

const GEOMETRIES: Readonly<Record<RoadSurfaceKind, THREE.BufferGeometry>> = {
  // (u, v, halfWidth, dEnd). 61 columns puts a vertex every 0.22 m across, which
  // is finer than the 0.12 m stripes are wide — the shader draws them
  // analytically from `u`, so the tessellation only has to carry the varying.
  carriageway: strip(
    'cmp.carriageway', ROAD_ATTRIBUTE_NAMES.carriageway, HALF_WIDTH * 2, 0, 61,
    (u, v, out, at) => {
      out[at] = u; out[at + 1] = v; out[at + 2] = HALF_WIDTH; out[at + 3] = dEndAt(v);
    },
  ),
  // (along, paint, profile, -). The profile sweeps 0 -> face -> top edge -> top
  // face across the strip, so one quad shows the red band, the bevel highlight
  // and the yellow dashes together. `paint` cycles 0/1/2 in 21 m blocks.
  kerb: strip(
    'cmp.kerb', ROAD_ATTRIBUTE_NAMES.kerb, 1.2, HALF_WIDTH + 1.4, 13,
    (u, v, out, at) => {
      const t = (u + 0.6) / 1.2;
      out[at] = v;
      out[at + 1] = Math.floor(v / 21.4) % 3;
      out[at + 2] = t * (ROAD_KERB_HEIGHT + ROAD_KERB_TOP);
      out[at + 3] = 0;
    },
  ),
  // (across, along, outerFrac, -). `outerFrac` 0 at the kerb, 1 at the outer
  // edge, so the soldier course lands where the shader says it should.
  pavement: strip(
    'cmp.pavement', ROAD_ATTRIBUTE_NAMES.pavement, ROAD_PAVEMENT_WIDTH,
    HALF_WIDTH + 2.2 + ROAD_PAVEMENT_WIDTH / 2, 17,
    (u, v, out, at) => {
      const t = (u + ROAD_PAVEMENT_WIDTH / 2) / ROAD_PAVEMENT_WIDTH;
      out[at] = u; out[at + 1] = v; out[at + 2] = t; out[at + 3] = 0;
    },
  ),
};

/* ==========================================================================
 * 2. THE SCENE
 * ========================================================================== */

type MaterialSet = Readonly<Record<RoadSurfaceKind, THREE.Material>>;

function buildScene(mats: MaterialSet): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161c);

  // HemisphereLight only, per the project's standing rule.
  scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x4a4436, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  // Near-overhead: this page grades ALBEDO, and a grazing key would trade the
  // paint for a specular argument.
  sun.position.set(-14, 90, 18);
  scene.add(sun);

  for (const kind of ROAD_SURFACE_KINDS) {
    const mesh = new THREE.Mesh(GEOMETRIES[kind], mats[kind]);
    mesh.name = kind;
    // The kerb stands 0.17 m proud, exactly as the network builds it.
    if (kind === 'kerb') mesh.position.y = 0.001;
    if (kind === 'pavement') mesh.position.y = ROAD_KERB_HEIGHT;
    scene.add(mesh);
  }

  const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.5, 400);
  // Down the road at a shallow tilt, so the length of `dEnd` is on screen.
  camera.position.set(2, 26, 34);
  camera.lookAt(2, 0, -2);
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

/** Anisotropy is pushed in on both paths; 4 is what a mid tier reports. */
const ANISOTROPY = 4;

function glslSet(): MaterialSet {
  const set = createRoadGlslMaterials(ANISOTROPY);
  for (const kind of ROAD_SURFACE_KINDS) set.materials[kind].dithering = DITHER;
  return set.materials;
}

function tslSet(): MaterialSet {
  const set = createRoadNodeMaterials(ANISOTROPY);
  for (const kind of ROAD_SURFACE_KINDS) set.materials[kind].dithering = DITHER;
  return set.materials;
}

function runWebGL(arm: Arm, mats: MaterialSet): ArmReport {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(arm), antialias: false, preserveDrawingBuffer: true,
  });
  configure(renderer);
  renderer.capabilities.getMaxAnisotropy();
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
 * 4. THE RUN
 * ========================================================================== */

const arms: ArmReport[] = [];
const warnings: string[] = [];
let error: string | null = null;

const realWarn = console.warn.bind(console);
console.warn = (...a: unknown[]): void => { warnings.push(a.map(String).join(' ')); realWarn(...a); };

const ready = (async () => {
  try {
    arms.push(runWebGL('glsl-webgl', glslSet()));
    arms.push(await runNode('tsl-webgpu', tslSet(), false));
    arms.push(await runNode('tsl-webgl2', tslSet(), true));
    /*
     * THE CONTROL THAT MAKES THE OTHER TWO MEAN SOMETHING. The shipping GLSL
     * materials, handed to `WebGPURenderer`, where `onBeforeCompile` fails
     * SILENTLY — no warning, no error. This arm should therefore show bare
     * asphalt with no markings at all. If it does not differ substantially from
     * the reference, the diff instrument is dead and no other number here counts.
     */
    arms.push(await runNode('glsl-webgpu', glslSet(), false));
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }
})();

window.__RNC = {
  ready,
  get arms() { return arms; },
  get error() { return error; },
  get warnings() { return warnings; },
};

/* Referenced so the type import is not elided by the bundler. */
export type { MeshStandardNodeMaterial };

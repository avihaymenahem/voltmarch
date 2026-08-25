/**
 * VOLTMARCH — src/render/scene.ts
 * =============================================================================
 * The scene, the lighting rig, the atmosphere, and the procedural environment
 * probe. Everything here is driven by RENDER_CONFIG (see renderer.ts) and
 * re-reads itself on `configureRender()`.
 *
 * WHAT LIVES HERE
 * ---------------
 *  - THREE.Scene + the LAYERS / RENDER_ORDER bands every module must use.
 *  - A real procedural sky: zenith/horizon/ground gradient, a physically sized
 *    sun disk, a horizon haze band, and a subtle Rayleigh-ish tint toward the
 *    sun. It is a shader on an inside-out sphere, not a clear colour — the
 *    difference between "a game" and "a WebGL demo" is largely this.
 *  - A DirectionalLight sun whose orthographic shadow frustum is REFITTED EVERY
 *    FRAME to the visible ground quad and then TEXEL-SNAPPED. Without the snap,
 *    shadow edges crawl and shimmer during camera pan, which reads as cheap
 *    instantly.
 *  - HemisphereLight fill (cool sky above, warm bounce below) so nothing is
 *    ever lit from exactly one direction.
 *  - Linear distance fog matched to the art bible, plus aerial-perspective
 *    blending of the fog colour toward the sky so distant terrain sits in air
 *    instead of behind a grey sheet.
 *  - An environment map baked with PMREMGenerator from the sky dome itself. No
 *    external .hdr file exists or is needed; the IBL always matches the sky,
 *    including after a mood change, because we re-bake on sun/sky edits.
 *  - An optional placeholder ground plane (procedural canvas albedo + normal)
 *    so the very first frame of `npm run dev` is a lit battlefield rather than
 *    a void. TerrainModule turns it off.
 */

import * as THREE from 'three';
// The two terrain extremes the shadow depth slab is fitted around. Imported
// rather than copied: `TERRAIN_SEA_FLOOR`'s own comment already says "do not
// deepen this without re-checking that pad", and a pad that reads the constant
// is the only version of that sentence a compiler can enforce.
import { TERRAIN_MAX_HEIGHT, TERRAIN_SEA_FLOOR } from '../core/config';
import {
  RENDER_CONFIG,
  onConfigChanged,
  touched,
  srgb,
  srgbVec3,
  sunDirection,
  type RendererHandle,
} from './renderer';
import { nodePath } from './gpu-path';

/* ========================================================================== */
/* Layers and render-order bands                                              */
/* ========================================================================== */

/**
 * Camera layers. Layer 0 is the default "everything" layer.
 * The shadow camera, the env probe and the minimap all filter by these.
 */
export const LAYERS = {
  DEFAULT: 0,
  TERRAIN: 1,
  UNITS: 2,
  BUILDINGS: 3,
  EFFECTS: 4,
  OVERLAY: 5,
  /** Sky dome — excluded from shadow casting and from the reflection RT. */
  SKY: 6,
  /** Editor/debug gizmos, never in a screenshot shot. */
  DEBUG: 7,
} as const;

/**
 * renderOrder bands. NO module writes a raw integer — import from here so the
 * transparency sort order is one decision in one place.
 */
export const RENDER_ORDER = {
  SKY: -1000,
  TERRAIN: 0,
  DECALS: 100,
  OPAQUE: 200,
  WATER: 300,
  PARTICLES: 1000,
  TRAILS: 1100,
  OVERLAY: 2000,
  SHROUD: 3000,
} as const;

/* ========================================================================== */
/* Sky material                                                               */
/* ========================================================================== */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  // Object-space position of the dome doubles as the view direction.
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;

varying vec3 vDir;

uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGround;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunSize;      // cos of half-angle
uniform float uSunIntensity;
uniform float uHazeWidth;    // in "up" units, ~sin(deg)
uniform float uExposure;

// Cheap ordered dither to kill gradient banding on an 8-bit backbuffer.
float dither(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;

  // --- vertical gradient ---------------------------------------------------
  // Above the horizon: horizon -> zenith with a curved ramp so most of the
  // visible sky (which is near the horizon at a 52-degree camera) is rich.
  float t = clamp(up, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.55));

  // Below the horizon: fade to the ground bounce colour.
  float b = clamp(-up / 0.35, 0.0, 1.0);
  vec3 col = mix(sky, uGround, smoothstep(0.0, 1.0, b));

  // --- horizon haze band ---------------------------------------------------
  float haze = exp(-abs(up) / max(uHazeWidth, 1e-3));
  col = mix(col, uHorizon * 1.06, haze * 0.55);

  // --- forward scattering toward the sun -----------------------------------
  float cosSun = dot(d, uSunDir);
  float glow = pow(max(cosSun, 0.0), 8.0);
  col += uSunColor * glow * 0.16;
  // Wide, low-frequency warm wash near the sun's azimuth at the horizon.
  col += uSunColor * pow(max(cosSun, 0.0), 2.0) * haze * 0.25;

  // --- the sun disk itself -------------------------------------------------
  float disk = smoothstep(uSunSize, uSunSize + 0.0016, cosSun);
  col += uSunColor * disk * uSunIntensity;

  col *= uExposure;

  // 1/512 dither in linear space; invisible, but removes banding.
  col += (dither(gl_FragCoord.xy) - 0.5) * (1.0 / 512.0);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

interface SkyUniforms {
  uZenith: { value: THREE.Vector3 };
  uHorizon: { value: THREE.Vector3 };
  uGround: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uSunSize: { value: number };
  uSunIntensity: { value: number };
  uHazeWidth: { value: number };
  uExposure: { value: number };
  [key: string]: THREE.IUniform;
}

function createSkyMaterial(): { material: THREE.ShaderMaterial; uniforms: SkyUniforms } {
  const uniforms: SkyUniforms = {
    uZenith: { value: new THREE.Vector3() },
    uHorizon: { value: new THREE.Vector3() },
    uGround: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uSunSize: { value: Math.cos(THREE.MathUtils.degToRad(0.3)) },
    uSunIntensity: { value: 12 },
    uHazeWidth: { value: 0.14 },
    uExposure: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [k: string]: THREE.IUniform },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false, // grading happens in post; sky writes raw HDR
  });
  material.name = 'SkyDome';

  return { material, uniforms };
}

/* ========================================================================== */
/* Procedural placeholder ground                                              */
/* ========================================================================== */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise fbm on a fixed lattice. Used only for the placeholder. */
function makeNoiseField(size: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const lattice = 16;
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();

  const sample = (x: number, y: number, freq: number): number => {
    const fx = x * freq;
    const fy = y * freq;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const wrap = (v: number) => ((v % lattice) + lattice) % lattice;
    const a = grid[wrap(y0) * lattice + wrap(x0)];
    const b = grid[wrap(y0) * lattice + wrap(x0 + 1)];
    const c = grid[wrap(y0 + 1) * lattice + wrap(x0)];
    const d = grid[wrap(y0 + 1) * lattice + wrap(x0 + 1)];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let amp = 0.5;
      let freq = 4;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        sum += sample(u, v, freq) * amp;
        norm += amp;
        amp *= 0.52;
        freq *= 2;
      }
      out[y * size + x] = sum / norm;
    }
  }
  return out;
}

function buildPlaceholderGroundTextures(baseHex: number): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
} {
  const SIZE = 512;
  const height = makeNoiseField(SIZE, 0x5eed);
  const detail = makeNoiseField(SIZE, 0xa17e);

  const base = srgb(baseHex);
  // Deliberately desaturated dirt that reads under the warm sun.
  const dark = base.clone().multiplyScalar(0.62);
  const light = base.clone().lerp(new THREE.Color(0.72, 0.68, 0.58), 0.45);

  const albCanvas = document.createElement('canvas');
  albCanvas.width = albCanvas.height = SIZE;
  const albCtx = albCanvas.getContext('2d')!;
  const albImg = albCtx.createImageData(SIZE, SIZE);

  const rghCanvas = document.createElement('canvas');
  rghCanvas.width = rghCanvas.height = SIZE;
  const rghCtx = rghCanvas.getContext('2d')!;
  const rghImg = rghCtx.createImageData(SIZE, SIZE);

  const tmp = new THREE.Color();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const h = height[i];
    const d = detail[i];
    const t = THREE.MathUtils.clamp(h * 0.75 + d * 0.35, 0, 1);
    tmp.copy(dark).lerp(light, t);
    // speckle
    const speck = (d - 0.5) * 0.10;
    const r = THREE.MathUtils.clamp(tmp.r + speck, 0, 1);
    const g = THREE.MathUtils.clamp(tmp.g + speck, 0, 1);
    const b = THREE.MathUtils.clamp(tmp.b + speck, 0, 1);
    const o = i * 4;
    // canvas is sRGB storage; encode from linear
    albImg.data[o] = Math.round(Math.pow(r, 1 / 2.2) * 255);
    albImg.data[o + 1] = Math.round(Math.pow(g, 1 / 2.2) * 255);
    albImg.data[o + 2] = Math.round(Math.pow(b, 1 / 2.2) * 255);
    albImg.data[o + 3] = 255;

    const rough = THREE.MathUtils.clamp(0.93 - d * 0.14, 0, 1);
    const v = Math.round(rough * 255);
    rghImg.data[o] = v;
    rghImg.data[o + 1] = v;
    rghImg.data[o + 2] = v;
    rghImg.data[o + 3] = 255;
  }
  albCtx.putImageData(albImg, 0, 0);
  rghCtx.putImageData(rghImg, 0, 0);

  // Sobel the height field into a tangent-space normal map.
  const nrmCanvas = document.createElement('canvas');
  nrmCanvas.width = nrmCanvas.height = SIZE;
  const nrmCtx = nrmCanvas.getContext('2d')!;
  const nrmImg = nrmCtx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const STRENGTH = 2.4;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
      const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o = (y * SIZE + x) * 4;
      nrmImg.data[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      nrmImg.data[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      nrmImg.data[o + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      nrmImg.data[o + 3] = 255;
    }
  }
  nrmCtx.putImageData(nrmImg, 0, 0);

  const mk = (canvas: HTMLCanvasElement, srgbSpace: boolean): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = srgbSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  return { albedo: mk(albCanvas, true), normal: mk(nrmCanvas, false), rough: mk(rghCanvas, false) };
}

/* ========================================================================== */
/* SceneRig                                                                   */
/* ========================================================================== */

export interface SceneRig {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  readonly sunDir: THREE.Vector3;
  /** null until the first env bake completes. */
  readonly environment: THREE.Texture | null;

  /**
   * Refit + texel-snap the shadow cascade to whatever the camera can see.
   * Call once per rendered frame BEFORE renderer.render().
   */
  fitShadow(camera: THREE.Camera): void;

  /** Re-read RENDER_CONFIG.sun / .sky and (optionally) re-bake the env probe. */
  refreshLighting(rebakeEnvironment?: boolean): void;

  /** Force an environment probe re-bake. Costs ~4 ms; never call per frame. */
  bakeEnvironment(): void;

  setPlaceholderGroundVisible(v: boolean): void;
  /** Swap the whole scene background/env for a neutral studio look (?shot=). */
  setStudioMode(on: boolean): void;

  dispose(): void;
}

export interface CreateSceneOptions {
  /**
   * The renderer handle, not the renderer.
   *
   * This took a `THREE.WebGLRenderer` and used it for exactly two things: the
   * `PMREMGenerator` constructor and one `setClearColor`. Both differ between
   * backends — three ships a SECOND `PMREMGenerator` in `three/webgpu` that
   * drives a node `Renderer`, and the core one would throw on its first
   * `render()` — so the seam has to be the handle.
   */
  handle: RendererHandle;
  /** Skip the placeholder ground regardless of config. */
  noPlaceholderGround?: boolean;
}

export function createScene(options: CreateSceneOptions): SceneRig {
  const { handle } = options;
  const cfgSun = RENDER_CONFIG.sun;
  const cfgSky = RENDER_CONFIG.sky;
  const cfgFog = RENDER_CONFIG.fog;
  const cfgShadow = RENDER_CONFIG.renderer.shadows;

  const scene = new THREE.Scene();
  scene.name = 'VoltmarchScene';
  scene.matrixWorldAutoUpdate = true;

  /* ---- sky ------------------------------------------------------------- */
  /*
   * THE SKY IS A RAW `ShaderMaterial` AND `ShaderMaterial` IS NOT IN
   * `StandardNodeLibrary`. Under `WebGPURenderer` it does not degrade — it fails
   * `NodeBuilder: Material "ShaderMaterial" is not compatible` and draws through
   * a bare `NodeMaterial`, i.e. the entire background. `render/sky-nodes.ts` is
   * the twin; both publish the same nine `{ value }` slots so `syncSkyUniforms`
   * below is written once.
   */
  const np = nodePath();
  const { material: skyMaterial, uniforms: skyUniforms } =
    np !== null ? np.createSkyMaterial() : createSkyMaterial();
  const skyGeo = new THREE.SphereGeometry(1, 48, 32);
  const sky = new THREE.Mesh(skyGeo, skyMaterial);
  sky.name = 'SkyDome';
  sky.frustumCulled = false;
  sky.renderOrder = RENDER_ORDER.SKY;
  sky.scale.setScalar(RENDER_CONFIG.camera.far * 0.9);
  sky.castShadow = false;
  sky.receiveShadow = false;
  sky.layers.set(LAYERS.SKY);
  sky.layers.enable(LAYERS.DEFAULT);
  // The dome must ride with the camera or panning to the far corner of a 512 m
  // map walks the viewpoint out through the shell.
  sky.onBeforeRender = (_r, _s, cam) => {
    sky.position.setFromMatrixPosition(cam.matrixWorld);
    sky.updateMatrixWorld(true);
  };
  scene.add(sky);

  // A second, small dome sharing the SAME material/uniforms lives in a private
  // scene that PMREMGenerator bakes. Sharing uniforms means the IBL can never
  // drift from the visible sky.
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(skyGeo, skyMaterial);
  envSky.scale.setScalar(50);
  envSky.frustumCulled = false;
  envScene.add(envSky);

  /* ---- fog ------------------------------------------------------------- */
  /**
   * A fog whose `end` is past the far plane cannot darken or desaturate
   * anything, but it still costs a `#include <fog_fragment>` in every single
   * material in the game. More importantly it is a trap: the noon art direction
   * bans aerial perspective outright (bible §1 standing rulings, enforced by
   * scorecard #12 — far-field saturation must be within 0.05 of near-field) and
   * a live `scene.fog` object invites the next agent to "just nudge" it back.
   *
   * So when the art direction asks for no fog, there is NO FOG OBJECT. The
   * threshold is the camera far plane: fog that first bites beyond what the
   * camera can draw is not fog.
   */
  const fogIsMeaningful = (): boolean =>
    cfgFog.end > cfgFog.start + 1 && cfgFog.end < RENDER_CONFIG.camera.far;

  function makeFogColor(out: THREE.Color): THREE.Color {
    // Aerial perspective: nudge the fog colour toward the horizon sky so the
    // distance haze belongs to the same atmosphere as the sky above it.
    return out.copy(srgb(cfgFog.color)).lerp(srgb(cfgSky.horizon), cfgFog.aerialPerspective);
  }

  const fogColor = makeFogColor(new THREE.Color());
  scene.fog = fogIsMeaningful() ? new THREE.Fog(fogColor.getHex(), cfgFog.start, cfgFog.end) : null;
  if (scene.fog) (scene.fog as THREE.Fog).color.copy(fogColor);
  scene.background = null; // the dome IS the background

  /* ---- sun ------------------------------------------------------------- */
  const sunDir = sunDirection(cfgSun.azimuth, cfgSun.elevation);

  const sun = new THREE.DirectionalLight(srgb(cfgSun.color).getHex(), cfgSun.intensity);
  sun.name = 'Sun';
  sun.color.copy(srgb(cfgSun.color));
  sun.castShadow = cfgShadow.enabled;
  sun.position.copy(sunDir).multiplyScalar(200);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const shadow = sun.shadow;
  shadow.mapSize.set(cfgShadow.mapSize, cfgShadow.mapSize);
  shadow.bias = cfgShadow.bias;
  shadow.normalBias = cfgShadow.normalBias;
  shadow.radius = cfgShadow.radius;
  if ('intensity' in shadow) (shadow as any).intensity = cfgShadow.intensity;
  const shadowCam = shadow.camera as THREE.OrthographicCamera;
  // Placeholder bounds only. `fitShadow` overwrites all six of these from the
  // visible ground quad before the first frame is presented, so the numbers
  // here configure nothing — they exist so the camera is well-formed if
  // something reads it before the first fit. (This used to read
  // `cfgShadow.nearExtent`, which said the same thing far less clearly and was
  // the field's only consumer; it is gone from RendererConfig now.)
  shadowCam.near = 1;
  shadowCam.far = 700;
  shadowCam.left = -cfgShadow.farExtent;
  shadowCam.right = cfgShadow.farExtent;
  shadowCam.top = cfgShadow.farExtent;
  shadowCam.bottom = -cfgShadow.farExtent;
  shadowCam.updateProjectionMatrix();

  /* ---- fill ------------------------------------------------------------ */
  const hemi = new THREE.HemisphereLight(
    srgb(cfgSky.hemiSky).getHex(),
    srgb(cfgSky.hemiGround).getHex(),
    cfgSky.hemiSkyIntensity
  );
  hemi.name = 'HemiFill';
  hemi.color.copy(srgb(cfgSky.hemiSky));
  hemi.groundColor.copy(srgb(cfgSky.hemiGround));
  hemi.position.set(0, 60, 0);
  scene.add(hemi);

  // A very dim warm bounce from the ground, aimed up. Cures the "everything is
  // evenly lit" note without costing a shadow map.
  const bounce = new THREE.DirectionalLight(srgb(cfgSky.hemiGround).getHex(), cfgSky.hemiGroundIntensity);
  bounce.name = 'GroundBounce';
  bounce.position.set(-sunDir.x * 60, -40, -sunDir.z * 60);
  bounce.target.position.set(0, 6, 0);
  bounce.castShadow = false;
  scene.add(bounce);
  scene.add(bounce.target);

  /* ---- placeholder ground ---------------------------------------------- */
  let ground: THREE.Mesh | null = null;
  let groundTextures: { albedo: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } | null = null;

  if (RENDER_CONFIG.scene.placeholderGround && !options.noPlaceholderGround) {
    const size = RENDER_CONFIG.scene.placeholderGroundSize;
    groundTextures = buildPlaceholderGroundTextures(RENDER_CONFIG.scene.placeholderGroundColor);
    const repeat = size / 16; // one texture tile every 16 m
    groundTextures.albedo.repeat.set(repeat, repeat);
    groundTextures.normal.repeat.set(repeat, repeat);
    groundTextures.rough.repeat.set(repeat, repeat);

    const mat = new THREE.MeshStandardMaterial({
      map: groundTextures.albedo,
      normalMap: groundTextures.normal,
      roughnessMap: groundTextures.rough,
      roughness: 1.0,
      metalness: 0.0,
      // Matches UNIT_MATERIAL.normalScale: the placeholder must not be the one
      // surface in the game with embossed-rubber relief.
      normalScale: new THREE.Vector2(0.45, 0.45),
      dithering: true,
    });
    mat.name = 'PlaceholderGround';

    // Modest tessellation so the fog/lighting has vertices to interpolate over.
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);
    ground = new THREE.Mesh(geo, mat);
    ground.name = '__placeholderGround';
    ground.position.set(size * 0.5, 0, size * 0.5); // map origin at (0,0)
    ground.receiveShadow = true;
    ground.castShadow = false;
    ground.renderOrder = RENDER_ORDER.TERRAIN;
    ground.layers.set(LAYERS.DEFAULT);
    ground.layers.enable(LAYERS.TERRAIN);
    scene.add(ground);
  }

  /* ---- environment probe ------------------------------------------------ */
  /**
   * Either `THREE.PMREMGenerator` (WebGL) or the node one from `three/webgpu`,
   * reduced to the one method this file calls.
   */
  let pmrem: { fromScene(s: THREE.Scene, sigma: number, near: number, far: number): THREE.RenderTarget; dispose(): void } | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let environment: THREE.Texture | null = null;
  let studio = false;

  function bakeEnvironment(): void {
    if (studio) return;
    try {
      if (!pmrem) {
        if (handle.webgl !== null) {
          const gen = new THREE.PMREMGenerator(handle.webgl);
          gen.compileEquirectangularShader();
          pmrem = gen;
        } else {
          // `compileEquirectangularShader()` has no node counterpart and needs
          // none: it prewarms the equirect path, and this project only ever
          // calls `fromScene`.
          pmrem = np!.createPmrem(handle.node!);
        }
      }
      const prev = envRT;
      envRT = pmrem.fromScene(envScene, 0, 1, 120) as THREE.WebGLRenderTarget;
      environment = envRT.texture;
      scene.environment = environment;
      (scene as any).environmentIntensity = cfgSky.envIntensity;
      prev?.dispose();
    } catch (err) {
      console.warn('[render] environment probe bake failed; falling back to hemi fill only', err);
      environment = null;
      scene.environment = null;
    }
  }

  /* ---- config -> uniforms ---------------------------------------------- */
  const sunColorLinear = new THREE.Vector3();

  function syncSkyUniforms(): void {
    srgbVec3(cfgSky.zenith, skyUniforms.uZenith.value);
    srgbVec3(cfgSky.horizon, skyUniforms.uHorizon.value);
    srgbVec3(cfgSky.ground, skyUniforms.uGround.value);
    srgbVec3(cfgSun.color, sunColorLinear);
    skyUniforms.uSunColor.value.copy(sunColorLinear);
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uSunSize.value = Math.cos(THREE.MathUtils.degToRad(cfgSky.sunDiskSize * 0.5));
    skyUniforms.uSunIntensity.value = cfgSky.sunDiskIntensity;
    skyUniforms.uHazeWidth.value = Math.max(0.01, Math.sin(THREE.MathUtils.degToRad(cfgSky.hazeWidth)));
    // Sky brightness tracks sun intensity so dusk/night moods read immediately.
    skyUniforms.uExposure.value = THREE.MathUtils.clamp(0.35 + cfgSun.intensity * 0.21, 0.15, 2.5);
    sky.scale.setScalar(RENDER_CONFIG.camera.far * 0.9);
  }

  function refreshLighting(rebakeEnvironment = true): void {
    sunDirection(cfgSun.azimuth, cfgSun.elevation, sunDir);

    sun.color.copy(srgb(cfgSun.color));
    sun.intensity = cfgSun.intensity;
    sun.castShadow = cfgShadow.enabled;
    sun.position.copy(sunDir).multiplyScalar(200);

    shadow.bias = cfgShadow.bias;
    shadow.normalBias = cfgShadow.normalBias;
    shadow.radius = cfgShadow.radius;
    if ('intensity' in shadow) (shadow as any).intensity = cfgShadow.intensity;
    if (shadow.mapSize.x !== cfgShadow.mapSize) {
      shadow.mapSize.set(cfgShadow.mapSize, cfgShadow.mapSize);
      shadow.map?.dispose();
      (shadow as any).map = null;
    }

    hemi.color.copy(srgb(cfgSky.hemiSky));
    hemi.groundColor.copy(srgb(cfgSky.hemiGround));
    hemi.intensity = cfgSky.hemiSkyIntensity;

    bounce.color.copy(srgb(cfgSky.hemiGround));
    bounce.intensity = cfgSky.hemiGroundIntensity;
    bounce.position.set(-sunDir.x * 60, -40, -sunDir.z * 60);

    // Fog can appear and disappear across a mood change (noon has none, dusk
    // does), and three recompiles materials when `scene.fog` flips between an
    // object and null — which is correct and is why this is not done per frame.
    if (!studio) {
      const want = fogIsMeaningful();
      if (!want) {
        scene.fog = null;
      } else {
        let f = scene.fog as THREE.Fog | null;
        if (!f || !(f as THREE.Fog).isFog) {
          f = new THREE.Fog(0xffffff, cfgFog.start, cfgFog.end);
          scene.fog = f;
        }
        makeFogColor(f.color);
        f.near = cfgFog.start;
        f.far = cfgFog.end;
      }
    }
    (handle.webgl ?? handle.node!).setClearColor(srgb(cfgSky.horizon), 1);

    syncSkyUniforms();
    (scene as any).environmentIntensity = cfgSky.envIntensity;

    if (rebakeEnvironment) bakeEnvironment();
  }

  syncSkyUniforms();
  bakeEnvironment();

  const unsubscribe = onConfigChanged((changed) => {
    const lighting =
      touched(changed, 'sun') ||
      touched(changed, 'sky') ||
      touched(changed, 'fog') ||
      touched(changed, 'renderer.shadows');
    if (!lighting) return;
    // Only the sky/sun affect the IBL; a shadow-bias tweak must not cost a bake.
    const needsBake = touched(changed, 'sun') || touched(changed, 'sky');
    refreshLighting(needsBake);
  });

  /* ---- shadow fitting --------------------------------------------------- */
  /**
   * Metres the shadow ortho extent is quantised to.
   *
   * Small enough that zoom steps are not a visible jump in shadow softness,
   * large enough that ordinary panning and pitching never cross one — which is
   * the point, because a texel grid that changes size cannot be snapped to.
   */
  const SHADOW_EXTENT_STEP = 16;

  /**
   * Metres the light sits from the plane `dot(p, sunDir) === 0`.
   *
   * It is a plain standoff and nothing else: an orthographic light has no
   * position in any meaningful sense, only a direction and a depth slab, and
   * `near`/`far` below are measured from THIS plane. It used to be the bare
   * literal 250 written twice — once in `sun.position`, once inside the `far`
   * expression — which is precisely how the two came apart.
   */
  const SHADOW_STANDOFF = 250;

  /**
   * Metres above y = 0 that may still cast into the fitted quad.
   *
   * TERRAIN_MAX_HEIGHT (24) of hill, plus the tallest structure in the roster
   * (the Radar, 12 m) standing on top of it, plus `AI_BUILD.airAltitudeMetres`
   * (6) of aircraft over that, plus slack for debris and projectiles.
   *
   * A caster is NOT bounded by the ortho box's x/y: light-space x and y are
   * perpendicular to `sunDir`, so a caster and the shadow it throws share them
   * exactly, and anything whose shadow lands inside the quad is inside the box
   * by construction. Depth is the only axis that has to be widened for it.
   */
  const SHADOW_CASTER_CEILING = TERRAIN_MAX_HEIGHT + 24;

  /**
   * Metres below y = 0 that may still RECEIVE. `TERRAIN_SEA_FLOOR` is -6 and
   * the seabed is a lit, shadow-receiving surface; the rest is slack, matching
   * the 12 m the x/y extent is padded by for the same reason.
   */
  const SHADOW_RECEIVER_FLOOR = -TERRAIN_SEA_FLOOR + 8;

  /**
   * Floor on `sin(elevation)` when converting a height into a depth margin.
   *
   * The conversion is `height / sin(elevation)` and the sun elevation is a
   * configurable mood value (38 deg at noon, lower on other presets). Without a
   * clamp a sunset preset at 3 degrees would ask for a 900 m near margin and
   * put the whole depth budget back where this fix found it.
   */
  const SHADOW_MIN_SIN_ELEVATION = 0.2;

  // Scratch — allocated once, reused forever. Nothing here allocates per frame.
  const _corners: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) _corners.push(new THREE.Vector3());
  const _lightMatrix = new THREE.Matrix4();
  /** Light -> world, kept before the invert so a snapped centre can be unprojected. */
  const _lightToWorld = new THREE.Matrix4();
  const _lightPos = new THREE.Vector3();
  const _center = new THREE.Vector3();
  const _snapped = new THREE.Vector3();
  const _zero = new THREE.Vector3(0, 0, 0);
  const _up = new THREE.Vector3(0, 1, 0);
  const _ndc = new THREE.Vector3();
  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  const _tmp = new THREE.Vector3();
  const NDC_CORNERS: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  /**
   * Project the four screen corners onto the ground plane, take the bound of
   * that quad (clamped to farExtent so a horizon-grazing corner does not blow
   * the cascade out to infinity), then snap the light-space origin to the
   * shadow-texel grid.
   */
  function fitShadow(camera: THREE.Camera): void {
    if (!cfgShadow.enabled) return;

    camera.updateMatrixWorld();
    _rayOrigin.setFromMatrixPosition(camera.matrixWorld);

    const maxR = cfgShadow.farExtent;
    let count = 0;
    _center.set(0, 0, 0);

    for (let i = 0; i < 4; i++) {
      const [nx, ny] = NDC_CORNERS[i];
      _ndc.set(nx, ny, 0.5).unproject(camera as THREE.PerspectiveCamera);
      _rayDir.copy(_ndc).sub(_rayOrigin).normalize();

      let hit: THREE.Vector3;
      if (_rayDir.y < -1e-4) {
        const t = -_rayOrigin.y / _rayDir.y;
        hit = _corners[i].copy(_rayDir).multiplyScalar(Math.min(t, maxR * 2)).add(_rayOrigin);
      } else {
        // Ray points at or above the horizon: clamp to the far extent.
        hit = _corners[i].copy(_rayDir).multiplyScalar(maxR).add(_rayOrigin);
        hit.y = 0;
      }
      // Clamp the quad radius around the camera's ground point.
      _tmp.set(_rayOrigin.x, 0, _rayOrigin.z);
      const dx = hit.x - _tmp.x;
      const dz = hit.z - _tmp.z;
      const d = Math.hypot(dx, dz);
      if (d > maxR) {
        hit.x = _tmp.x + (dx / d) * maxR;
        hit.z = _tmp.z + (dz / d) * maxR;
      }
      hit.y = 0;
      _center.add(hit);
      count++;
    }
    _center.multiplyScalar(1 / count);
    // A little vertical headroom for tall buildings (ConYard 11 m, Radar 12 m,
    // Tesla Coil 9 m) plus airborne debris.
    _corners[4].copy(_center).setY(14);

    /*
     * A STABLE LIGHT BASIS — rotation only, anchored at the world origin.
     *
     * This used to be built from `_center`, which moves with the camera every
     * frame. That makes light space itself slide, so the light-space
     * coordinates of a FIXED world point change continuously, and quantising a
     * centre inside a sliding space quantises nothing. The snap below ran, and
     * the shadow map crawled anyway.
     *
     * The sun direction is constant, so a basis built from it alone is
     * constant, and a world position quantised in it lands on the same texel
     * every frame. That is what makes the snap mean something.
     */
    _lightPos.copy(sunDir).multiplyScalar(SHADOW_STANDOFF);
    _lightMatrix.lookAt(_lightPos, _zero, _up);
    _lightMatrix.setPosition(0, 0, 0);
    _lightToWorld.copy(_lightMatrix);   // rotation only; needed to unsnap
    _lightMatrix.invert();              // world -> light

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 5; i++) {
      _tmp.copy(_corners[i]).applyMatrix4(_lightMatrix);
      if (_tmp.x < minX) minX = _tmp.x;
      if (_tmp.x > maxX) maxX = _tmp.x;
      if (_tmp.y < minY) minY = _tmp.y;
      if (_tmp.y > maxY) maxY = _tmp.y;
      if (_tmp.z < minZ) minZ = _tmp.z;
      if (_tmp.z > maxZ) maxZ = _tmp.z;
    }

    /*
     * Square + QUANTISE the extent.
     *
     * Squaring already stopped a camera ROTATION from changing the shadow
     * resolution. It did nothing about position and pitch, which change the
     * measured extent continuously — so `texelWorld` changed every frame, and
     * a snap onto a grid whose spacing changes every frame is not a snap.
     *
     * Rounding the extent up to a fixed step holds the texel grid still for
     * every camera move inside that step, which is all of panning and most of
     * pitching. Resolution now changes in visible increments while zooming
     * rather than continuously, and that is the whole trade: a step you can
     * see once beats a shimmer you see always.
     */
    const measured = Math.max(maxX - minX, maxY - minY) * 0.5 + 12;
    const padded = Math.ceil(measured / SHADOW_EXTENT_STEP) * SHADOW_EXTENT_STEP;
    const texelWorld = (padded * 2) / cfgShadow.mapSize;

    // Texel snap, now in a basis that does not move. THIS is what stops the
    // crawl during pan — and it only works because of the two fixes above.
    const cx = Math.round((minX + maxX) * 0.5 / texelWorld) * texelWorld;
    const cy = Math.round((minY + maxY) * 0.5 / texelWorld) * texelWorld;
    // Depth is deliberately NOT carried into the light position. Sliding the
    // light along its own forward axis cannot change texel alignment, but it
    // does leave `sun.position` drifting a fraction of a millimetre per frame,
    // which makes "is the shadow rig stable?" impossible to assert exactly. The
    // depth SLAB moves instead — see near/far below, which is the fix for the
    // bug that pinning this created.
    const cz = 0;

    shadowCam.left = -padded;
    shadowCam.right = padded;
    shadowCam.bottom = -padded;
    shadowCam.top = padded;

    /*
     * THE DEPTH SLAB, RE-CENTRED ON THE CONTENT — AND WHY IT HAD TO BE.
     *
     * `cz` is pinned to 0, so the light sits on the plane
     * `dot(p, sunDir) === SHADOW_STANDOFF` and a point's depth in the shadow
     * view is exactly `SHADOW_STANDOFF - dot(p, sunDir)`. Light-space z IS
     * `dot(p, sunDir)`, so `minZ`/`maxZ` above already measure the fitted
     * quad's depth extent and nothing new has to be computed for this.
     *
     * `near`/`far` used to be `1` and `250 + (maxZ - minZ) + 60`, which is a
     * slab centred on the WORLD ORIGIN rather than on the quad. Rearranged,
     * that far plane covers the quad only while `maxZ >= -60` — and across a
     * 512 m map with the noon sun at azimuth 312 / elevation 38,
     * `dot(p, sunDir)` sweeps about -300..+270.
     *
     * MEASURED, by re-simulating this whole function over a 4 m focus grid at
     * 8 camera yaws (16 384 fits per distance). The old slab lost the sun
     * shadow ENTIRELY at 22.5% / 12.1% / 1.1% of focus positions at camera
     * distance 30 / 62 / 140, and lost part of it at 31.5% / 28.0% / 22.6%. The
     * new one loses NOTHING at any of the three, which is not luck: the quad's
     * depth extent IS [STANDOFF - maxZ, STANDOFF - minZ], so containing it is
     * an identity rather than a fit. The concrete case is the Sunder Atoll
     * island at (394, 122) at distance 62 — quad depth 388.9..462.6 against an
     * old far plane of 383.7, now inside a 304..496 slab. Every one of the
     * thirteen `npm run shots` fixtures sits at depth ~260, inside the old
     * working band, so the harness could never have caught this.
     *
     * WHY NOT JUST RAISE `far` TO 700. Because three applies `shadowBias` to a
     * post-divide [0,1] coordinate, so the bias is a FRACTION OF (far - near):
     * at the shipped -0.0005 the old 341/376/460 m mean slabs were already
     * detaching contact shadows by 0.17-0.23 m. A wider slab buys coverage by
     * making peter-panning worse. Re-centring AND tightening does both jobs at
     * once — mean slab 341 / 376 / 460 m becomes 149 / 184 / 268 m, so
     * depth-range over content goes 10.9x / 5.8x / 3.1x to 4.8x / 2.8x / 1.8x
     * and the ground detachment 0.17-0.23 m to 0.07-0.13 m.
     *
     * That is a SMALLER bias in metres, which is the trade being taken: less
     * peter-panning, less headroom against acne. If acne ever shows up on a
     * steep sunward slope, `RENDER_CONFIG.renderer.shadows.bias` is the knob —
     * it is a fraction of this slab, so it now buys about half the push it did.
     *
     * WHY THE MARGINS ARE HEIGHT / sin(elevation), NOT HEIGHT. A caster `h`
     * above the plane whose shadow lands inside the quad lies `h / sin(el)`
     * further along the sun ray than that shadow, and it is the ray distance,
     * not the height, that the near plane has to clear. `sinEl` comes from the
     * live `sunDir` so a mood change re-derives it instead of inheriting a
     * constant fitted to noon.
     *
     * TEXEL SNAPPING IS UNTOUCHED. `sun.position` is not a term in any of this;
     * only the projection's depth range moves, and the projection's x/y — the
     * only thing texel alignment depends on — is quantised exactly as before.
     * The slab is floored/ceiled onto SHADOW_EXTENT_STEP so it can only ever
     * widen, never clip, and so it holds still for every camera move inside one
     * step: an unquantised slab would wobble `far - near` every frame, and with
     * it the metric size of the bias, which is peter-panning that breathes.
     */
    const sinEl = Math.max(SHADOW_MIN_SIN_ELEVATION, sunDir.y);
    const nearRaw = SHADOW_STANDOFF - maxZ - SHADOW_CASTER_CEILING / sinEl;
    const farRaw = SHADOW_STANDOFF - minZ + SHADOW_RECEIVER_FLOOR / sinEl;
    // An ORTHOGRAPHIC near plane may legitimately be negative: the light is a
    // plane, not a point, and there is no perspective divide to blow up. Do not
    // "fix" this by clamping to a positive number — that reintroduces the clip
    // this whole block exists to remove, on the half of the map where
    // `dot(p, sunDir)` is largest.
    shadowCam.near = Math.floor(nearRaw / SHADOW_EXTENT_STEP) * SHADOW_EXTENT_STEP;
    shadowCam.far = Math.ceil(farRaw / SHADOW_EXTENT_STEP) * SHADOW_EXTENT_STEP;
    shadowCam.updateProjectionMatrix();

    /*
     * Place the LIGHT at the snapped centre rather than offsetting the ortho
     * box around a moving light. Three.js derives the shadow view matrix from
     * `sun.position` and `sun.target`, so an unsnapped light position would
     * reintroduce exactly the sub-texel drift the snap just removed — the ortho
     * bounds are therefore symmetric and all the quantisation lives here.
     */
    _snapped.set(cx, cy, cz).applyMatrix4(_lightToWorld);
    sun.target.position.copy(_snapped);
    sun.position.copy(_snapped).addScaledVector(sunDir, SHADOW_STANDOFF);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  /* ---- studio mode (screenshot harness) --------------------------------- */
  let savedFog: THREE.Fog | THREE.FogExp2 | null = null;
  function setStudioMode(on: boolean): void {
    if (on === studio) return;
    studio = on;
    if (on) {
      savedFog = scene.fog;
      scene.fog = null;
      sky.visible = false;
      scene.background = new THREE.Color(0x1a1d21);
      if (ground) ground.visible = false;
    } else {
      scene.fog = savedFog;
      sky.visible = true;
      scene.background = null;
      if (ground) ground.visible = RENDER_CONFIG.scene.placeholderGround;
      bakeEnvironment();
    }
  }

  const rig: SceneRig = {
    scene,
    sun,
    hemi,
    sky,
    sunDir,
    get environment() {
      return environment;
    },
    fitShadow,
    refreshLighting,
    bakeEnvironment,
    setPlaceholderGroundVisible(v: boolean) {
      RENDER_CONFIG.scene.placeholderGround = v;
      if (ground) ground.visible = v;
    },
    setStudioMode,
    dispose() {
      unsubscribe();
      scene.remove(sky);
      envScene.remove(envSky);
      skyGeo.dispose();
      skyMaterial.dispose();
      if (ground) {
        scene.remove(ground);
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
      }
      groundTextures?.albedo.dispose();
      groundTextures?.normal.dispose();
      groundTextures?.rough.dispose();
      shadow.map?.dispose();
      envRT?.dispose();
      pmrem?.dispose();
      scene.environment = null;
    },
  };

  return rig;
}

/**
 * ============================================================================
 * VOLTMARCH — src/render/FogOfWar.ts
 * ============================================================================
 * THE SHROUD. One 128x128 R8 texture and one draped carpet — that is the whole
 * renderer.
 *
 * WHY A CARPET AND NOT A POST PASS
 * --------------------------------
 * A screen-space shroud needs the depth buffer to reconstruct which cell a
 * pixel belongs to. The post chain in `render/post.ts` is owned elsewhere and
 * carries no depth-aware slot, so instead the shroud is a mesh: a 129x129 grid
 * draped over the terrain heightfield, one draw call, 33k triangles, drawn last
 * at `RENDER_ORDER.SHROUD`.
 *
 * THE SPLIT: THE CARPET OWNS THE GROUND, EVERYTHING ELSE TINTS ITSELF
 * ------------------------------------------------------------------
 * This file used to draw the carpet with `depthTest: false` and called that
 * "not a shortcut, it is the identity" — the argument being that RA2 and RA3
 * composite the shroud as a layer OVER the world, so a structure inside the fog
 * is swallowed rather than poking through a hole in the ground.
 *
 * The goal was right; the mechanism was not. Because the carpet also occupies
 * the screen pixels of the ground BEHIND a unit, it dimmed live units standing
 * in FRONT of shrouded ground — measured over 3,600 frames at 0.021 mean alpha
 * over infantry heads and 0.060 over vehicles, worst for the TALLEST units,
 * whose heads sample furthest into the fog.
 *
 * So the fog is no longer a screen-space layer. It is a property of a world XZ,
 * published as `shroudUniforms` in §1b, and anything drawing above the ground
 * plane samples it and tints itself with the carpet's own formula. A remembered
 * structure therefore keeps exactly the tint it had before — same numbers,
 * different surface — while a live unit samples its own visible cell and takes
 * no tint at all.
 *
 * That split is also what keeps unexplored OCEAN dark (the water surface sits
 * above the carpet, which is draped on the seabed) and unexplored FORESTS dark
 * (scatter props are tall and depth-writing). Both would have silently lit up
 * had the carpet simply been switched to `depthTest: true`.
 *
 * WHY THE TEXTURE IS ONE CHANNEL
 * ------------------------------
 * Three states need two ramps — "unexplored -> remembered" and "remembered ->
 * clear" — but they are never both in flight for the same cell, because
 * exploration only ever increases. So one smoothed scalar carries both:
 *
 *      0.0 ............ 0.5 ............ 1.0
 *   unexplored      remembered        visible
 *
 * The smoothing lives in a `Float32Array` on the CPU and runs every frame; only
 * the 16 KB byte view is re-uploaded, and only while something is animating.
 * That is what makes advancing vision ANIMATE instead of pop, at a cost of
 * roughly 0.1 ms and zero allocations.
 *
 * THE EDGE
 * --------
 * VISUAL_DNA §1.10: "dithered over 1 cell (blue noise), never a hard cut and
 * never a soft gradient". Three things together produce that: the texture's own
 * bilinear filter (a 4 m ramp), a value-noise domain warp of the lookup
 * (`ArtDirection.shroud.noiseScale/noiseSpeed`), and a per-pixel dither. None of
 * them is a blur, and the result has sub-cell resolution.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  MAP_CELLS, MAP_SIZE,
  DEFAULT_ART,
  FOG_MESH_SAMPLES_PER_CELL, FOG_MESH_LIFT,
  FOG_EXPLORED_LEVEL, FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA,
  FOG_REVEAL_SECONDS, FOG_CONCEAL_SECONDS,
  FOG_EDGE_WARP, FOG_DITHER, FOG_UPLOAD_HZ,
  TERRAIN_GRID,
} from '../core/config';
import type { ShroudLook } from '../core/types';
import { hexToLinearRgb } from '../core/math';
import { LAYERS, RENDER_ORDER } from './scene';
import { nodePath, type ShroudMaterialSetLike } from './gpu-path';
import { VIS_EXPLORED, VIS_VISIBLE } from '../sim/Vision';

/* ==========================================================================
 * 1. SHADER
 * ========================================================================== */

const SHROUD_VERT = /* glsl */ `
varying vec2 vFogUv;
varying vec3 vWorld;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  // The carpet spans the map exactly, so world XZ IS the fog UV. No lookup
  // table, no per-vertex attribute beyond position.
  vFogUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SHROUD_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uFog;
uniform vec3  uExploredTint;
uniform vec3  uUnexploredColor;
uniform float uExploredAlpha;
uniform float uUnexploredAlpha;
uniform float uExploredLevel;
uniform float uTexel;
uniform float uWarp;
uniform float uDither;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uTime;

varying vec2 vFogUv;
varying vec3 vWorld;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

/* Value noise. Cheap on purpose: this only has to break a straight edge. */
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* 4x4 ordered Bayer, closed form. VISUAL_DNA I1 asks for ordered dithering on
   every gradient in the game, and an ordered pattern is stable frame to frame —
   white noise here would crawl and read as film grain, which is banned. */
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  /* Domain-warp the lookup so the 4 m texel grid never reads as a polygon.
     TWO octaves, because one is not enough: a single low-frequency warp just
     bends the straight segments instead of dissolving them, and at the default
     zoom one texel is ~90 screen px — the faceting is the first thing a critic
     sees. The slow drift (uNoiseSpeed) is what stops it reading as a decal. */
  vec2 np = vWorld.xz / uNoiseScale + vec2(uTime * uNoiseSpeed);
  vec2 warp = vec2(vnoise(np) - 0.5, vnoise(np + 17.31) - 0.5);
  vec2 np2 = np * 4.0 - vec2(uTime * uNoiseSpeed * 1.7);
  warp += vec2(vnoise(np2) - 0.5, vnoise(np2 + 41.7) - 0.5) * 0.5;
  warp *= uWarp * uTexel * 2.0;

  float v = texture2D(uFog, vFogUv + warp).r;

  /* Sub-cell dither at the frontier. Screen-space on purpose: it keeps its
     size at every zoom, which is what makes it read as a stipple rather than
     as texture noise. */
  v += (bayer4(gl_FragCoord.xy) - 0.46875) * uDither;

  /* Written as 1.0 - smoothstep rather than a reversed-edge smoothstep: GLSL
     leaves edge0 >= edge1 UNDEFINED, and a driver that takes that literally
     would invert the whole shroud. */
  float remembered = 1.0 - smoothstep(0.0, uExploredLevel, v);  // 1 where never seen
  float fogged     = 1.0 - smoothstep(uExploredLevel, 1.0, v);  // 1 where not lit now

  float a = mix(uExploredAlpha * fogged, uUnexploredAlpha, remembered);
  if (a <= 0.003) discard;

  vec3 col = mix(uExploredTint, uUnexploredColor, remembered);
  gl_FragColor = vec4(col, a);
}
`;

/* ==========================================================================
 * 1b. THE SHARED MASK — the same shroud, sampled by everything that stands up
 * ========================================================================== */

/**
 * THE CARPET OWNS THE GROUND PLANE. ANYTHING ABOVE IT TINTS ITSELF.
 *
 * The carpet used to be drawn with `depthTest: false`, which made it composite
 * over the screen pixels of any unit standing in FRONT of shrouded ground.
 * Measured over 3,600 frames of a real match, mean shroud alpha sampled over a
 * unit's head was 0.021 for infantry and 0.060 for vehicles — and it hit TALL
 * units hardest, because their heads sample further into the fog.
 *
 * Depth-testing the carpet fixes that and breaks three other things, two of
 * which nobody had noticed:
 *
 *   1. A remembered structure inside explored-but-unlit territory would pop to
 *      full daylight instead of sitting under the shroud tint.
 *   2. Unexplored OCEAN would render as bright daylight water — the carpet is
 *      draped on the seabed (`heightAt` + `FOG_MESH_LIFT`) while the water
 *      surface sits at `WATER_LEVEL`, depth-writing, in an earlier render band.
 *   3. Tall scatter props would poke through: a forest inside the unexplored
 *      black would stay lit.
 *
 * THERE IS A FOURTH AND IT SHIPPED. The three above are about things standing
 * ABOVE the ground. The fourth is the GROUND ITSELF: a carpet sampled every 4 m
 * interpolates linearly across a terrace, which is a near-vertical step inside
 * one span, so it cuts a diagonal ramp through the face and sits BELOW the
 * terrain on the high side. Depth-tested, the terrain wins — measured at
 * **5.0-7.0% of every map, by up to 6.59 m**, on all four biomes. That is the
 * "lit islands of high ground inside the black, with their faces showing" a
 * player reported. It is fixed in the GEOMETRY, in `drapeConservative` at §3,
 * because a material fix would have to be written twice; read that header
 * before touching either the grid resolution or the drape.
 *
 * So the fog stops being a screen-space layer and becomes what it actually is:
 * a property of a world XZ that anything drawing at that XZ can ask about.
 * `applyShroudTint` re-runs the carpet's own alpha/colour formula per fragment,
 * which is why a remembered building keeps EXACTLY the tint it had before —
 * same numbers, different surface — while a live unit samples at its own cell,
 * reads `VIS_VISIBLE`, and takes no tint at all.
 *
 * The warp and the dither are deliberately NOT carried over. They exist to
 * break a 4 m texel grid across a full-screen surface and buy nothing on a 3 m
 * silhouette.
 */
/**
 * Exported because the TSL port needs the SAME number, not a second `1 /
 * MAP_SIZE` written out again in `render/shroud-nodes.ts`. It is baked into the
 * GLSL below as a literal at 10 decimal places; the node path reads this
 * constant directly, so the two cannot drift.
 */
export const SHROUD_UV_SCALE = 1 / MAP_SIZE;

/** 1x1 R8 = 255, i.e. "fully visible, tint nothing". */
function makeClearMask(): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
  );
  t.name = 'ShroudMaskDefault';
  t.needsUpdate = true;
  return t;
}

/**
 * Module-scope and SHARED BY REFERENCE with every material that opts in.
 *
 * It has to be a live object rather than a value read at construction time:
 * materials are built during `Phase.Command` (art.entityProps order 45,
 * world.water order 60) while `FogOfWar` is not constructed until
 * `Phase.Vision` (1300). The 1x1 default is what makes the wiring
 * order-independent. Same trick as `buildingTime` in `BuildingFactory.ts`.
 */
export const shroudUniforms = {
  uFogMask: { value: makeClearMask() },
  /** rgb = explored tint, w = FOG_EXPLORED_ALPHA. */
  uFogTint: { value: new THREE.Vector4(0, 0, 0, FOG_EXPLORED_ALPHA) },
  /** rgb = unexplored colour, w = FOG_UNEXPLORED_ALPHA. */
  uFogDark: { value: new THREE.Vector4(0, 0, 0, FOG_UNEXPLORED_ALPHA) },
  /** x = 1/MAP_SIZE, y = FOG_EXPLORED_LEVEL. */
  uFogParams: { value: new THREE.Vector2(SHROUD_UV_SCALE, FOG_EXPLORED_LEVEL) },
  /** 0 disables the self-tint entirely — `?fog=off` and the shot harness. */
  uFogAmount: { value: 0 },
};

const SHROUD_TINT_FRAG = /* glsl */ `
  {
    float vmV    = texture2D(uFogMask, vShroudUv).r;
    float vmRem  = 1.0 - smoothstep(0.0, uFogParams.y, vmV);
    float vmFog  = 1.0 - smoothstep(uFogParams.y, 1.0, vmV);
    float vmA    = mix(uFogTint.w * vmFog, uFogDark.w, vmRem) * uFogAmount;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uFogTint.xyz, uFogDark.xyz, vmRem), vmA);
  }
`;

/** The shape `onBeforeCompile` is handed. Narrow on purpose. */
export interface ShroudShaderHost {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

/**
 * Inject the shroud self-tint into a three-built material's program.
 *
 * MUST be called from inside whatever `onBeforeCompile` the material already
 * has, never installed as one — `applyStructureShader` ASSIGNS
 * `mat.onBeforeCompile` over a material built by `createUnitMaterial`, so a
 * hook installed in the unit factory is silently clobbered for every structure
 * in the game.
 *
 * Bump the material's `customProgramCacheKey` when adding this, or three serves
 * the previously-compiled program and the injection is a no-op.
 */
export function applyShroudTint(shader: ShroudShaderHost): void {
  // Assign the SHARED objects, not copies. Copies would freeze the mask at its
  // 1x1 default and the whole thing would silently do nothing.
  shader.uniforms.uFogMask = shroudUniforms.uFogMask;
  shader.uniforms.uFogTint = shroudUniforms.uFogTint;
  shader.uniforms.uFogDark = shroudUniforms.uFogDark;
  shader.uniforms.uFogParams = shroudUniforms.uFogParams;
  shader.uniforms.uFogAmount = shroudUniforms.uFogAmount;

  // `transformed` is post-morph/skin local space; `instanceMatrix` then
  // `modelMatrix` lifts it to world. Batch meshes are pinned at the origin so
  // modelMatrix is identity for them, but routing through it keeps this helper
  // correct for the non-instanced Scatter and Water meshes too.
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec2 vShroudUv;\nvoid main() {')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  {
    vec4 vmWp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      vmWp = instanceMatrix * vmWp;
    #endif
    vmWp = modelMatrix * vmWp;
    vShroudUv = vmWp.xz * ${SHROUD_UV_SCALE.toFixed(10)};
  }`,
    );

  // Before tonemapping, which is where the carpet composites too: three forces
  // NoToneMapping while rendering into the HalfFloat post target, so this is
  // the same scene-linear space the carpet blends in.
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `uniform sampler2D uFogMask;
uniform vec4 uFogTint;
uniform vec4 uFogDark;
uniform vec2 uFogParams;
uniform float uFogAmount;
varying vec2 vShroudUv;
void main() {`,
    )
    .replace('#include <tonemapping_fragment>', `${SHROUD_TINT_FRAG}\n  #include <tonemapping_fragment>`);
}

/* ==========================================================================
 * 2. THE OVERLAY
 * ========================================================================== */

export interface FogOfWarOptions {
  scene: THREE.Scene;
  /** Ground height sampler. The carpet is draped on whatever this returns. */
  heightAt: (x: number, z: number) => number;
  /** Art look. Defaults to `DEFAULT_ART.shroud`. */
  look?: ShroudLook;
}

/**
 * Wrap the shipping GLSL carpet in the same four methods the node set exposes.
 *
 * NOT A NEW ABSTRACTION LAYER: it is the four things `FogOfWar` already did to
 * `this.material.uniforms` inline, moved behind names, so the class body has one
 * shape rather than a branch at every touch point. Every value written here is
 * the value that was written before, in the same order, including the
 * `shroudUniforms` writes — which are what keep a mood change from re-tinting
 * the ground while every building stays on the old palette.
 */
function glslShroudSet(material: THREE.ShaderMaterial): ShroudMaterialSetLike {
  const scratch = new Float32Array(3);
  return {
    material,
    setFogTexture(tex: THREE.Texture): void { material.uniforms.uFog.value = tex; },
    setTime(t: number): void { material.uniforms.uTime.value = t; },
    applyLook(look: ShroudLook): void {
      const u = material.uniforms;
      hexToLinearRgb(look.exploredTint, scratch);
      (u.uExploredTint.value as THREE.Vector3).set(scratch[0], scratch[1], scratch[2]);
      shroudUniforms.uFogTint.value.set(scratch[0], scratch[1], scratch[2], FOG_EXPLORED_ALPHA);
      hexToLinearRgb(look.unexploredColor, scratch);
      (u.uUnexploredColor.value as THREE.Vector3).set(scratch[0], scratch[1], scratch[2]);
      shroudUniforms.uFogDark.value.set(scratch[0], scratch[1], scratch[2], FOG_UNEXPLORED_ALPHA);
      u.uNoiseScale.value = Math.max(1, look.noiseScale);
      u.uNoiseSpeed.value = look.noiseSpeed;
    },
    dispose(): void { material.dispose(); },
  };
}

export class FogOfWar {
  /** 128x128 R8. Red channel is the smoothed fog level, 0..255. */
  readonly texture: THREE.DataTexture;
  /**
   * The carpet's material set, GLSL or node.
   *
   * This was the raw `THREE.ShaderMaterial`. `ShaderMaterial` is not in
   * `StandardNodeLibrary`, so under `WebGPURenderer` it draws through a bare
   * `NodeMaterial` — a black carpet over the whole map — and
   * `render/shroud-nodes.ts` §6 is the twin. Four things touched the material
   * directly (the mesh, `uTime`, `applyLook`, `dispose`) and all four are now
   * methods on the set, which both paths implement.
   */
  readonly materials: ShroudMaterialSetLike;
  readonly mesh: THREE.Mesh;

  /** Smoothed per-cell level in 0..1. The thing that animates. */
  readonly level: Float32Array;
  /** The texture's byte view, exposed so the minimap can read the same data. */
  readonly bytes: Uint8Array;

  private readonly geometry: THREE.BufferGeometry;
  private readonly scene: THREE.Scene;

  /** Grid version this instance last consumed, so a settled fog costs nothing. */
  private lastVersion = -1;
  /** False while at least one cell is still travelling toward its target. */
  private settled = false;
  private dirty = false;
  private uploadAccum = 0;
  private uploads = 0;
  private on = true;
  private shown = false;

  constructor(options: FogOfWarOptions) {
    this.scene = options.scene;
    const look = options.look ?? DEFAULT_ART.shroud;

    /* -- texture --------------------------------------------------------- */
    this.bytes = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.level = new Float32Array(MAP_CELLS * MAP_CELLS);
    this.texture = new THREE.DataTexture(
      this.bytes, MAP_CELLS, MAP_CELLS, THREE.RedFormat, THREE.UnsignedByteType,
    );
    this.texture.name = 'FogOfWar';
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    /* -- material -------------------------------------------------------- */
    const tint = new Float32Array(3);
    const dark = new Float32Array(3);
    hexToLinearRgb(look.exploredTint, tint);
    hexToLinearRgb(look.unexploredColor, dark);

    // Publish the real mask to every material that opted into the self-tint.
    // Until this line runs they have been sampling the 1x1 "fully visible"
    // default, which tints nothing — that is what keeps the wiring safe
    // against the init order (materials exist long before this constructor).
    shroudUniforms.uFogMask.value = this.texture;
    shroudUniforms.uFogTint.value.set(tint[0], tint[1], tint[2], FOG_EXPLORED_ALPHA);
    shroudUniforms.uFogDark.value.set(dark[0], dark[1], dark[2], FOG_UNEXPLORED_ALPHA);

    const np = nodePath();
    const glslMaterial = np !== null ? null : new THREE.ShaderMaterial({
      name: 'ShroudMaterial',
      vertexShader: SHROUD_VERT,
      fragmentShader: SHROUD_FRAG,
      uniforms: {
        uFog: { value: this.texture },
        uExploredTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
        uUnexploredColor: { value: new THREE.Vector3(dark[0], dark[1], dark[2]) },
        uExploredAlpha: { value: FOG_EXPLORED_ALPHA },
        uUnexploredAlpha: { value: FOG_UNEXPLORED_ALPHA },
        uExploredLevel: { value: FOG_EXPLORED_LEVEL },
        uTexel: { value: 1 / MAP_CELLS },
        uWarp: { value: FOG_EDGE_WARP },
        uDither: { value: FOG_DITHER },
        uNoiseScale: { value: Math.max(1, look.noiseScale) },
        uNoiseSpeed: { value: look.noiseSpeed },
        uTime: { value: 0 },
      },
      transparent: true,
      // DEPTH ON. The carpet owns the GROUND PLANE only; anything standing
      // above it tints itself from the same mask via `applyShroudTint`. With
      // depth off this composited over units standing in FRONT of shrouded
      // ground — measured at 0.021 mean alpha over infantry heads and 0.060
      // over vehicles, worst for the tallest units. See §1b.
      depthTest: true,
      depthWrite: false,
      // Culling buys nothing on a single-sided carpet and costs a class of bug
      // if the terrain sampler ever produces an inverted quad.
      side: THREE.DoubleSide,
      // Scene fog on the shroud would tint the shroud toward the sky, which is
      // both wrong and, per the bible §1, a thing we do not have anyway.
      fog: false,
      toneMapped: false,
    });

    this.materials = glslMaterial !== null
      ? glslShroudSet(glslMaterial)
      : np!.createShroudMaterial(look);
    this.materials.setFogTexture(this.texture);

    /* -- geometry -------------------------------------------------------- */
    this.geometry = buildDrapedGrid(options.heightAt);

    this.mesh = new THREE.Mesh(this.geometry, this.materials.material);
    this.mesh.name = 'Shroud';
    this.mesh.renderOrder = RENDER_ORDER.SHROUD;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.layers.set(LAYERS.DEFAULT);
    this.mesh.layers.enable(LAYERS.OVERLAY);
    // Hidden until the first grid arrives: an all-black carpet would otherwise
    // be baked into the environment probe during boot.
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /* ------------------------------------------------------------------------
   * 2.1 Per-frame
   * ---------------------------------------------------------------------- */

  /** True while the shroud is being drawn. */
  get enabled(): boolean { return this.on; }

  /**
   * Turn the overlay off for the screenshot harness / `revealMap`. The mesh
   * stays in the scene (rebuilding 33k vertices to toggle a flag would be
   * absurd) and is simply not submitted.
   */
  setEnabled(v: boolean): void {
    this.on = v;
    this.syncGate();
  }

  /**
   * Carpet visibility and the shared self-tint are ONE gate.
   *
   * If they ever diverge you get the worst of both worlds: a hidden carpet with
   * every building still tinted, or `?fog=off` revealing the map while the
   * structures on it stay dark. They are driven from here and nowhere else.
   */
  private syncGate(): void {
    const live = this.on && this.shown;
    this.mesh.visible = live;
    shroudUniforms.uFogAmount.value = live ? 1 : 0;
  }

  /** Texture uploads performed since boot. Diagnostics. */
  get uploadCount(): number { return this.uploads; }

  /** Smoothed 0..1 level for a cell. The minimap uses this for its shroud. */
  levelAt(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return 0;
    return this.level[cz * MAP_CELLS + cx];
  }

  /**
   * Advance the smoothing toward `grid` and upload if anything moved.
   *
   * `version` is `Vision.version[player]`. When it has not changed AND the
   * previous pass fully settled, the whole 16k-cell loop is skipped — a static
   * camera over a static army costs literally nothing here.
   */
  update(grid: Uint8Array, version: number, dt: number, time: number): void {
    if (!this.on) return;

    this.materials.setTime(time);

    const versionChanged = version !== this.lastVersion;
    if (versionChanged) {
      this.lastVersion = version;
      this.settled = false;
    }
    if (this.settled) {
      this.flush(dt);
      return;
    }

    // Exponential approach. lambda = 3/seconds reaches ~95% in `seconds`, which
    // is how VISUAL_DNA I7's "250 ms reveal fade" is meant to be read.
    const kUp = 1 - Math.exp(-(3 / FOG_REVEAL_SECONDS) * dt);
    const kDown = 1 - Math.exp(-(3 / FOG_CONCEAL_SECONDS) * dt);

    const level = this.level;
    const bytes = this.bytes;
    const n = grid.length < level.length ? grid.length : level.length;

    let moving = false;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const g = grid[i];
      const target = (g & VIS_VISIBLE) !== 0 ? 1
        : (g & VIS_EXPLORED) !== 0 ? FOG_EXPLORED_LEVEL
          : 0;
      const cur = level[i];
      if (cur === target) continue;

      let next = cur + (target - cur) * (target > cur ? kUp : kDown);
      // Snap inside half a texture step, otherwise the loop never settles and
      // the "nothing is animating" fast path can never engage.
      if (next > target - 0.002 && next < target + 0.002) next = target;
      else moving = true;
      level[i] = next;

      const b = next <= 0 ? 0 : next >= 1 ? 255 : (next * 255 + 0.5) | 0;
      if (b !== bytes[i]) { bytes[i] = b; changed = true; }
    }

    this.settled = !moving;
    if (changed) this.dirty = true;
    this.flush(dt);

    if (!this.shown) {
      this.shown = true;
      this.syncGate();
    }
  }

  /** Throttled upload. 16 KB at FOG_UPLOAD_HZ is free; every frame is waste. */
  private flush(dt: number): void {
    if (!this.dirty) return;
    this.uploadAccum += dt;
    if (this.uploadAccum < 1 / FOG_UPLOAD_HZ) return;
    this.uploadAccum = 0;
    this.dirty = false;
    this.uploads++;
    this.texture.needsUpdate = true;
  }

  /**
   * Snap every cell to its target with no animation. Used when fog is toggled
   * or a scenario reveals the map — a 40-second fade-in of the whole board is
   * not a reveal, it is a bug that looks like a reveal.
   */
  snapTo(grid: Uint8Array): void {
    const level = this.level;
    const bytes = this.bytes;
    const n = grid.length < level.length ? grid.length : level.length;
    for (let i = 0; i < n; i++) {
      const g = grid[i];
      const target = (g & VIS_VISIBLE) !== 0 ? 1
        : (g & VIS_EXPLORED) !== 0 ? FOG_EXPLORED_LEVEL
          : 0;
      level[i] = target;
      bytes[i] = (target * 255 + 0.5) | 0;
    }
    this.settled = true;
    this.dirty = true;
    this.uploadAccum = 1;
    this.flush(0);
    if (!this.shown) {
      this.shown = true;
      this.syncGate();
    }
  }

  /**
   * Re-drape the carpet — call if the terrain heightfield is regenerated.
   *
   * Goes through `drapeConservative` rather than re-sampling `heightAt` at each
   * stored vertex XZ, which is what it used to do. A per-vertex point sample
   * here would silently undo the conservative drape on the first re-drape and
   * hand back the poke-through the constructor exists to prevent. The vertex
   * order is row-major in (iz, ix), which is exactly how `drapeConservative`
   * indexes its output, so `y[v]` is vertex `v`.
   */
  rebuildHeights(heightAt: (x: number, z: number) => number): void {
    const pos = this.geometry.getAttribute('position');
    const arr = pos.array as Float32Array;
    const y = drapeConservative(heightAt);
    for (let v = 0; v < pos.count; v++) arr[v * 3 + 1] = y[v];
    pos.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /**
   * Re-read an `ArtDirection.shroud` patch. Uniforms only — never allocates.
   *
   * `exploredDesat` has no uniform: desaturating what is already in the frame
   * needs a destination read this single forward pass does not have. It is
   * expressed instead as alpha toward an already-desaturated `exploredTint`,
   * which is the same perceptual move for a fraction of the cost.
   */
  applyLook(look: ShroudLook): void {
    this.materials.applyLook(look);
  }

  private static readonly scratchRgb = new Float32Array(3);

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.materials.dispose();
    // Hand the shared uniform back its 1x1 default BEFORE disposing the real
    // one. Six long-lived materials hold this object by reference, and leaving
    // a disposed GPU texture bound in all of them is a use-after-free that
    // survives the match it belonged to.
    shroudUniforms.uFogMask.value = makeClearMask();
    shroudUniforms.uFogAmount.value = 0;
    this.texture.dispose();
  }
}

/* ==========================================================================
 * 3. GEOMETRY
 * ========================================================================== */

/** 128 segments / 129 vertices / 4 m step at the shipped constants. */
const FOG_SEGMENTS = MAP_CELLS * FOG_MESH_SAMPLES_PER_CELL;
const FOG_GRID_N = FOG_SEGMENTS + 1;
const FOG_STEP = MAP_SIZE / FOG_SEGMENTS;

/**
 * Sub-samples per carpet step when taking the conservative maximum.
 *
 * DERIVED FROM `TERRAIN_GRID`, NEVER A LITERAL. The guarantee below rests on
 * the sample spacing being no coarser than the finest feature the ground
 * sampler can express, and for the heightfield behind `heightAt` that is the
 * terrain grid. At the shipped 4 m step over a 1 m grid this is 4, so the
 * sample points land exactly on terrain grid nodes.
 */
const FOG_DRAPE_SUB = Math.max(1, Math.ceil(FOG_STEP / TERRAIN_GRID));

/**
 * Vertex heights for the carpet: the local MAXIMUM of the ground over each
 * vertex's footprint, not its point value.
 *
 * WHY NOT THE POINT VALUE — THE FOURTH THING `depthTest: true` BROKE
 * ------------------------------------------------------------------
 * §1b lists three consequences of depth-testing the carpet. There is a fourth,
 * and it is the one a player reported: a terrace is a near-vertical step, the
 * carpet grid samples every `FOG_STEP` metres, and a linear span across a step
 * cuts a DIAGONAL RAMP through it. On the low side the carpet is above the
 * ground and shrouds correctly; on the high side it is BELOW the terrain, the
 * depth test lets the terrain win, and never-explored high ground renders at
 * full daylight — lit islands inside the black, with their terrace faces
 * showing. Neither `TerrainMaterial` nor the road materials call
 * `applyShroudTint` (both say so, deliberately, because the carpet owns the
 * ground plane), so the roads on that island are revealed with it.
 *
 * Measured through the real generator over the whole map at 0.5 m, point drape:
 * **5.0-7.0% of every map, worst overshoot 4.98-6.59 m**, on all four biomes.
 * It is NOT urban-specific — urban was the mildest of the four — and the cause
 * is confirmed by conditioning on slope: 2.3% of flat ground (|grad| < 0.1)
 * overshoots against 40-46% of ground steeper than 0.5, with the mean overshoot
 * climbing monotonically from 0.52 m to 1.27 m across the bands.
 *
 * THE GUARANTEE, AND WHY IT IS PROVED RATHER THAN MEASURED
 * -------------------------------------------------------
 * Vertex (ix, iz) is a corner of at most four quads, which together span
 * `+/- FOG_STEP` in x and z. Give every vertex the maximum of the ground over
 * that box and every corner of every quad is >= the ground at every point
 * INSIDE that quad; the carpet's surface there is a convex combination of three
 * such corners, so it is >= the ground too. The box is axis-aligned and its
 * sample points land on terrain grid nodes, and the ground between nodes is
 * planar, so the discrete maximum IS the continuous one. Nothing can poke
 * through, at any grid resolution, on any terrain.
 *
 * RAISING `FOG_MESH_SAMPLES_PER_CELL` IS THE OTHER LEVER AND IT IS WORSE
 * ---------------------------------------------------------------------
 * No finite grid follows a discontinuity, so it only shrinks the artefact while
 * multiplying triangles by the square of the factor. Measured on
 * `soviets.07.right-of-entry`: point drape needs 2 097 152 triangles (64x) to
 * reach 0.000%, and still leaves 0.015 m; this reaches 0.000% / 0.000 m at
 * 32 768. See `FOG_MESH_SAMPLES_PER_CELL` in `config.ts` for the full sweep.
 *
 * WHAT IT COSTS, MEASURED RATHER THAN WAVED AT
 * --------------------------------------------
 * The carpet now FLOATS above low ground within one step of a rise — mean
 * 0.686 m over the whole map, 16.3% of it by more than 1 m. The thing a player
 * can actually see is not the float but the horizontal displacement of the
 * shroud edge, which at `CAMERA.pitchDeg` 52 is `float / tan(52) = 0.781 x`:
 * **mean 0.54 m, max 4.23 m, and only 1.05% of the map past one 4 m fog texel,
 * 0.000% past two.** The fog texture is bilinear over 4 m texels with a
 * two-octave noise warp on top of that, so a sub-texel shift is below the
 * resolution of the thing being displaced. It darkens slightly MORE than it
 * strictly should, which is the correct direction to be wrong in: the failure
 * it replaces was revealing ground the player has never seen.
 *
 * THE ONE RESIDUAL, AND IT IS ON THE TWO COASTAL MAPS
 * ---------------------------------------------------
 * Raising the carpet at a shore cliff can lift the SEABED carpet through the
 * water surface: over open water it went from 2.0% / 3.0% of wet area to
 * 7.2% / 8.3% on `coast` / `tropical`, i.e. 5.2% newly emerged. Where that
 * happens the carpet passes the depth test in front of the water instead of
 * failing behind it, and both surfaces then tint from the same mask with the
 * same formula (`WaterMaterial.ts` says so in as many words). At
 * `FOG_UNEXPLORED_ALPHA` 1.0 that composite is bit-identical; on REMEMBERED
 * shoreline the two 0.62 blends compound to 0.856, i.e. a slightly darker rim.
 * Not fixed here on purpose — clamping the raise to `WATER_LEVEL` reopens the
 * hole at exactly the shore cliffs it would be clamping for, and making the
 * water and the carpet agree about who owns sub-water ground is a different
 * change.
 *
 * COST TO BUILD: ~9 ms against ~1 ms, ONCE, at terrain build and on
 * `rebuildHeights`. Never in the frame loop. The sliding maximum is separable
 * and the naive inner loop is 9 comparisons wide at the shipped numbers; a
 * monotonic deque would make it O(n) and is not worth the reader's time here.
 */
function drapeConservative(heightAt: (x: number, z: number) => number): Float32Array {
  const sub = FOG_DRAPE_SUB;
  const sn = FOG_SEGMENTS * sub + 1;
  const ss = FOG_STEP / sub;

  // 513x513 at the shipped numbers — the terrain's own grid, exactly.
  const raw = new Float32Array(sn * sn);
  for (let iz = 0; iz < sn; iz++) {
    const z = iz * ss;
    const row = iz * sn;
    for (let ix = 0; ix < sn; ix++) raw[row + ix] = heightAt(ix * ss, z);
  }

  // Pass 1: maximum along x, evaluated ONLY at the columns a carpet vertex
  // stands on. Every other column is discarded by pass 2, so computing them
  // would be four times the work for nothing.
  const colMax = new Float32Array(sn * FOG_GRID_N);
  for (let iz = 0; iz < sn; iz++) {
    const src = iz * sn;
    const dst = iz * FOG_GRID_N;
    for (let ix = 0; ix < FOG_GRID_N; ix++) {
      const sx = ix * sub;
      const lo = sx - sub < 0 ? 0 : sx - sub;
      const hi = sx + sub > sn - 1 ? sn - 1 : sx + sub;
      let m = raw[src + lo];
      for (let k = lo + 1; k <= hi; k++) { const v = raw[src + k]; if (v > m) m = v; }
      colMax[dst + ix] = m;
    }
  }

  // Pass 2: maximum along z over pass 1, straight into the vertex heights.
  const out = new Float32Array(FOG_GRID_N * FOG_GRID_N);
  for (let iz = 0; iz < FOG_GRID_N; iz++) {
    const sz = iz * sub;
    const lo = sz - sub < 0 ? 0 : sz - sub;
    const hi = sz + sub > sn - 1 ? sn - 1 : sz + sub;
    const dst = iz * FOG_GRID_N;
    for (let ix = 0; ix < FOG_GRID_N; ix++) {
      let m = colMax[lo * FOG_GRID_N + ix];
      for (let k = lo + 1; k <= hi; k++) {
        const v = colMax[k * FOG_GRID_N + ix];
        if (v > m) m = v;
      }
      out[dst + ix] = m + FOG_MESH_LIFT;
    }
  }
  return out;
}

/**
 * A regular grid over the whole map, with every vertex lifted onto the ground.
 *
 * `FOG_MESH_SAMPLES_PER_CELL = 1` gives 129x129 vertices / 32768 triangles for
 * ONE draw call. The height of each vertex comes from `drapeConservative`, not
 * from a point sample — read that function's header before changing either.
 */
function buildDrapedGrid(heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const segments = FOG_SEGMENTS;
  const n = FOG_GRID_N;
  const step = FOG_STEP;
  const y = drapeConservative(heightAt);

  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  // 129^2 = 16641 vertices, comfortably inside a Uint16 index.
  const indices = new Uint16Array(segments * segments * 6);

  let p = 0;
  let t = 0;
  for (let iz = 0; iz < n; iz++) {
    const z = iz * step;
    for (let ix = 0; ix < n; ix++) {
      const x = ix * step;
      positions[p] = x;
      positions[p + 1] = y[iz * n + ix];
      positions[p + 2] = z;
      p += 3;
      uvs[t] = x / MAP_SIZE;
      uvs[t + 1] = z / MAP_SIZE;
      t += 2;
    }
  }

  let k = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // CCW seen from +Y.
      indices[k] = a; indices[k + 1] = c; indices[k + 2] = b;
      indices[k + 3] = b; indices[k + 4] = c; indices[k + 5] = d;
      k += 6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.name = 'ShroudGrid';
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * ============================================================================
 * RED ALERT — src/render/FogOfWar.ts
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
 * at `RENDER_ORDER.SHROUD` with **depth testing off**.
 *
 * Depth off is not a shortcut, it is the identity. RA2 and RA3 both composite
 * the shroud as a layer OVER the world, so a structure standing inside the fog
 * is swallowed by it rather than poking through a hole in the ground. Because
 * the carpet occupies the screen pixels of the ground BEHIND a tall object, and
 * fog regions are far larger than any building's screen height, the practical
 * effect is exactly that: everything inside the shroud goes dark together.
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
} from '../core/config';
import type { ShroudLook } from '../core/types';
import { hexToLinearRgb } from '../core/math';
import { LAYERS, RENDER_ORDER } from './scene';
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
 * 2. THE OVERLAY
 * ========================================================================== */

export interface FogOfWarOptions {
  scene: THREE.Scene;
  /** Ground height sampler. The carpet is draped on whatever this returns. */
  heightAt: (x: number, z: number) => number;
  /** Art look. Defaults to `DEFAULT_ART.shroud`. */
  look?: ShroudLook;
}

export class FogOfWar {
  /** 128x128 R8. Red channel is the smoothed fog level, 0..255. */
  readonly texture: THREE.DataTexture;
  readonly material: THREE.ShaderMaterial;
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

    this.material = new THREE.ShaderMaterial({
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
      // The shroud is a LAYER over the world, not a decal on the ground.
      depthTest: false,
      depthWrite: false,
      // Culling buys nothing on a single-sided carpet and costs a class of bug
      // if the terrain sampler ever produces an inverted quad.
      side: THREE.DoubleSide,
      // Scene fog on the shroud would tint the shroud toward the sky, which is
      // both wrong and, per the bible §1, a thing we do not have anyway.
      fog: false,
      toneMapped: false,
    });

    /* -- geometry -------------------------------------------------------- */
    this.geometry = buildDrapedGrid(options.heightAt);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
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
    this.mesh.visible = v && this.shown;
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

    this.material.uniforms.uTime.value = time;

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
      this.mesh.visible = this.on;
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
      this.mesh.visible = this.on;
    }
  }

  /** Re-drape the carpet — call if the terrain heightfield is regenerated. */
  rebuildHeights(heightAt: (x: number, z: number) => number): void {
    const pos = this.geometry.getAttribute('position');
    const arr = pos.array as Float32Array;
    for (let v = 0; v < pos.count; v++) {
      const o = v * 3;
      arr[o + 1] = heightAt(arr[o], arr[o + 2]) + FOG_MESH_LIFT;
    }
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
    const u = this.material.uniforms;
    const rgb = FogOfWar.scratchRgb;
    hexToLinearRgb(look.exploredTint, rgb);
    (u.uExploredTint.value as THREE.Vector3).set(rgb[0], rgb[1], rgb[2]);
    hexToLinearRgb(look.unexploredColor, rgb);
    (u.uUnexploredColor.value as THREE.Vector3).set(rgb[0], rgb[1], rgb[2]);
    u.uNoiseScale.value = Math.max(1, look.noiseScale);
    u.uNoiseSpeed.value = look.noiseSpeed;
  }

  private static readonly scratchRgb = new Float32Array(3);

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/* ==========================================================================
 * 3. GEOMETRY
 * ========================================================================== */

/**
 * A regular grid over the whole map, with every vertex lifted onto the ground.
 *
 * `FOG_MESH_SAMPLES_PER_CELL = 1` gives 129x129 vertices / 32768 triangles for
 * ONE draw call. That is deliberately coarse: the fog VALUE is bilinear in the
 * fragment shader, so this grid only has to follow the terrain silhouette. A
 * finer grid would quadruple the vertex cost and change nothing on screen.
 */
function buildDrapedGrid(heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const segments = MAP_CELLS * FOG_MESH_SAMPLES_PER_CELL;
  const n = segments + 1;
  const step = MAP_SIZE / segments;

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
      positions[p + 1] = heightAt(x, z) + FOG_MESH_LIFT;
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

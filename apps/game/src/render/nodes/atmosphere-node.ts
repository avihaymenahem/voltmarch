/**
 * WebGPU cinematic atmosphere, fused into the existing HDR post expression.
 *
 * This is deliberately not `scene.fog`: noon's old material fog desaturated
 * every distant surface and compiled a fog branch into every material. Here a
 * single depth reconstruction gives us world-locked cloud shade and a very
 * thin, low-altitude aerial perspective without another draw or render target.
 */

import {
  Color,
  DataTexture,
  LinearFilter,
  Matrix4,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector3,
} from 'three/webgpu';
import type { Camera, Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  clamp,
  float,
  getViewPosition,
  length,
  max,
  mix,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import type { CinematicAtmosphereConfig } from '../renderer';

type Vec4 = Node<'vec4'>;

export interface AtmosphereNodeUniforms {
  time: UniformNode<'float', number>;
  cloudStrength: UniformNode<'float', number>;
  cloudScale: UniformNode<'float', number>;
  hazeStrength: UniformNode<'float', number>;
  hazeStart: UniformNode<'float', number>;
  hazeEnd: UniformNode<'float', number>;
  hazeColor: UniformNode<'vec3', Vector3>;
}

export interface AtmosphereNodes {
  readonly node: Vec4;
  readonly uniforms: AtmosphereNodeUniforms;
  applyConfig(cfg: CinematicAtmosphereConfig, fogColor: number, horizonColor: number): void;
  dispose(): void;
}

const CLOUD_NOISE_SIZE = 128;
const CLOUD_NOISE_SEED = 0x63a9f17d;

function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smooth01(x: number): number { return x * x * (3 - 2 * x); }

function periodicValueNoise(x: number, y: number, cells: number, seed: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth01(fx - x0);
  const ty = smooth01(fy - y0);
  const wrap = (v: number): number => ((v % cells) + cells) % cells;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

/** Deterministic, seamless cloud coverage used by the two post samples. */
export function buildCloudNoiseData(size = CLOUD_NOISE_SIZE, seed = CLOUD_NOISE_SEED): Uint8Array {
  const n = Math.max(8, Math.floor(size));
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const broad = periodicValueNoise(u, v, 4, seed);
      const middle = periodicValueNoise(u, v, 9, seed ^ 0x51c3a7d1);
      const detail = periodicValueNoise(u, v, 19, seed ^ 0xa17f3b29);
      const coverage = clampNumber(broad * 0.58 + middle * 0.29 + detail * 0.13, 0, 1);
      const value = Math.round(coverage * 255);
      const i = (y * n + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return data;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function normaliseAtmosphereConfig(cfg: CinematicAtmosphereConfig): CinematicAtmosphereConfig {
  const start = clampNumber(cfg.hazeStart, 0, 2000);
  return {
    enabled: cfg.enabled,
    cloudShadowStrength: clampNumber(cfg.cloudShadowStrength, 0, 0.35),
    cloudScale: clampNumber(cfg.cloudScale, 48, 1000),
    hazeStrength: clampNumber(cfg.hazeStrength, 0, 0.20),
    hazeStart: start,
    hazeEnd: Math.max(start + 1, clampNumber(cfg.hazeEnd, 1, 4000)),
  };
}

function cloudTexture(): DataTexture {
  const tex = new DataTexture(
    buildCloudNoiseData(), CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE,
    RGBAFormat, UnsignedByteType,
  );
  tex.name = 'CinematicCloudCoverage';
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const colorScratch = new Color();
const horizonScratch = new Color();

function setLinearHazeColor(out: Vector3, fogColor: number, horizonColor: number): void {
  colorScratch.setHex(fogColor).convertSRGBToLinear();
  horizonScratch.setHex(horizonColor).convertSRGBToLinear();
  colorScratch.lerp(horizonScratch, 0.62);
  out.set(colorScratch.r, colorScratch.g, colorScratch.b);
}

export function createAtmosphereNodes(
  input: Node<'vec4'>,
  depthNode: TextureNode,
  camera: Camera,
  cfg: CinematicAtmosphereConfig,
  fogColor: number,
  horizonColor: number,
): AtmosphereNodes {
  const noise = cloudTexture();
  const clean = normaliseAtmosphereConfig(cfg);
  const uniforms: AtmosphereNodeUniforms = {
    time: uniform(0) as UniformNode<'float', number>,
    cloudStrength: uniform(clean.cloudShadowStrength) as UniformNode<'float', number>,
    cloudScale: uniform(clean.cloudScale) as UniformNode<'float', number>,
    hazeStrength: uniform(clean.hazeStrength) as UniformNode<'float', number>,
    hazeStart: uniform(clean.hazeStart) as UniformNode<'float', number>,
    hazeEnd: uniform(clean.hazeEnd) as UniformNode<'float', number>,
    hazeColor: uniform(new Vector3()) as UniformNode<'vec3', Vector3>,
  };
  setLinearHazeColor(uniforms.hazeColor.value, fogColor, horizonColor);

  // These Matrix4 objects are mutated by Three in place, so their uniform
  // bindings follow camera motion without a JS copy in the frame loop.
  const projectionInverse = uniform(camera.projectionMatrixInverse as Matrix4);
  const cameraWorld = uniform(camera.matrixWorld as Matrix4);

  const atmosphere = Fn(() => {
    const uv = screenUV.toVar('atmosphereUv');
    const depth = depthNode.sample(uv).r.toVar('atmosphereDepth');
    // The sky dome does not write depth; 1.0 is therefore the exact exclusion
    // mask that keeps haze/cloud shade off the sky and out-of-map void.
    const geometry = float(1).sub(smoothstep(0.9992, 1.0, depth)).toVar('atmosphereGeometry');
    const view = getViewPosition(uv, depth, projectionInverse).toVar('atmosphereView');
    const world = cameraWorld.mul(vec4(view, 1.0)).xyz.toVar('atmosphereWorld');

    // Two differently oriented reads from one 64 KiB seamless texture create
    // broad, soft coverage without a raymarch, a noise ALU stack or a new pass.
    // About 0.8 m/s at the shipped 170 m scale: slow enough to feel like cloud
    // cover, fast enough that its direction is legible during a normal match.
    const drift = vec2(uniforms.time.mul(0.0048), uniforms.time.mul(0.0022));
    const p = world.xz.div(uniforms.cloudScale).add(drift).toVar('cloudUv');
    const broad = texture(noise, p).r;
    const detailUv = vec2(p.y.negate(), p.x).mul(2.17).add(drift.mul(-1.61));
    const detail = texture(noise, detailUv).r;
    // A defined transition produces readable, kilometre-scale cloud edges.
    // The previous 0.46..0.74 ramp spread the modulation across almost the
    // entire screen and made it indistinguishable from exposure.
    const coverage = smoothstep(0.44, 0.62, mix(broad, detail, 0.28));
    // Cloud cover must not turn muzzle flashes, neon and explosions grey.
    // Guarding HDR peaks here preserves their bloom while shaded terrain and
    // unit materials still receive the moving light modulation.
    const peak = max(input.r, max(input.g, input.b));
    const emissiveGuard = float(1).sub(smoothstep(1.25, 2.8, peak));
    const shade = coverage.mul(uniforms.cloudStrength).mul(geometry).mul(emissiveGuard);

    // Real cloud shade removes warm direct sun while cool skylight remains.
    // Channel-weighting the attenuation makes the band read as weather rather
    // than a second vignette or a global exposure pulse.
    const shadowAttenuation = vec3(
      float(1).sub(shade),
      float(1).sub(shade.mul(0.86)),
      float(1).sub(shade.mul(0.68)),
    );
    let rgb = input.rgb.mul(shadowAttenuation).toVar('atmosphereRgb');

    // Haze starts outside the closest combat read and remains capped. Tall
    // silhouettes retain more contrast than low terrain, which
    // makes the depth cue feel like air instead of a grey screen overlay.
    const distanceFog = smoothstep(uniforms.hazeStart, uniforms.hazeEnd, length(view));
    const altitude = float(1).sub(smoothstep(8.0, 38.0, world.y)).mul(0.58).add(0.42);
    // Undiscovered terrain is already black in the scene colour. Do not lift
    // that black with a constant haze tint, which would reveal its depth and
    // relief through the shroud. The tiny threshold still admits night art.
    const shroudGuard = smoothstep(0.004, 0.025, peak);
    const haze = clamp(
      distanceFog.mul(altitude).mul(uniforms.hazeStrength).mul(geometry).mul(shroudGuard),
      0.0, 0.20,
    );
    rgb = mix(rgb, uniforms.hazeColor, haze).toVar('atmosphereHazed');
    return vec4(rgb, input.a);
  });

  return {
    node: atmosphere() as unknown as Vec4,
    uniforms,
    applyConfig(next, nextFogColor, nextHorizonColor): void {
      const value = normaliseAtmosphereConfig(next);
      uniforms.cloudStrength.value = value.cloudShadowStrength;
      uniforms.cloudScale.value = value.cloudScale;
      uniforms.hazeStrength.value = value.hazeStrength;
      uniforms.hazeStart.value = value.hazeStart;
      uniforms.hazeEnd.value = value.hazeEnd;
      setLinearHazeColor(uniforms.hazeColor.value, nextFogColor, nextHorizonColor);
    },
    dispose(): void { noise.dispose(); },
  };
}

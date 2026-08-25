/**
 * THE GRADE A/B — the same HDR chart through the GLSL pass and through the TSL
 * port, on a real device, diffed.
 *
 * `docs/RENDER_FINDINGS.md` §5's lesson is "a test that reads the CONFIG proves
 * nothing about the SHADER — when it matters, read the uniform off a booted
 * page". `tests/post-nodes.spec.ts` gets as far as the COMPILED shader without a
 * browser, which is already a stronger instrument than this project had. This is
 * the rest of it: both shaders EXECUTE, on the same input, driven from the same
 * config through the same `gradeUniformValuesFor`, and the two images are
 * compared pixel by pixel.
 *
 * It is the only thing that can answer "does the port change the look", and the
 * answer it gives is a number rather than an opinion.
 *
 * ── WHAT IS AND IS NOT CONTROLLED ────────────────────────────────────────────
 * The two arms are DIFFERENT RENDERERS running DIFFERENT SHADING LANGUAGES on
 * possibly different precision, so bit-equality is not the bar and claiming it
 * would be dishonest. What is controlled:
 *
 *   - The input is one `Float32Array` uploaded to both, `NearestFilter`, and the
 *     output is rendered at EXACTLY the texture's size so every fetch lands on a
 *     texel centre. No filtering difference can enter.
 *   - Both arms take their uniforms from `gradeUniformValuesFor(cfg)` — the same
 *     pure function `post.ts` and `grade-node.ts` both use.
 *   - `grain`, `chromaticAberration` and `uTime` are ZERO on the GLSL arm,
 *     because they are zero in the shipped config and the TSL arm does not
 *     implement them at all. That is the comparison that matters: the shipped
 *     configuration, not a hypothetical one.
 *
 * ── THE CHART IS A FUNCTION OF X ONLY, ON PURPOSE ────────────────────────────
 * `GRADE_FRAG` reads `vUv` off the quad's uv attribute; the node grade reads
 * `screenUV`, which is derived from `fragCoord`. Those two disagree about which
 * way is up between the WebGL and WebGPU coordinate systems, and a vertical flip
 * would swamp a comparison that is supposed to be about colour. So the chart
 * varies only along x, which makes it flip-invariant, and the orientation
 * question is answered SEPARATELY and explicitly by `orientationProbe()` below
 * rather than being quietly absorbed.
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

import {
  WebGPURenderer,
  RenderPipeline,
  DataTexture as GpuDataTexture,
  RGBAFormat as GpuRGBAFormat,
  FloatType as GpuFloatType,
  NearestFilter as GpuNearestFilter,
  RenderTarget as GpuRenderTarget,
  UnsignedByteType as GpuUnsignedByteType,
} from 'three/webgpu';
import { texture as gpuTexture } from 'three/tsl';

import { GRADE_FRAG, GRADE_VERT, makeGradeUniforms } from '../../apps/game/src/render/post';
import { RENDER_CONFIG } from '../../apps/game/src/render/renderer';
import { gradeUniformValuesFor, makeGradeUniformValues } from '../../apps/game/src/render/grade-curve';
import {
  applyGradeConfig,
  createGradeUniforms,
  gradeNode,
  setGradeTexel,
} from '../../apps/game/src/render/nodes/grade-node';

const W = 256;
const H = 64;

const log = (s: string): void => {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + s;
};

/* ========================================================================== */
/* The chart                                                                  */
/* ========================================================================== */

/**
 * A scene-linear HDR chart, varying along x only.
 *
 * Four bands across the width, so one pass covers the ranges the grade actually
 * behaves differently in:
 *
 *   0.00-0.25  neutral ramp 0 -> 0.18   (shadows: the 3-way shadow weight, the
 *                                        shadow saturation, the lift)
 *   0.25-0.50  neutral ramp 0.18 -> 1.0 (mids, the contrast pivot)
 *   0.50-0.75  neutral ramp 1.0 -> 8.0  (HDR: the white point, the paper-white
 *                                        fold, the tonemap's shoulder)
 *   0.75-1.00  saturated hues at 1.4    (the tint, the saturation, the fold's
 *                                        hue behaviour)
 */
function buildChart(): Float32Array {
  const data = new Float32Array(W * H * 4);
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    let r = 0;
    let g = 0;
    let b = 0;
    if (t < 0.25) {
      const u = t / 0.25;
      r = g = b = u * 0.18;
    } else if (t < 0.5) {
      const u = (t - 0.25) / 0.25;
      r = g = b = 0.18 + u * (1.0 - 0.18);
    } else if (t < 0.75) {
      const u = (t - 0.5) / 0.25;
      r = g = b = 1.0 + u * 7.0;
    } else {
      const u = (t - 0.75) / 0.25;
      const hue = u * 6;
      const i = Math.floor(hue) % 6;
      const f = hue - Math.floor(hue);
      const table: [number, number, number][] = [
        [1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f],
      ];
      const c = table[i];
      r = c[0] * 1.4;
      g = c[1] * 1.4;
      b = c[2] * 1.4;
    }
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 1;
    }
  }
  return data;
}

/** A chart that varies along Y, used only to detect a vertical flip. */
function buildYRamp(): Float32Array {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = (y / (H - 1)) * 0.9;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 1;
    }
  }
  return data;
}

/* ========================================================================== */
/* Arm A — the shipping GLSL pass, on WebGLRenderer                           */
/* ========================================================================== */

function renderGlsl(chart: Float32Array): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  /*
   * `LinearSRGBColorSpace`, not `NoColorSpace`: the latter is not a valid
   * DRAWING BUFFER colour space and three throws reading its config. It is
   * irrelevant either way here — we render into a target whose texture is
   * `NoColorSpace`, so nothing converts — but the setter runs first.
   */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const tex = new THREE.DataTexture(chart, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  const uniforms = makeGradeUniforms();
  const v = gradeUniformValuesFor(RENDER_CONFIG.post.grade, makeGradeUniformValues());
  uniforms.tDiffuse.value = tex;
  uniforms.uTexel.value.set(1 / W, 1 / H);
  uniforms.uTime.value = 0;
  uniforms.uExposure.value = v.exposure;
  uniforms.uToneMode.value = v.toneMode;
  uniforms.uShadowTint.value.set(v.shadowTint.x, v.shadowTint.y, v.shadowTint.z);
  uniforms.uMidTint.value.set(v.midTint.x, v.midTint.y, v.midTint.z);
  uniforms.uHighTint.value.set(v.highTint.x, v.highTint.y, v.highTint.z);
  uniforms.uLift.value.set(v.lift.x, v.lift.y, v.lift.z);
  uniforms.uGain.value.set(v.gain.x, v.gain.y, v.gain.z);
  uniforms.uContrast.value = v.contrast;
  uniforms.uSaturation.value = v.saturation;
  uniforms.uShadowSaturation.value = v.shadowSaturation;
  uniforms.uVignette.value = v.vignette;
  uniforms.uVignetteSoftness.value = v.vignetteSoftness;
  uniforms.uSharpen.value = v.sharpen;
  // Both banned, both 0 in config, and the TSL arm implements NEITHER — so the
  // comparison is only meaningful with them off. Set explicitly rather than
  // inherited from `makeGradeUniforms`, whose literals are the ones §5 caught
  // shipping live.
  uniforms.uGrain.value = 0;
  uniforms.uCA.value = 0;

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: GRADE_VERT,
    fragmentShader: GRADE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const target = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });

  const quad = new FullScreenQuad(material);
  renderer.setRenderTarget(target);
  quad.render(renderer);

  const out = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, out);

  quad.dispose();
  target.dispose();
  tex.dispose();
  renderer.dispose();
  return out;
}

/* ========================================================================== */
/* Arm B — the TSL port, on WebGPURenderer                                    */
/* ========================================================================== */

async function renderTsl(chart: Float32Array): Promise<{ pixels: Uint8Array; backend: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();

  const backend = (renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
  const backendName = backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2-fallback';

  const tex = new GpuDataTexture(chart, W, H, GpuRGBAFormat, GpuFloatType);
  tex.minFilter = GpuNearestFilter;
  tex.magFilter = GpuNearestFilter;
  tex.needsUpdate = true;

  const uniforms = createGradeUniforms();
  applyGradeConfig(uniforms, RENDER_CONFIG.post.grade);
  setGradeTexel(uniforms, W, H);

  const output = gradeNode({ input: gpuTexture(tex) as never, uniforms });

  const pipeline = new RenderPipeline(renderer, output as never);
  // The grade tonemaps AND sRGB-encodes; a second transform on top is a double
  // encode. This is the node twin of `post.ts` forcing `NoToneMapping`.
  pipeline.outputColorTransform = false;

  const target = new GpuRenderTarget(W, H, {
    type: GpuUnsignedByteType,
    format: GpuRGBAFormat,
    depthBuffer: false,
  });
  renderer.setRenderTarget(target);
  pipeline.render();
  renderer.setRenderTarget(null);

  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H);
  const pixels = new Uint8Array(raw.buffer.slice(0));

  target.dispose();
  tex.dispose();
  pipeline.dispose();
  renderer.dispose();
  return { pixels, backend: backendName };
}

/* ========================================================================== */
/* Compare                                                                    */
/* ========================================================================== */

interface Diff {
  max: number;
  mean: number;
  over1: number;
  over2: number;
  over4: number;
  worstX: number;
}

function flipY(px: Uint8Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    out.set(px.subarray(src, src + W * 4), y * W * 4);
  }
  return out;
}

function compare(a: Uint8Array, b: Uint8Array): Diff {
  let max = 0;
  let sum = 0;
  let over1 = 0;
  let over2 = 0;
  let over4 = 0;
  let worstX = -1;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue; // alpha
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    n++;
    if (d > 1) over1++;
    if (d > 2) over2++;
    if (d > 4) over4++;
    if (d > max) {
      max = d;
      worstX = Math.floor((i / 4) % W);
    }
  }
  return { max, mean: sum / n, over1, over2, over4, worstX };
}

/* ========================================================================== */
/* Run                                                                        */
/* ========================================================================== */

interface Result {
  ok: boolean;
  error?: string;
  backend?: string;
  chart?: Diff;
  chartFlipped?: Diff;
  yRamp?: Diff;
  yRampFlipped?: Diff;
  orientation?: string;
}

async function run(): Promise<Result> {
  const chart = buildChart();
  const glsl = renderGlsl(chart);
  const { pixels: tsl, backend } = await renderTsl(chart);

  const yr = buildYRamp();
  const glslY = renderGlsl(yr);
  const { pixels: tslY } = await renderTsl(yr);

  const yStraight = compare(glslY, tslY);
  const yFlipped = compare(glslY, flipY(tslY));
  const orientation =
    yFlipped.mean < yStraight.mean ? 'FLIPPED (node arm is upside down vs GLSL)' : 'same';

  return {
    ok: true,
    backend,
    chart: compare(glsl, tsl),
    chartFlipped: compare(glsl, flipY(tsl)),
    yRamp: yStraight,
    yRampFlipped: yFlipped,
    orientation,
  };
}

const w = window as unknown as { __GRADE_AB__?: Result };

run()
  .then((r) => {
    w.__GRADE_AB__ = r;
    log(JSON.stringify(r, null, 2));
  })
  .catch((e: unknown) => {
    const r: Result = { ok: false, error: String(e) + '\n' + (e as Error)?.stack };
    w.__GRADE_AB__ = r;
    log(r.error ?? 'failed');
  });

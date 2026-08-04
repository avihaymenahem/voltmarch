/**
 * VOLTMARCH — src/render/post.ts
 * =============================================================================
 * The post-processing chain.
 *
 * ORDER (do not reorder without reading this):
 *
 *      RenderPass  ->  AO  ->  Bloom  ->  Grade  ->  SMAA
 *      [ HDR, linear, RGBA16F ..................]  [ LDR, sRGB ]
 *
 *  1. RenderPass draws the scene into a HALF-FLOAT target. The renderer's own
 *     tonemapping is switched OFF (`NoToneMapping`) for exactly this reason:
 *     values above 1.0 must survive to the bloom threshold. If tonemapping ran
 *     in the material shader, a 40x-bright tesla arc and a white concrete wall
 *     would both arrive at the bloom pass as ~1.0 and the whole image would
 *     haze. This is the single most common way an otherwise good-looking
 *     three.js scene ends up looking like a mobile game.
 *
 *  2. AO darkens ambient contact. It runs before bloom so that an occluded
 *     crevice cannot bloom.
 *
 *  3. Bloom thresholds in HDR just above sunlit white paint, so only a genuine
 *     specular glint or an emissive blooms.
 *
 *  4. Grade is where tonemapping actually happens: exposure -> ACES (or AgX)
 *     -> 3-way shadow/mid/highlight tint -> lift/gain -> GAMMA contrast about
 *     scene-linear 0.18 -> white point -> saturation (with separate shadow
 *     saturation) -> highlight-to-white rolloff -> vignette -> sRGB encode ->
 *     film grain. Chromatic aberration and an unsharp mask are folded into the
 *     same pass so we pay for one full-screen fetch, not three.
 *
 *     The contrast/white-point pair is the whole of scorecard #6 ("something in
 *     frame must reach white") and is documented at GRADE_PIVOT / GRADE_WHITE
 *     below. Both are deliberately curve constants rather than art-bible knobs:
 *     they define what "display white" MEANS for this game, and a mood that
 *     wants a different histogram moves `tone.exposure` and `tone.contrast`.
 *
 *  5. SMAA runs last, on the final LDR sRGB image, which is where edge
 *     detection actually wants to be. MSAA is off in the renderer; this is the
 *     AA path.
 *
 * GRACEFUL DEGRADATION
 * --------------------
 * Every pass is constructed inside its own try/catch and the AO pass is loaded
 * with a dynamic import. If anything throws, that pass is recorded in
 * `chain.failures` and simply omitted from the composer; if the composer
 * itself cannot be built we fall back to `renderer.render()` with ACESFilmic
 * tonemapping restored on the renderer. The game never fails to draw.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

import {
  RENDER_CONFIG,
  onConfigChanged,
  touched,
  srgbVec3,
  type RendererHandle,
  type ToneMappingMode,
} from './renderer';
import { LAYERS } from './scene';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export type PassId = 'render' | 'ao' | 'bloom' | 'grade' | 'smaa';

/**
 * The canonical order. Rationale is in the file header. Nobody edits this
 * array without editing that comment first.
 */
export const PASS_ORDER: readonly PassId[] = ['render', 'ao', 'bloom', 'grade', 'smaa'] as const;

const TONE_MODE_ID: Record<ToneMappingMode, number> = {
  none: 0,
  agx: 1,
  aces: 2,
  neutral: 3,
  linear: 0,
};

/* ========================================================================== */
/* Grade shader                                                               */
/* ========================================================================== */

const GRADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GRADE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec2  uTexel;          // 1 / resolution
uniform float uTime;

uniform float uExposure;
uniform int   uToneMode;       // 0 = passthrough, 1 = AgX, 2 = ACES, 3 = neutral

uniform vec3  uShadowTint;     // luma-normalised
uniform vec3  uMidTint;
uniform vec3  uHighTint;
uniform vec3  uLift;
uniform vec3  uGain;

uniform float uContrast;
uniform float uSaturation;
uniform float uShadowSaturation;

uniform float uVignette;
uniform float uVignetteSoftness;
uniform float uGrain;
uniform float uGrainSize;
uniform float uCA;
uniform float uSharpen;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Scene-linear middle grey. The contrast pivot: a pixel at exactly this value
 * is the one value the contrast stage cannot move.
 */
const float GRADE_PIVOT = 0.18;

/**
 * The graded scene-linear value that IS display white.
 *
 * Scorecard #6 requires p99 luminance >= 0.90 sRGB — i.e. something in the
 * frame must actually clip. Every filmic curve we can pick (AgX, ACES,
 * Khronos-neutral) asymptotes toward 1.0 and only gets there for inputs 15-20x
 * middle grey, which a noon RTS frame simply does not contain: the brightest
 * thing on screen is white concrete at ~1.0 scene-linear, and AgX maps that to
 * 0.67. Measured across all 12 shot scenarios the result was p99 0.61-0.89 with
 * ZERO clipped pixels anywhere.
 *
 * So the white point is declared rather than hoped for. Anything at or above
 * GRADE_WHITE after the contrast stage clips to paper white; the curve above
 * still rolls off smoothly because the tonemap has already compressed it.
 *
 * This is a NORMALISATION, not an exposure lift: it runs after the gamma
 * contrast has already pushed the shadows down, so the blacks it multiplies
 * are ~0.005 and stay ~0.006. Raising tone.exposure instead would move the
 * blacks and the mids by the same factor — bible risk R5, the exact instinct
 * that breaks scorecard #4 and #6-low.
 */
const float GRADE_WHITE = 0.94;

float luma(vec3 c) { return dot(c, LUMA); }

/* ---------------- AgX (Blender / Filament minimal implementation) --------- */

const mat3 AGX_IN = mat3(
  0.842479062253094,  0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772,  0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104
);
const mat3 AGX_OUT = mat3(
   1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
  -0.0990297440797205,-0.0989611768448433,  1.15107367264116
);

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return  15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232;
}

vec3 toneAgx(vec3 col) {
  col = AGX_IN * col;
  col = clamp(log2(max(col, 1e-10)), -12.47393, 4.026069);
  col = (col + 12.47393) / (4.026069 + 12.47393);
  col = agxContrast(col);
  col = AGX_OUT * col;
  // AgX emits display-encoded values; bring them back to linear so the rest of
  // the grade (and the final sRGB encode) operate in one consistent space.
  return pow(max(col, 0.0), vec3(2.2));
}

/* ---------------- ACES (Narkowicz fit) ------------------------------------ */

vec3 toneAces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/* ---------------- Khronos PBR neutral -------------------------------------- */

vec3 toneNeutral(vec3 col) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(col.r, min(col.g, col.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  col -= offset;
  float peak = max(col.r, max(col.g, col.b));
  if (peak < startCompression) return col;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  col *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(col, vec3(newPeak), g);
}

vec3 tonemap(vec3 c) {
  if (uToneMode == 1) return toneAgx(c);
  if (uToneMode == 2) return toneAces(c);
  if (uToneMode == 3) return toneNeutral(c);
  return c;
}

/* ---------------- sRGB encode --------------------------------------------- */

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

/* ---------------- grain --------------------------------------------------- */

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;

  /* --- chromatic aberration: radial, quadratic, edges only --------------- */
  vec3 col;
  if (uCA > 0.0001) {
    float r2 = dot(centered, centered);
    vec2 off = centered * uCA * (0.35 + r2 * 3.0);
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  /* --- unsharp mask ------------------------------------------------------ */
  if (uSharpen > 0.0001) {
    vec3 blur =
      texture2D(tDiffuse, uv + vec2( uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0,  uTexel.y)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb;
    blur *= 0.25;
    col += (col - blur) * uSharpen;
    col = max(col, 0.0);
  }

  /* --- exposure + tonemap ------------------------------------------------ */
  col *= uExposure;
  col = tonemap(col);

  /* --- 3-way colour ------------------------------------------------------ */
  float l = luma(col);
  float wS = 1.0 - smoothstep(0.0, 0.42, l);
  float wH = smoothstep(0.45, 1.0, l);
  float wM = max(0.0, 1.0 - wS - wH);
  float wsum = max(1e-4, wS + wM + wH);
  vec3 tint = (uShadowTint * wS + uMidTint * wM + uHighTint * wH) / wsum;
  col *= tint;

  /* --- lift / gain ------------------------------------------------------- */
  col = col * uGain + uLift * (1.0 - l);

  /* --- contrast: a GAMMA pivot at scene-linear 0.18 ----------------------
   * This used to be the affine (col - 0.18) * C + 0.18. An affine contrast
   * translates the whole curve: to gain 0.2 at the top it also SUBTRACTS a
   * fixed 0.2 * (C-1) everywhere, which slams a large fraction of the frame
   * flat onto zero and shows up as a hard, plastic-looking crush.
   *
   * A gamma pivot pins BOTH endpoints — 0 stays 0, GRADE_PIVOT stays
   * GRADE_PIVOT — and spends its entire budget on the slope, so the shadows
   * roll down smoothly while the top of the range expands into the white
   * point above. That is the "more contrast, not more brightness" the RA3
   * side-by-side is actually asking for.
   */
  col = GRADE_PIVOT * pow(max(col, 0.0) / GRADE_PIVOT, vec3(uContrast));

  /* --- highlight reach: declare the white point --------------------------- */
  col /= GRADE_WHITE;
  col = max(col, 0.0);

  /* --- saturation (shadows desaturate further) --------------------------- */
  float sat = uSaturation * mix(1.0, uShadowSaturation, wS);
  col = mix(vec3(luma(col)), col, sat);
  col = max(col, 0.0);

  /* --- blown highlights go to PAPER WHITE, not to a coloured clip ---------
   * Without this a clipped specular clamps per channel and comes out tinted
   * (1.0, 1.0, 0.74) — a yellow blob, not a highlight. Folding the overflow
   * back toward white is what a real sensor does, and it is also what keeps
   * scorecard #20 (saturation must fall as luminance rises) true at the very
   * top of the curve now that the top of the curve exists at all.
   */
  {
    float over = max(col.r, max(col.g, col.b)) - 1.0;
    col = mix(col, vec3(1.0), clamp(over, 0.0, 1.0));
  }

  /* --- vignette ---------------------------------------------------------- */
  if (uVignette > 0.0001) {
    float d = length(centered) * 1.41421356;
    float v = 1.0 - smoothstep(uVignetteSoftness, 1.18, d);
    col *= mix(1.0, v, uVignette);
  }

  /* --- display encode ---------------------------------------------------- */
  vec3 outCol = linearToSrgb(col);

  /* --- film grain (display space, mid-weighted) -------------------------- */
  if (uGrain > 0.0001) {
    vec2 gp = floor(gl_FragCoord.xy / max(uGrainSize, 0.5));
    float n = hash13(vec3(gp, floor(uTime * 24.0)));
    // Strongest in the mids, absent in blacks and blown highlights.
    float resp = 1.0 - abs(luma(outCol) * 2.0 - 1.0);
    outCol += (n - 0.5) * uGrain * resp * 2.0;
  }

  gl_FragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}
`;

interface GradeUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uTime: { value: number };
  uExposure: { value: number };
  uToneMode: { value: number };
  uShadowTint: { value: THREE.Vector3 };
  uMidTint: { value: THREE.Vector3 };
  uHighTint: { value: THREE.Vector3 };
  uLift: { value: THREE.Vector3 };
  uGain: { value: THREE.Vector3 };
  uContrast: { value: number };
  uSaturation: { value: number };
  uShadowSaturation: { value: number };
  uVignette: { value: number };
  uVignetteSoftness: { value: number };
  uGrain: { value: number };
  uGrainSize: { value: number };
  uCA: { value: number };
  uSharpen: { value: number };
  [key: string]: THREE.IUniform;
}

function makeGradeUniforms(): GradeUniforms {
  return {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uTime: { value: 0 },
    uExposure: { value: 0.90 },
    uToneMode: { value: TONE_MODE_ID.aces },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uMidTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighTint: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1.32 },
    uSaturation: { value: 1.02 },
    uShadowSaturation: { value: 0.94 },
    uVignette: { value: 0.20 },
    uVignetteSoftness: { value: 0.62 },
    uGrain: { value: 0.016 },
    uGrainSize: { value: 1.4 },
    uCA: { value: 0.0016 },
    uSharpen: { value: 0.40 },
  };
}

/** Normalise a colour so multiplying by it does not change overall luminance. */
const _tmpVec = new THREE.Vector3();
function lumaNormalized(hex: number, out: THREE.Vector3): THREE.Vector3 {
  srgbVec3(hex, _tmpVec);
  const l = 0.2126 * _tmpVec.x + 0.7152 * _tmpVec.y + 0.0722 * _tmpVec.z;
  const inv = l > 1e-4 ? 1 / l : 1;
  return out.set(_tmpVec.x * inv, _tmpVec.y * inv, _tmpVec.z * inv);
}

/* ========================================================================== */
/* PostChain                                                                  */
/* ========================================================================== */

export interface PostChain {
  /** null when the composer could not be constructed at all. */
  readonly composer: EffectComposer | null;
  /** Live pass instances by id. Missing = not constructed. */
  readonly passes: Readonly<Partial<Record<PassId, Pass>>>;
  /** Construction errors, keyed by pass id. Empty on a healthy boot. */
  readonly failures: Readonly<Partial<Record<PassId, string>>>;
  readonly enabled: boolean;
  /** True when the chain is actually driving the frame (composer alive+on). */
  readonly active: boolean;

  /** Draw one frame. Falls back to renderer.render() when inactive. */
  render(dt: number): void;
  setCamera(camera: THREE.Camera): void;
  setScene(scene: THREE.Scene): void;
  setEnabled(v: boolean): void;
  setPassEnabled(id: PassId, v: boolean): void;
  isPassEnabled(id: PassId): boolean;
  /** Re-read RENDER_CONFIG.post into every pass uniform. Cheap; no rebuilds. */
  syncConfig(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface CreatePostOptions {
  handle: RendererHandle;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export function createPostChain(options: CreatePostOptions): PostChain {
  const { handle } = options;
  const renderer = handle.renderer;
  let scene = options.scene;
  let camera = options.camera;

  const cfg = RENDER_CONFIG.post;
  const passes: Partial<Record<PassId, Pass>> = {};
  const failures: Partial<Record<PassId, string>> = {};
  const passEnabled: Record<PassId, boolean> = {
    render: true,
    ao: cfg.ao.enabled,
    bloom: cfg.bloom.enabled,
    grade: cfg.grade.enabled,
    smaa: cfg.smaa.enabled,
  };

  let composer: EffectComposer | null = null;
  let gradeUniforms: GradeUniforms | null = null;
  let elapsed = 0;
  let disposed = false;
  let enabled = cfg.enabled;
  let warnedDirt = false;

  const width = () => Math.max(2, handle.size.width);
  const height = () => Math.max(2, handle.size.height);

  /* ---- composer + HDR targets ------------------------------------------ */
  try {
    const rt = new THREE.WebGLRenderTarget(width(), height(), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace, // working (linear) space, not display
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    rt.texture.name = 'PostHDR';
    composer = new EffectComposer(renderer, rt);
    composer.renderToScreen = true;
  } catch (err) {
    failures.render = String(err);
    console.error('[post] EffectComposer construction failed — falling back to direct render', err);
    composer = null;
  }

  /* ---- individual passes ------------------------------------------------ */
  function build(id: PassId, factory: () => Pass): void {
    if (!composer) return;
    try {
      const p = factory();
      passes[id] = p;
    } catch (err) {
      failures[id] = String(err);
      console.warn(`[post] pass "${id}" failed to construct; continuing without it`, err);
    }
  }

  if (composer) {
    build('render', () => {
      const p = new RenderPass(scene, camera);
      p.clear = true;
      return p as unknown as Pass;
    });

    build('bloom', () => {
      const b = new UnrealBloomPass(
        new THREE.Vector2(width(), height()),
        cfg.bloom.strength,
        cfg.bloom.radius,
        cfg.bloom.threshold
      );
      return b as unknown as Pass;
    });

    build('grade', () => {
      gradeUniforms = makeGradeUniforms();
      const p = new ShaderPass({
        name: 'GradePass',
        uniforms: gradeUniforms as unknown as { [k: string]: THREE.IUniform },
        vertexShader: GRADE_VERT,
        fragmentShader: GRADE_FRAG,
      });
      return p as unknown as Pass;
    });

    build('smaa', () => {
      const p = new (SMAAPass as unknown as new (w?: number, h?: number) => Pass)(width(), height());
      return p;
    });
  }

  /* ---- AO (dynamic: GTAO if the build has it, else SSAO, else none) ------ */
  let aoReady: Promise<void> = Promise.resolve();
  if (composer) {
    aoReady = (async () => {
      try {
        const mod: any = await import('three/examples/jsm/postprocessing/GTAOPass.js');
        const GTAOPass = mod.GTAOPass;
        const p = new GTAOPass(scene, camera, width(), height());
        if (GTAOPass.OUTPUT) p.output = GTAOPass.OUTPUT.Default;
        installAoOccluderFilter(p);
        passes.ao = p as Pass;
        applyAoConfig();
        rebuild();
        if (DEV) console.info('[post] AO: GTAO');
        return;
      } catch (errGtao) {
        try {
          const mod: any = await import('three/examples/jsm/postprocessing/SSAOPass.js');
          const SSAOPass = mod.SSAOPass;
          const p = new SSAOPass(scene, camera, width(), height());
          if (SSAOPass.OUTPUT) p.output = SSAOPass.OUTPUT.Default;
          passes.ao = p as Pass;
          applyAoConfig();
          rebuild();
          if (DEV) console.info('[post] AO: SSAO (GTAO unavailable)');
          return;
        } catch (errSsao) {
          failures.ao = String(errGtao) + ' | ' + String(errSsao);
          console.warn('[post] no ambient-occlusion pass available; continuing without AO');
        }
      }
    })();
  }

  /**
   * KEEP NON-OCCLUDERS OUT OF THE AO NORMAL/DEPTH PREPASS.
   *
   * `GTAOPass` renders the whole scene a second time with a normal material to
   * build its G-buffer, and its own filter only skips Points and Lines. Every
   * transparent MESH therefore lands in that buffer as a solid, opaque
   * occluder — and the ground decal field is a flat sheet of quads lying on the
   * terrain, so GTAO reads a wall a few centimetres above the ground and
   * occludes everything under it. That is the hard-edged pure-black polygons in
   * `?shot=battle` and `?shot=naval`; the smoke layers add the same defect in
   * the air. Turning AO off made both disappear entirely, which is how this was
   * isolated: the decal SHADER was innocent (forcing its darkening floor to
   * 0.95 changed nothing).
   *
   * The predicate is the honest one: an object that does not write depth in the
   * main pass, or that is transparent, or that lives on the effects/overlay
   * layers, is not an occluder. It is also a straight perf win — the prepass
   * stops drawing the particle, beam and decal layers.
   */
  function installAoOccluderFilter(pass: unknown): void {
    const p = pass as {
      scene: THREE.Scene;
      _visibilityCache?: THREE.Object3D[];
      _overrideVisibility?: () => void;
    };
    const base = p._overrideVisibility;
    if (typeof base !== 'function') return;

    p._overrideVisibility = function overrideVisibility(this: typeof p): void {
      base.call(this);
      const cache = this._visibilityCache;
      if (cache === undefined) return;
      this.scene.traverse((o) => {
        if (!o.visible || !(o as THREE.Mesh).isMesh) return;
        if (aoOccluder(o as THREE.Mesh)) return;
        o.visible = false;
        cache.push(o);
      });
    };
  }

  function aoOccluder(mesh: THREE.Mesh): boolean {
    if (mesh.layers.isEnabled(LAYERS.EFFECTS) || mesh.layers.isEnabled(LAYERS.OVERLAY)) return false;
    const mat = mesh.material;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      if (m === undefined || m === null) continue;
      if (m.transparent === true || m.depthWrite === false) return false;
      if (m.blending !== THREE.NormalBlending && m.blending !== THREE.NoBlending) return false;
    }
    return true;
  }

  function applyAoConfig(): void {
    const ao = passes.ao as any;
    if (!ao) return;
    const c = cfg.ao;
    // GTAOPass
    if (typeof ao.updateGtaoMaterial === 'function') {
      try {
        ao.updateGtaoMaterial({
          radius: c.radius,
          distanceExponent: 1.0,
          thickness: 1.0,
          // GTAO's `scale` is the contrast curve on the AO term — this is
          // where the art bible's "power 1.6" lands.
          scale: c.power,
          samples: c.samples,
          screenSpaceRadius: false,
        });
      } catch {
        /* parameter shape drift between three versions — non-fatal */
      }
      if ('blendIntensity' in ao) ao.blendIntensity = c.intensity;
      if (ao.pdMaterial?.uniforms?.pdRadius) ao.pdMaterial.uniforms.pdRadius.value = c.halfRes ? 4 : 2;
    }
    // SSAOPass
    if ('kernelRadius' in ao) ao.kernelRadius = c.radius * 4;
    if ('minDistance' in ao) ao.minDistance = 0.002;
    if ('maxDistance' in ao) ao.maxDistance = 0.12;
    if ('kernelSize' in ao && typeof ao.kernelSize === 'number') ao.kernelSize = c.samples;
  }

  /* ---- composer pass ordering ------------------------------------------ */
  function rebuild(): void {
    if (!composer) return;
    composer.passes.length = 0;
    let last: Pass | null = null;
    for (const id of PASS_ORDER) {
      const p = passes[id];
      if (!p) continue;
      if (!passEnabled[id]) {
        p.enabled = false;
        continue;
      }
      p.enabled = true;
      p.renderToScreen = false;
      composer.addPass(p);
      last = p;
    }
    if (last) last.renderToScreen = true;

    // The renderer must NOT tonemap when the grade pass is doing it.
    const gradeLive = !!passes.grade && passEnabled.grade && enabled;
    handle.setToneMappingMode(gradeLive ? 'none' : RENDER_CONFIG.post.grade.mode);
  }

  /* ---- config -> uniforms ---------------------------------------------- */
  function syncConfig(): void {
    const bloom = passes.bloom as any;
    if (bloom) {
      bloom.threshold = cfg.bloom.threshold;
      // emissiveBoost is normalised so the bible's default pair
      // (strength 0.55, emissiveBoost 1.6) yields exactly 0.55. Raising
      // emissiveBoost raises the glow without touching the threshold, which is
      // the knob a critic actually wants ("the tesla coil should read hotter").
      bloom.strength = cfg.bloom.strength * Math.max(0.25, cfg.bloom.emissiveBoost / 1.6);
      bloom.radius = cfg.bloom.radius;
      const dirtUniform = bloom.compositeMaterial?.uniforms?.dirtTexture;
      if (!dirtUniform && cfg.bloom.lensDirt > 0 && !warnedDirt && DEV) {
        warnedDirt = true;
        console.info('[post] lens dirt not supported by this UnrealBloomPass build — ignored');
      }
    }

    if (gradeUniforms) {
      const g = cfg.grade;
      gradeUniforms.uExposure.value = g.exposure;
      gradeUniforms.uToneMode.value = TONE_MODE_ID[g.mode] ?? 1;
      lumaNormalized(g.shadowTint, gradeUniforms.uShadowTint.value);
      lumaNormalized(g.midTint, gradeUniforms.uMidTint.value);
      lumaNormalized(g.highlightTint, gradeUniforms.uHighTint.value);
      // lift is additive and must stay tiny; gain is a direct multiplier.
      srgbVec3(g.lift, gradeUniforms.uLift.value).multiplyScalar(0.5);
      srgbVec3(g.gain, gradeUniforms.uGain.value);
      gradeUniforms.uContrast.value = g.contrast;
      gradeUniforms.uSaturation.value = g.saturation;
      gradeUniforms.uShadowSaturation.value = g.shadowSaturation;
      gradeUniforms.uVignette.value = g.vignette;
      gradeUniforms.uVignetteSoftness.value = THREE.MathUtils.clamp(g.vignetteSoftness, 0.05, 1.15);
      gradeUniforms.uGrain.value = g.grain;
      gradeUniforms.uGrainSize.value = g.grainSize;
      gradeUniforms.uCA.value = g.chromaticAberration;
      gradeUniforms.uSharpen.value = g.sharpen;
    }

    applyAoConfig();

    // Toggles may have flipped in config; mirror them and re-order.
    let orderDirty = false;
    const want: Record<PassId, boolean> = {
      render: true,
      ao: cfg.ao.enabled,
      bloom: cfg.bloom.enabled,
      grade: cfg.grade.enabled,
      smaa: cfg.smaa.enabled,
    };
    for (const id of PASS_ORDER) {
      if (passEnabled[id] !== want[id]) {
        passEnabled[id] = want[id];
        orderDirty = true;
      }
    }
    if (enabled !== cfg.enabled) {
      enabled = cfg.enabled;
      orderDirty = true;
    }
    if (orderDirty) rebuild();
  }

  /* ---- size ------------------------------------------------------------- */
  function setSize(w: number, h: number): void {
    const pw = Math.max(2, Math.round(w));
    const ph = Math.max(2, Math.round(h));
    composer?.setSize(pw, ph);
    // EffectComposer.setSize takes drawing-buffer pixels; our handle already
    // reports those, so pixelRatio must stay at 1 inside the composer.
    (composer as any)?.setPixelRatio?.(1);
    for (const id of PASS_ORDER) {
      const p: any = passes[id];
      if (p && typeof p.setSize === 'function') {
        try {
          p.setSize(pw, ph);
        } catch (err) {
          console.warn(`[post] setSize failed for "${id}"`, err);
        }
      }
    }
    if (gradeUniforms) gradeUniforms.uTexel.value.set(1 / pw, 1 / ph);
  }

  const offResize = handle.onResize((size) => setSize(size.width, size.height));

  const offConfig = onConfigChanged((changed) => {
    if (touched(changed, 'post')) syncConfig();
  });

  rebuild();
  syncConfig();
  setSize(width(), height());

  /* ---- render ----------------------------------------------------------- */
  const chain: PostChain = {
    get composer() {
      return composer;
    },
    passes,
    failures,
    get enabled() {
      return enabled;
    },
    get active() {
      return !!composer && enabled && composer.passes.length > 0;
    },

    render(dt: number) {
      if (disposed) return;
      elapsed += dt;
      if (gradeUniforms) gradeUniforms.uTime.value = elapsed;

      if (composer && enabled && composer.passes.length > 0) {
        composer.render(dt);
      } else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    },

    setCamera(cam: THREE.Camera) {
      camera = cam;
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        if (p && 'camera' in p) p.camera = cam;
      }
    },

    setScene(s: THREE.Scene) {
      scene = s;
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        if (p && 'scene' in p) p.scene = s;
      }
    },

    setEnabled(v: boolean) {
      if (enabled === v) return;
      enabled = v;
      RENDER_CONFIG.post.enabled = v;
      rebuild();
    },

    setPassEnabled(id: PassId, v: boolean) {
      if (id === 'render') return;
      if (passEnabled[id] === v) return;
      passEnabled[id] = v;
      switch (id) {
        case 'ao':
          cfg.ao.enabled = v;
          break;
        case 'bloom':
          cfg.bloom.enabled = v;
          break;
        case 'grade':
          cfg.grade.enabled = v;
          break;
        case 'smaa':
          cfg.smaa.enabled = v;
          break;
      }
      rebuild();
    },

    isPassEnabled(id: PassId) {
      return !!passes[id] && passEnabled[id];
    },

    syncConfig,
    setSize,

    dispose() {
      if (disposed) return;
      disposed = true;
      offResize();
      offConfig();
      void aoReady;
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        try {
          p?.dispose?.();
        } catch {
          /* some passes have no dispose */
        }
        delete passes[id];
      }
      try {
        (composer as any)?.renderTarget1?.dispose?.();
        (composer as any)?.renderTarget2?.dispose?.();
        (composer as any)?.dispose?.();
      } catch {
        /* ignore */
      }
      composer = null;
      handle.setToneMappingMode(RENDER_CONFIG.post.grade.mode);
    },
  };

  if (DEV) {
    const built = PASS_ORDER.filter((id) => !!passes[id]);
    console.info(
      `[post] chain: ${built.join(' -> ')}${
        Object.keys(failures).length ? `  (failed: ${Object.keys(failures).join(', ')})` : ''
      }`
    );
  }

  return chain;
}

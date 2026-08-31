/**
 * VOLTMARCH — src/render/nodes/grade-node.ts
 * =============================================================================
 * THE GRADE, AS A TSL NODE GRAPH. Stage B of the WebGPU migration.
 *
 * A port of `GRADE_FRAG` in `src/render/post.ts`, stage for stage:
 *
 *     unsharp mask (luma only) -> exposure -> tonemap -> 3-way tint ->
 *     lift/gain -> gamma contrast about scene-linear 0.18 -> white point ->
 *     saturation (shadows desaturate further) -> blown-to-paper-white fold ->
 *     vignette -> rain/snow -> sRGB encode -> restrained film grain
 *
 * The reasoning for every one of those stages lives in `post.ts` and is NOT
 * repeated here; this file records only what is different about expressing it
 * as nodes. Read `post.ts` first.
 *
 * Chromatic aberration remains deliberately absent. The small film-grain path
 * is intentional art direction as of 2026-08-27 and is implemented here as well
 * as in GLSL so WebGPU remains the primary renderer. The same time uniform also
 * drives screen-space rain or snow without another pass or draw call.
 *
 * ── WHAT IS NOT ABSENT ───────────────────────────────────────────────────────
 * The unsharp mask IS ported, exactly, including the luma-only application. It
 * is live at 0.40, it is half of scorecard #34, and the per-channel form is a
 * chroma generator at high-contrast edges — the whole argument is in `post.ts`
 * above the stage. `uTexel` is a real uniform driven from `setSize`, for the
 * same reason: §5's third defect was the mask sampling a 1920x1080 texel grid
 * at 1440p, and a `screenSize`-derived texel would have hidden that class of bug
 * behind an inference instead of a value a test can read.
 *
 * ── THE MATRICES ARE DOT PRODUCTS, NOT `mat3` ────────────────────────────────
 * `GRADE_FRAG` writes the two AgX matrices as GLSL `mat3` literals, which are
 * COLUMN-major. WGSL's `mat3x3` constructor is also column-major, so a literal
 * transcription would probably have been right — "probably" being the problem.
 * The rows are written out as explicit `dot()`s below, which have one reading in
 * both languages, and `tests/post-nodes.spec.ts` finds the coefficients in the
 * compiled WGSL. A transposed AgX inset is a subtle, plausible-looking hue
 * shift, which is the worst kind of porting error to ship.
 */

import { Vector2, Vector3 } from 'three/webgpu';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn, If, abs, clamp, dot, float, floor, fract, int, length, log2, max, min, mix,
  pow, screenUV, sin, smoothstep, step, uniform, vec2, vec3, vec4,
} from 'three/tsl';

import type { GradeConfig } from '../renderer';
import {
  GRADE_LUMA,
  GRADE_PIVOT,
  GRADE_WHITE,
  TONE_MODE_ID,
  gradeUniformValuesFor,
  makeGradeUniformValues,
} from '../grade-curve';

/**
 * The two node types this pass is written in.
 *
 * TSL IS GENUINELY TYPED AND THIS FILE USES NO `any`. `@types/three` tracks a
 * node's component type in the type parameter, so `dot(vec3, vec3)` really does
 * hand back a `float` and passing one where a `vec3` belongs is a compile error.
 * That is worth having in a colour pipeline, where a stage applied to luminance
 * instead of to the triple is a plausible edit that looks right and desaturates
 * the frame. The only two casts in the file are named, adjacent, single-use and
 * documented at `stepVec3`.
 */
type Vec3 = Node<'vec3'>;
type Flt = Node<'float'>;

/**
 * The live uniform handles.
 *
 * THESE ARE THE OBJECTS THE COMPILED SHADER REFERENCES. A `UniformNode` is
 * captured by the graph itself and is never cloned, which is the structural
 * difference from `ShaderPass` that `docs/RENDER_FINDINGS.md` §5 is about: there
 * is no second copy for a write to land in. `tests/post-nodes.spec.ts` proves it
 * rather than asserting it — it writes through `applyGradeConfig`, compiles the
 * graph, and finds the value in the emitted uniform buffer.
 */
export interface GradeNodeUniforms {
  exposure: UniformNode<'float', number>;
  toneMode: UniformNode<'int', number>;
  shadowTint: UniformNode<'vec3', Vector3>;
  midTint: UniformNode<'vec3', Vector3>;
  highTint: UniformNode<'vec3', Vector3>;
  lift: UniformNode<'vec3', Vector3>;
  gain: UniformNode<'vec3', Vector3>;
  contrast: UniformNode<'float', number>;
  saturation: UniformNode<'float', number>;
  shadowSaturation: UniformNode<'float', number>;
  vignette: UniformNode<'float', number>;
  vignetteSoftness: UniformNode<'float', number>;
  grain: UniformNode<'float', number>;
  grainSize: UniformNode<'float', number>;
  time: UniformNode<'float', number>;
  rain: UniformNode<'float', number>;
  sharpen: UniformNode<'float', number>;
  /** 1 / resolution, in the INPUT texture's pixels. Driven by `setGradeTexel`. */
  texel: UniformNode<'vec2', Vector2>;
}

/**
 * Fresh uniform handles with the SHIPPED defaults, not with neutral ones.
 *
 * `makeGradeUniforms()` in `post.ts` defaults grain to 0.016 and CA to 0.0016 —
 * the exact pair that shipped live for the life of the pass, because those
 * literals were what the pass actually ran on. There is nothing to be gained
 * from a default that differs from config, so these come straight out of
 * `makeGradeUniformValues()` and are overwritten by `applyGradeConfig` before
 * the first frame regardless.
 */
export function createGradeUniforms(): GradeNodeUniforms {
  const v = makeGradeUniformValues();
  return {
    exposure: uniform(v.exposure) as UniformNode<'float', number>,
    // Explicit 'int': the shader compares it against integer literals, and a
    // float uniform compared with `==` is a portability question nobody wants.
    toneMode: uniform(v.toneMode, 'int') as UniformNode<'int', number>,
    shadowTint: uniform(new Vector3(1, 1, 1)) as UniformNode<'vec3', Vector3>,
    midTint: uniform(new Vector3(1, 1, 1)) as UniformNode<'vec3', Vector3>,
    highTint: uniform(new Vector3(1, 1, 1)) as UniformNode<'vec3', Vector3>,
    lift: uniform(new Vector3(0, 0, 0)) as UniformNode<'vec3', Vector3>,
    gain: uniform(new Vector3(1, 1, 1)) as UniformNode<'vec3', Vector3>,
    contrast: uniform(v.contrast) as UniformNode<'float', number>,
    saturation: uniform(v.saturation) as UniformNode<'float', number>,
    shadowSaturation: uniform(v.shadowSaturation) as UniformNode<'float', number>,
    vignette: uniform(v.vignette) as UniformNode<'float', number>,
    vignetteSoftness: uniform(v.vignetteSoftness) as UniformNode<'float', number>,
    grain: uniform(v.grain) as UniformNode<'float', number>,
    grainSize: uniform(v.grainSize) as UniformNode<'float', number>,
    time: uniform(0) as UniformNode<'float', number>,
    rain: uniform(0) as UniformNode<'float', number>,
    sharpen: uniform(v.sharpen) as UniformNode<'float', number>,
    texel: uniform(new Vector2(1 / 1920, 1 / 1080)) as UniformNode<'vec2', Vector2>,
  };
}

/** Scratch for `applyGradeConfig`. Module-private and reused; nothing allocates per frame. */
const _values = makeGradeUniformValues();

/**
 * Push `RENDER_CONFIG.post.grade` into the live uniforms.
 *
 * The whole mapping lives in `gradeUniformValuesFor` (pure, in `grade-curve.ts`,
 * tested against `THREE.Color`), so this function is nothing but the copy — and
 * that split is the point. The WebGL equivalent is eighteen assignments inside a
 * closure that needs a GL context to reach, which is why nobody could see that
 * it was writing into a detached object.
 */
export function applyGradeConfig(u: GradeNodeUniforms, cfg: GradeConfig): void {
  const v = gradeUniformValuesFor(cfg, _values);
  u.exposure.value = v.exposure;
  u.toneMode.value = v.toneMode;
  u.shadowTint.value.set(v.shadowTint.x, v.shadowTint.y, v.shadowTint.z);
  u.midTint.value.set(v.midTint.x, v.midTint.y, v.midTint.z);
  u.highTint.value.set(v.highTint.x, v.highTint.y, v.highTint.z);
  u.lift.value.set(v.lift.x, v.lift.y, v.lift.z);
  u.gain.value.set(v.gain.x, v.gain.y, v.gain.z);
  u.contrast.value = v.contrast;
  u.saturation.value = v.saturation;
  u.shadowSaturation.value = v.shadowSaturation;
  u.vignette.value = v.vignette;
  u.vignetteSoftness.value = v.vignetteSoftness;
  u.grain.value = v.grain;
  u.grainSize.value = v.grainSize;
  u.sharpen.value = v.sharpen;
}

/**
 * 1 / drawing-buffer size, for the unsharp mask.
 *
 * Its own function because `post.ts` records this as one of the four defects §5
 * uncovered: the mask sampled a 1920x1080 texel grid at 1440p because the write
 * that should have corrected it landed in a detached uniform. A named setter is
 * something a test can call and read back.
 */
export function setGradeTexel(u: GradeNodeUniforms, width: number, height: number): void {
  u.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
}

/* ========================================================================== */
/* The curve                                                                  */
/* ========================================================================== */

const LUMA = vec3(GRADE_LUMA[0], GRADE_LUMA[1], GRADE_LUMA[2]);

function luma(c: Vec3): Flt {
  return dot(c, LUMA);
}

function hash21(p: Node<'vec2'>): Flt {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

function rainLayer(
  pixel: Node<'vec2'>,
  time: Flt,
  spacing: number,
  cellHeight: number,
  speed: number,
  density: number,
  slant: number,
): Flt {
  // One short drop may occupy a cell. Randomising both its horizontal offset
  // and whether the cell is populated avoids the evenly spaced "barcode"
  // pattern produced by continuous screen-height lanes.
  const slantedX = pixel.x.add(pixel.y.mul(slant)).toVar();
  // f(y - t) moves toward increasing screen Y. The previous `+ time` made
  // every drop climb upward, which was especially obvious from the RTS camera.
  const fallingY = pixel.y.sub(time.mul(speed)).toVar();
  const grid = vec2(slantedX.div(spacing), fallingY.div(cellHeight)).toVar();
  const cell = floor(grid).toVar();
  const local = fract(grid).toVar();
  const random = hash21(cell.add(vec2(17, 53))).toVar();
  const centre = hash21(cell.add(vec2(3, 11))).mul(0.5).add(0.25).toVar();
  const line = float(1).sub(smoothstep(0.012, 0.050, abs(local.x.sub(centre))));
  const head = smoothstep(0.08, 0.15, local.y);
  const tail = float(1).sub(smoothstep(0.30, 0.44, local.y));
  const occupied = step(float(1 - density), random);
  return line.mul(head).mul(tail).mul(occupied).mul(random.mul(0.55).add(0.45));
}

function snowLayer(
  pixel: Node<'vec2'>,
  time: Flt,
  spacing: number,
  speed: number,
  drift: number,
  density: number,
): Flt {
  const moving = vec2(
    pixel.x.add(sin(time.mul(0.72).add(pixel.y.mul(0.012))).mul(drift)),
    pixel.y.sub(time.mul(speed)),
  ).toVar();
  const grid = moving.div(spacing).toVar();
  const cell = floor(grid).toVar();
  const local = fract(grid).sub(0.5).toVar();
  const random = hash21(cell.add(vec2(41, 19))).toVar();
  const centre = vec2(
    hash21(cell.add(vec2(7, 31))),
    hash21(cell.add(vec2(29, 5))),
  ).sub(0.5).mul(0.46).toVar();
  const flake = float(1).sub(smoothstep(0.025, 0.078, length(local.sub(centre))));
  return flake.mul(step(float(1 - density), random)).mul(random.mul(0.45).add(0.55));
}

/* ---------------- AgX (Blender / Filament minimal implementation) --------- */

/**
 * The AgX inset and outset matrices, as ROWS.
 *
 * Each row here is a column of the corresponding `mat3` literal in `GRADE_FRAG`
 * read across — see the file header for why the transcription goes through
 * `dot()` rather than through `mat3`.
 */
const AGX_IN_ROWS: readonly (readonly [number, number, number])[] = [
  [0.842479062253094, 0.0784335999999992, 0.0792237451477643],
  [0.0423282422610123, 0.878468636469772, 0.0791661274605434],
  [0.0423756549057051, 0.0784336, 0.879142973793104],
];

const AGX_OUT_ROWS: readonly (readonly [number, number, number])[] = [
  [1.19687900512017, -0.0980208811401368, -0.0990297440797205],
  [-0.0528968517574562, 1.15190312990417, -0.0989611768448433],
  [-0.0529716355144438, -0.0980434501171241, 1.15107367264116],
];

function applyRows(rows: readonly (readonly [number, number, number])[], c: Vec3): Vec3 {
  return vec3(
    dot(c, vec3(rows[0][0], rows[0][1], rows[0][2])),
    dot(c, vec3(rows[1][0], rows[1][1], rows[1][2])),
    dot(c, vec3(rows[2][0], rows[2][1], rows[2][2])),
  );
}

/** The AgX sigmoid, as the same sixth-order polynomial `GRADE_FRAG` uses. */
const agxContrast = (x: Vec3): Vec3 => {
  const x2 = x.mul(x);
  const x4 = x2.mul(x2);
  return x4.mul(x2).mul(15.5)
    .sub(x4.mul(x).mul(40.14))
    .add(x4.mul(31.96))
    .sub(x2.mul(x).mul(6.868))
    .add(x2.mul(0.4298))
    .add(x.mul(0.1191))
    .sub(0.00232);
};

function toneAgx(col: Vec3): Vec3 {
  let c: Vec3 = applyRows(AGX_IN_ROWS, col);
  c = clamp(log2(max(c, 1e-10)), -12.47393, 4.026069);
  c = c.add(12.47393).div(4.026069 + 12.47393);
  c = agxContrast(c);
  c = applyRows(AGX_OUT_ROWS, c);
  // AgX emits display-encoded values; bring them back to linear so the rest of
  // the grade (and the final sRGB encode) operate in one consistent space.
  return pow(max(c, 0), vec3(2.2, 2.2, 2.2));
}

/* ---------------- ACES (Narkowicz fit) ------------------------------------ */

function toneAces(x: Vec3): Vec3 {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return clamp(x.mul(x.mul(a).add(b)).div(x.mul(x.mul(c).add(d)).add(e)), 0, 1);
}

/* ---------------- Khronos PBR neutral -------------------------------------- */

/**
 * The one tonemapper with an early `return` in the GLSL, rebuilt as a real
 * branch rather than a `select`.
 *
 * `select` evaluates both operands, and the compressed operand divides by
 * `peak + d - startCompression`, which is ZERO at `peak == 0.52` — inside the
 * range the early return exists to protect. An `If` never computes it.
 */
function toneNeutral(col: Vec3): Vec3 {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;

  const c = vec3(col).toVar();
  const x = min(min(c.x, c.y), c.z).toVar();
  const offset = float(0.04).toVar();
  If(x.lessThan(0.08), () => {
    offset.assign(x.sub(x.mul(x).mul(6.25)));
  });
  c.subAssign(offset);

  const peak = max(max(c.x, c.y), c.z).toVar();
  const out = vec3(c).toVar();

  If(peak.greaterThanEqual(startCompression), () => {
    const d = 1.0 - startCompression;
    const newPeak = float(1.0).sub(float(d * d).div(peak.add(d - startCompression))).toVar();
    const scaled = c.mul(newPeak.div(peak)).toVar();
    const g = float(1.0).sub(float(1.0).div(newPeak.negate().add(peak).mul(desaturation).add(1.0)));
    out.assign(mix(scaled, vec3(newPeak), g));
  });

  return out;
}

/**
 * The runtime tone-mode branch, matching `GRADE_FRAG`'s `tonemap()`.
 *
 * Kept as a branch rather than resolved at graph-build time so that switching
 * mood (`?art=`, the Settings row) is a uniform write, exactly as it is today.
 * Rebuilding the graph on a mood change would recompile a pipeline mid-session,
 * which is the class of hitch `post.ts#warmUp` exists to prevent.
 */
function tonemap(col: Vec3, mode: Node<'int'>): Vec3 {
  const out = vec3(col).toVar();
  If(mode.equal(int(TONE_MODE_ID.agx)), () => {
    out.assign(toneAgx(col));
  }).ElseIf(mode.equal(int(TONE_MODE_ID.aces)), () => {
    out.assign(toneAces(col));
  }).ElseIf(mode.equal(int(TONE_MODE_ID.neutral)), () => {
    out.assign(toneNeutral(col));
  });
  return out;
}

/**
 * TWO NARROW CASTS, BOTH FOR THE SAME `@types/three` GAP, BOTH USED ONCE.
 *
 * The sRGB encode selects PER CHANNEL — a pixel can be above the linear-segment
 * knee in green and below it in blue, which is exactly what
 * `mix(a, b, step(0.0031308, c))` expresses and what `GRADE_FRAG` has always
 * done. GLSL and WGSL both accept a vector interpolant; `@types/three` declares
 * `mix`'s `t` as float-only (`MathNode.d.ts`) and does not surface `step`'s
 * vector overloads through `three/tsl` at all.
 *
 * Three's generator is not confused by either — the compiled WGSL reads
 * `mix( low, high, step( vec3<f32>( 0.0031308 ), c ) )`, which
 * `tests/post-nodes.spec.ts` finds in the emitted source. So this is a typings
 * shortfall, not a semantic one, and the honest fix is two named casts at the
 * one site rather than widening the encode — or, worse, collapsing the step to a
 * single channel, which would put a visible banding seam at the knee.
 */
const stepVec3 = step as unknown as (edge: Flt, x: Vec3) => Vec3;
const mixPerChannel = mix as unknown as (a: Vec3, b: Vec3, t: Vec3) => Vec3;

/** The sRGB display encode, per channel, exactly as `GRADE_FRAG` writes it. */
function linearToSrgb(c: Vec3): Vec3 {
  const v: Vec3 = clamp(c, 0, 1).toVar();
  const low = v.mul(12.92);
  const high = pow(v, vec3(1 / 2.4, 1 / 2.4, 1 / 2.4)).mul(1.055).sub(0.055);
  return mixPerChannel(low, high, stepVec3(float(0.0031308), v));
}

/* ========================================================================== */
/* The pass                                                                   */
/* ========================================================================== */

export interface GradeNodeOptions {
  /** The HDR, scene-linear image to grade. Must be samplable — the mask taps it. */
  input: TextureNode;
  uniforms: GradeNodeUniforms;
  /**
   * Where in the frame we are, 0..1. Defaults to `screenUV`; injectable so a
   * test can drive the graph from a known coordinate rather than from the
   * builder's screen state.
   */
  uvNode?: Node;
}

/**
 * Build the grade expression. Returns a `vec4` in DISPLAY space (sRGB-encoded,
 * alpha 1) — so whatever consumes it must NOT apply an output colour transform
 * of its own. `post-nodes.ts` clears `RenderPipeline.outputColorTransform` for
 * exactly this reason, which is the node-pipeline equivalent of `post.ts`
 * forcing `NoToneMapping` on the renderer whenever the grade pass is live.
 */
export function gradeNode(options: GradeNodeOptions): Node<'vec4'> {
  const { input, uniforms: u } = options;
  const uvNode: Node<'vec2'> = (options.uvNode ?? screenUV) as Node<'vec2'>;

  /**
   * ONE named sampler for the five taps below.
   *
   * `TextureNode.sample` is typed against the node's declared component type,
   * which the DSL cannot narrow through `.rgb`; the cast is confined to this one
   * line so the rest of the pass keeps its real `vec3`/`float` types and a
   * mistyped stage still fails `npm run typecheck`.
   */
  const tap = (at: Node<'vec2'>): Vec3 =>
    (input as unknown as { sample(uv: Node<'vec2'>): { rgb: Vec3 } }).sample(at).rgb;

  return Fn(() => {
    const centered = uvNode.sub(0.5).toVar();

    /* --- fetch. NO chromatic aberration branch: see the file header. ------ */
    const col = vec3(tap(uvNode)).toVar();

    /* --- unsharp mask: LUMA ONLY ------------------------------------------
     * Ported verbatim, including the reason it is a SCALE on the triple rather
     * than a per-channel add. `post.ts` carries the measurement: the per-channel
     * form put 15 265 pixels of `08-naval-water` at hue exactly 120.0 with
     * R == B, i.e. ringing masquerading as art, and metrics #36 read 0.78-1.02
     * against RA3's 0.512.
     */
    If(u.sharpen.greaterThan(0.0001), () => {
      const texel = u.texel;
      const blur = tap(uvNode.add(vec2(texel.x, 0)))
        .add(tap(uvNode.add(vec2(texel.x.negate(), 0))))
        .add(tap(uvNode.add(vec2(0, texel.y))))
        .add(tap(uvNode.add(vec2(0, texel.y.negate()))))
        .mul(0.25).toVar();
      const lc = luma(col).toVar();
      const ls = lc.add(lc.sub(luma(blur)).mul(u.sharpen)).toVar();
      col.mulAssign(max(ls, 0).div(max(lc, 1e-4)));
      col.assign(max(col, 0));
    });

    /* --- exposure + tonemap ------------------------------------------------ */
    col.mulAssign(u.exposure);
    col.assign(tonemap(col, u.toneMode));

    /* --- 3-way colour ------------------------------------------------------ */
    const l = luma(col).toVar();
    const wS = float(1).sub(smoothstep(0.0, 0.42, l)).toVar();
    const wH = smoothstep(0.45, 1.0, l).toVar();
    const wM = max(float(0), float(1).sub(wS).sub(wH)).toVar();
    const wsum = max(float(1e-4), wS.add(wM).add(wH));
    const tint = u.shadowTint.mul(wS).add(u.midTint.mul(wM)).add(u.highTint.mul(wH)).div(wsum);
    col.mulAssign(tint);

    /* --- lift / gain ------------------------------------------------------- */
    col.assign(col.mul(u.gain).add(u.lift.mul(float(1).sub(l))));

    /* --- contrast: a GAMMA pivot at scene-linear 0.18 ---------------------- */
    col.assign(pow(max(col, 0).div(GRADE_PIVOT), vec3(u.contrast, u.contrast, u.contrast)).mul(GRADE_PIVOT));

    /* --- highlight reach: declare the white point -------------------------- */
    col.divAssign(GRADE_WHITE);
    col.assign(max(col, 0));

    /* --- saturation (shadows desaturate further) --------------------------- */
    const sat = u.saturation.mul(mix(float(1), u.shadowSaturation, wS)).toVar();
    col.assign(mix(vec3(luma(col)), col, sat));
    col.assign(max(col, 0));

    /* --- blown highlights go to PAPER WHITE, not to a coloured clip -------- */
    const over = max(max(col.x, col.y), col.z).sub(1.0).toVar();
    col.assign(mix(col, vec3(1, 1, 1), clamp(over, 0, 1)));

    /* --- vignette ---------------------------------------------------------- */
    If(u.vignette.greaterThan(0.0001), () => {
      const d = length(centered).mul(1.41421356).toVar();
      const v = float(1).sub(smoothstep(u.vignetteSoftness, float(1.18), d));
      col.mulAssign(mix(float(1), v, u.vignette));
    });

    const rainAmount = max(u.rain, 0).toVar();
    const snowAmount = max(float(0).sub(u.rain), 0).toVar();

    /* --- rain: screen-space streaks plus a restrained cool, wet grade. ------ */
    If(rainAmount.greaterThan(0.0001), () => {
      const grey = vec3(luma(col)).toVar();
      const wet = mix(grey, col, 0.82).mul(vec3(0.92, 0.96, 1.02)).toVar();
      col.assign(mix(col, wet, rainAmount.mul(0.16)));
      col.mulAssign(float(1).sub(rainAmount.mul(0.03)));
    });
    If(snowAmount.greaterThan(0.0001), () => {
      const grey = vec3(luma(col)).toVar();
      const snowAir = mix(grey, col, 0.88).mul(vec3(0.98, 1, 1.03)).toVar();
      col.assign(mix(col, snowAir, snowAmount.mul(0.12)));
    });

    const outCol = vec3(linearToSrgb(col)).toVar();

    If(rainAmount.greaterThan(0.0001), () => {
      const pixel = uvNode.div(u.texel).toVar();
      const nearRain = rainLayer(pixel, u.time, 30, 120, 980, 0.18, 0.31).mul(0.085).toVar();
      const farRain = rainLayer(pixel.add(vec2(71, 29)), u.time, 20, 82, 760, 0.09, 0.24)
        .mul(0.038)
        .mul(smoothstep(0.42, 0.9, rainAmount));
      const streak = nearRain.add(farRain).mul(rainAmount);
      outCol.addAssign(vec3(0.68, 0.78, 0.90).mul(streak));
    });
    If(snowAmount.greaterThan(0.0001), () => {
      const pixel = uvNode.div(u.texel).toVar();
      const nearSnow = snowLayer(pixel, u.time, 34, 78, 20, 0.34).mul(0.12).toVar();
      const farSnow = snowLayer(pixel.add(vec2(83, 47)), u.time, 18, 132, 11, 0.20)
        .mul(0.055)
        .mul(smoothstep(0.42, 0.9, snowAmount));
      outCol.addAssign(vec3(0.91, 0.95, 1).mul(nearSnow.add(farSnow).mul(snowAmount)));
    });

    /* --- film grain: display-space, mid-weighted, intentionally subtle. ---- */
    If(u.grain.greaterThan(0.0001), () => {
      const pixel = floor(uvNode.div(u.texel).div(max(u.grainSize, 0.5))).toVar();
      const frame = floor(u.time.mul(12)).toVar();
      const noise = hash21(pixel.add(vec2(frame, frame.mul(0.37))));
      const response = float(1).sub(abs(luma(outCol).mul(2).sub(1)));
      outCol.addAssign(noise.sub(0.5).mul(u.grain).mul(response).mul(2));
    });

    return vec4(clamp(outCol, 0, 1), 1.0);
  })() as Node<'vec4'>;
}

/**
 * The two curve constants the shader BAKES IN as literals, re-exported so a test
 * can look for them in the compiled WGSL without importing the whole chain.
 * They are declared in `grade-curve.ts`; this is a view, not a second copy.
 */
export const GRADE_NODE_CONSTANTS = {
  pivot: GRADE_PIVOT,
  white: GRADE_WHITE,
} as const;

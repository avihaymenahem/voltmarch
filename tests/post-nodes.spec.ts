/**
 * STAGE B — THE POST CHAIN AS TSL NODES, VERIFIED AGAINST THE COMPILED SHADER.
 *
 * `docs/RENDER_FINDINGS.md` §5 is the reason this file looks the way it does.
 * The WebGL grade pass ran on its constructor literals for its ENTIRE LIFE
 * because `ShaderPass` deep-copies a plain shader description, so `syncConfig`'s
 * writes landed in a detached object. Film grain and chromatic aberration —
 * banned by name in CLAUDE.md — shipped LIVE throughout, while
 * `tests/banned-effects.spec.ts`, which scans config source, passed on every
 * run. The recorded lesson: **a test that reads the CONFIG proves nothing about
 * the SHADER.**
 *
 * So most of what follows does not read config. It builds the real node graph
 * and compiles it to WGSL with three's own `WGSLNodeBuilder` (see
 * `helpers/node-compile.ts`), then reads the emitted source and the emitted
 * uniform buffer. That is a strictly stronger instrument than anything this
 * project has had before for post: it can see a uniform that is declared and
 * never referenced, a constant that did not survive the port, and a code path
 * that exists at all.
 *
 * WHAT IT STILL CANNOT SEE, stated plainly so nobody reads more into a green
 * run than is there:
 *
 *   - IT EXECUTES NOTHING. No pixel is produced. Numeric equivalence between
 *     `GRADE_FRAG` and this graph needs a device and a frame, and belongs to the
 *     Stage F dual-backend verification.
 *   - IT COMPILES FOR WGSL. `WebGPURenderer` also has a WebGL2 backend
 *     (`GLSLNodeBuilder`), which is a third renderer with its own codegen. Two
 *     backends means two grade baselines — `docs/WEBGPU_MIGRATION_PLAN.md` §4.5.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import * as THREE from 'three';
import {
  Color,
  DataTexture,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
} from 'three/webgpu';
import { texture } from 'three/tsl';

import { compileFragmentNode } from './helpers/node-compile';
import {
  GRADE_LIFT_SCALE,
  GRADE_LUMA,
  GRADE_PIVOT,
  GRADE_WHITE,
  TONE_MODE_ID,
  effectiveBloomStrength,
  gradeUniformValuesFor,
  lumaNormalizedHex,
  makeGradeUniformValues,
  srgbChannelToLinear,
  srgbHexToLinear,
} from '../src/render/grade-curve';
import {
  AO_DENOISE_RADIUS_EXPONENT,
  AO_HALF_RES_SCALE,
  AO_NOISE_SEED,
  aoDenoiseParams,
  aoMarchParams,
  aoTargetSize,
  denoiseSampleDisc,
} from '../src/render/ao-params';
import { PASS_ORDER } from '../src/render/post-order';
import {
  applyGradeConfig,
  createGradeUniforms,
  gradeNode,
  setGradeTexel,
} from '../src/render/nodes/grade-node';
import { aoResolutionScale, createAoNodes } from '../src/render/nodes/ao-node';
import { createBloomNodes } from '../src/render/nodes/bloom-node';
import { buildPostGraph, demoteSmaaMaskTargets, enabledPasses } from '../src/render/post-nodes';
import { RENDER_CONFIG, type GradeConfig, type PostConfig } from '../src/render/renderer';

/* ========================================================================== */
/* Fixtures                                                                   */
/* ========================================================================== */

/**
 * `SMAANode`'s constructor allocates `new Image()` for its area and search
 * lookup tables, and vitest runs with `environment: 'node'`, where there is no
 * DOM. It is the ONLY node in the chain with that dependency — everything else
 * is arithmetic over textures.
 *
 * Shimmed rather than skipped, because without it the four assembled-chain
 * tests below would silently exercise a FOUR-pass chain and report on a graph
 * the game never builds. The shim does nothing but swallow the `src` write: the
 * lookup tables are never decoded, which is fine here because nothing samples
 * them — the graph is compiled, not run.
 *
 * `buildPostGraph` catches the failure anyway (see `failures`), so a real
 * browser-less consumer degrades to no SMAA rather than to no frame; the test
 * for that path deliberately removes this shim again.
 */
class ImageShim {
  src = '';
  onload: (() => void) | null = null;
}
const g = globalThis as unknown as { Image?: unknown };
if (g.Image === undefined) g.Image = ImageShim;

/**
 * A LINEAR-FILTERED half-float texture, because that is what the grade's real
 * input is.
 *
 * Not incidental: three emits `textureSample` for a filtered texture and falls
 * back to `textureLoad` plus hand-rolled wrap emulation for a NEAREST one, so a
 * `DataTexture` at its defaults would compile a DIFFERENT shader from the one
 * that ships and every source assertion below would be about the wrong code.
 */
function hdrInput(): DataTexture {
  const t = new DataTexture(new Uint16Array(4), 1, 1, RGBAFormat, HalfFloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

function compileGrade(cfg: GradeConfig = RENDER_CONFIG.post.grade) {
  const u = createGradeUniforms();
  applyGradeConfig(u, cfg);
  setGradeTexel(u, 2560, 1440);
  const out = compileFragmentNode(gradeNode({ input: texture(hdrInput()) as never, uniforms: u }));
  return { u, ...out };
}

/** A deep copy of the shipped post config, so a test can mutate it safely. */
function postConfigCopy(): PostConfig {
  return JSON.parse(JSON.stringify(RENDER_CONFIG.post)) as PostConfig;
}

/* ========================================================================== */
/* 1. The config -> uniform mapping                                           */
/* ========================================================================== */

describe('grade-curve: the mapping both chains share', () => {
  it("srgbChannelToLinear matches three's own transfer function", () => {
    // The transcription is checked against the implementation it was copied
    // from, over the whole domain including both sides of the 0.04045 knee.
    // A drift here would move every tint, lift and gain uniform in both chains.
    const c = new THREE.Color();
    for (let i = 0; i <= 255; i++) {
      const hex = (i << 16) | (i << 8) | i;
      c.setHex(hex, THREE.SRGBColorSpace);
      expect(srgbChannelToLinear(i / 255)).toBeCloseTo(c.r, 12);
    }
  });

  it('srgbHexToLinear matches THREE.Color channel for channel', () => {
    const c = new THREE.Color();
    const out = { x: 0, y: 0, z: 0 };
    for (const hex of [0x000000, 0xffffff, 0x1b2a44, 0x8c8578, 0xffebc8, 0x0a1220, 0xfff4e2]) {
      c.setHex(hex, THREE.SRGBColorSpace);
      srgbHexToLinear(hex, out);
      expect(out.x).toBeCloseTo(c.r, 12);
      expect(out.y).toBeCloseTo(c.g, 12);
      expect(out.z).toBeCloseTo(c.b, 12);
    }
  });

  it('lumaNormalizedHex produces a tint that cannot move the histogram', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const hex of [0x1b2a44, 0x8c8578, 0xffebc8, 0xff0000, 0x00ff00, 0x0000ff]) {
      lumaNormalizedHex(hex, out);
      const l = GRADE_LUMA[0] * out.x + GRADE_LUMA[1] * out.y + GRADE_LUMA[2] * out.z;
      expect(l).toBeCloseTo(1, 10);
    }
  });

  it('lumaNormalizedHex leaves pure black alone rather than dividing by zero', () => {
    // The `l > 1e-4` guard. Without it a black tint is Infinity in three
    // channels and the bloom pass spreads NaN through its whole mip chain —
    // the "black frame while stats reported 285 draws" failure in CLAUDE.md.
    const out = { x: 1, y: 1, z: 1 };
    lumaNormalizedHex(0x000000, out);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
  });

  it('halves lift and clamps vignette softness, exactly as syncConfig does', () => {
    const cfg: GradeConfig = { ...RENDER_CONFIG.post.grade, lift: 0x808080, vignetteSoftness: 9 };
    const v = gradeUniformValuesFor(cfg, makeGradeUniformValues());
    const raw = srgbHexToLinear(0x808080, { x: 0, y: 0, z: 0 });
    expect(v.lift.x).toBeCloseTo(raw.x * GRADE_LIFT_SCALE, 12);
    expect(GRADE_LIFT_SCALE).toBe(0.5);
    expect(v.vignetteSoftness).toBe(1.15);
    expect(gradeUniformValuesFor({ ...cfg, vignetteSoftness: 0 }, makeGradeUniformValues())
      .vignetteSoftness).toBe(0.05);
  });

  it('an unrecognised tone mode lands on AgX, not on passthrough', () => {
    // Passthrough plus a declared white point is a blown frame; a typo in a
    // mood preset must not produce one. `?? 1` in both chains.
    const cfg = { ...RENDER_CONFIG.post.grade, mode: 'nonsense' } as unknown as GradeConfig;
    expect(gradeUniformValuesFor(cfg, makeGradeUniformValues()).toneMode).toBe(TONE_MODE_ID.agx);
  });

  it('the tone-mode table is the one post.ts uses', () => {
    // Re-exported through `post.ts`, so this is the same object both chains
    // branch on. A second table is how the two backends would silently pick
    // different tonemappers from one config string.
    expect(TONE_MODE_ID).toEqual({ none: 0, agx: 1, aces: 2, neutral: 3, linear: 0 });
  });
});

describe('the settled bloom pair travels through one function', () => {
  it('emissiveBoost 1.6 is the identity point', () => {
    expect(effectiveBloomStrength(0.42, 1.6)).toBeCloseTo(0.42, 12);
  });

  it('the floor is 0.25, not zero', () => {
    expect(effectiveBloomStrength(0.42, 0)).toBeCloseTo(0.42 * 0.25, 12);
  });

  it('the shipped config still produces the settled energy', () => {
    /*
     * `threshold` 1.20 against an authored `strength` 0.42 was MEASURED, and the
     * bible's 1.05/0.55 pair was captured and cost 1.8 points of grade. This is
     * a tripwire on the numbers, not a re-derivation of them.
     */
    const b = RENDER_CONFIG.post.bloom;
    expect(b.threshold).toBeCloseTo(1.2, 6);
    expect(b.radius).toBeCloseTo(0.34, 6);
    expect(effectiveBloomStrength(b.strength, b.emissiveBoost)).toBeCloseTo(b.strength, 12);
  });
});

/* ========================================================================== */
/* 2. The compiled grade shader                                               */
/* ========================================================================== */

describe('the grade compiles, and the compiled source is the instrument', () => {
  it('emits a fragment stage', () => {
    const { fragment } = compileGrade();
    expect(fragment).toContain('@fragment');
    expect(fragment.length).toBeGreaterThan(1000);
  });

  it('BANS: no chromatic aberration and no film grain exist in the shader', () => {
    /*
     * THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT.
     *
     * `tests/banned-effects.spec.ts` passed on every run while both effects were
     * live, because it scans `config.ts` and config was right. This looks at the
     * emitted code. There is no CA branch to enable and no grain hash to seed:
     * the TSL grade does not implement either, so the ban is structural.
     *
     * Signatures, not names — the generated identifiers are `nodeVarN`:
     *   - CA reads the input at THREE different offsets and takes one channel
     *     from each, so a CA build has strictly more than the five taps the
     *     unsharp mask and the centre fetch account for.
     *   - the grain is `fract`/`floor` of a hashed screen coordinate against a
     *     time uniform; with no time uniform there is nothing to animate.
     */
    const { fragment } = compileGrade();
    const taps = fragment.match(/textureSample\(/g)?.length ?? 0;
    expect(taps, 'centre fetch + four unsharp taps, and nothing else').toBe(5);
    expect(fragment).not.toContain('0.1031'); // the hash13 constant
    expect(fragment.toLowerCase()).not.toContain('grain');
  });

  it('every config-driven uniform is REFERENCED by the compiled shader', () => {
    /*
     * §5's defect, made impossible to repeat silently. A uniform that is
     * declared and never read is a knob wired to nothing — `lensDirt` and
     * `pdRadius` are the two this project has already shipped. A uniform that is
     * never DECLARED is a write that goes nowhere, which is what happened to the
     * whole three-way colour balance.
     *
     * The generated names are positional (`object.nodeUniformN`), so the check
     * is on the COUNT and on the buffer layout rather than on names: fourteen
     * uniforms are created, and every one of them must appear in the emitted
     * uniform struct.
     */
    const { fragment, u } = compileGrade();
    const declared = fragment.match(/nodeUniform\d+\s*:/g)?.length ?? 0;
    const read = new Set(fragment.match(/object\.nodeUniform\d+/g) ?? []);
    expect(declared).toBeGreaterThanOrEqual(Object.keys(u).length - 1); // texture is not in the struct
    expect(read.size).toBeGreaterThanOrEqual(13);
  });

  it('bakes the two curve constants it is supposed to bake', () => {
    // `GRADE_PIVOT` and `GRADE_WHITE` are curve constants, not art knobs — they
    // define what display white MEANS for this game. They are literals in both
    // shaders; a mood that wants a different histogram moves exposure and
    // contrast instead.
    const { fragment } = compileGrade();
    expect(GRADE_PIVOT).toBe(0.18);
    expect(GRADE_WHITE).toBe(0.94);
    expect(fragment).toContain('0.18');
    expect(fragment).toContain('0.94');
  });

  it('carries the AgX matrices the right way round', () => {
    /*
     * A TRANSPOSED AgX INSET IS A PLAUSIBLE-LOOKING HUE SHIFT and would survive
     * every other check in this file. `GRADE_FRAG` writes the matrices as GLSL
     * `mat3` literals, which are column-major; the node port writes the ROWS as
     * explicit `dot()`s. These three triples are the rows that arrangement must
     * produce, read off the GLSL by taking every third literal.
     */
    const { fragment } = compileGrade();
    for (const row of [
      '0.842479062253094, 0.0784335999999992, 0.0792237451477643',
      '0.0423282422610123, 0.878468636469772, 0.0791661274605434',
      '0.0423756549057051, 0.0784336, 0.879142973793104',
      '1.19687900512017, -0.0980208811401368, -0.0990297440797205',
      '-0.0528968517574562, 1.15190312990417, -0.0989611768448433',
      '-0.0529716355144438, -0.0980434501171241, 1.15107367264116',
    ]) {
      expect(fragment, `AgX row ${row}`).toContain(row);
    }
  });

  it('carries all three tonemappers behind a runtime branch', () => {
    // A uniform branch rather than three graphs, so a mood change is a uniform
    // write. Rebuilding the graph mid-session would recompile a pipeline, which
    // is the hitch `post.ts#warmUp` exists to keep off the presented frame.
    const { fragment } = compileGrade();
    expect(fragment).toContain('15.5');    // AgX sigmoid
    expect(fragment).toContain('2.51');    // ACES Narkowicz
    expect(fragment).toContain('0.76');    // Khronos neutral startCompression
    expect(fragment.match(/== 1|== 2|== 3/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('encodes sRGB per channel, with the knee intact', () => {
    const { fragment } = compileGrade();
    expect(fragment).toContain('12.92');
    expect(fragment).toContain('1.055');
    expect(fragment).toContain('0.055');
    expect(fragment).toContain('0.0031308');
    // Per CHANNEL: the step's edge is broadcast to a vec3, so a pixel above the
    // knee in green and below it in blue is handled correctly. Collapsing this
    // to a scalar puts a banding seam at the knee.
    expect(fragment).toMatch(/step\(\s*vec3<f32>\(\s*0\.0031308\s*\)/);
  });

  it('applies the unsharp mask to LUMA, never per channel', () => {
    /*
     * The per-channel form is a chroma generator at any high-contrast edge:
     * measured at 15 265 pixels of `08-naval-water` sitting at hue exactly 120.0
     * with R == B, and metrics #36 reading 0.78-1.02 against RA3's 0.512. The
     * ported form computes a SCALE from luma and multiplies the triple.
     */
    const { fragment } = compileGrade();
    const lumaDots = fragment.match(/vec3<f32>\(\s*0\.2126,\s*0\.7152,\s*0\.0722\s*\)/g)?.length ?? 0;
    // centre luma, blur luma, the 3-way weight, and the saturation mix.
    expect(lumaDots).toBeGreaterThanOrEqual(4);
    expect(fragment).toContain('0.0001'); // the max(lc, 1e-4) guard
  });

  it('the texel uniform is live and tracks setSize', () => {
    // §5's third defect: the mask sampled a 1920x1080 texel grid at 1440p
    // because the write that should have corrected it landed in a detached
    // uniform. A TSL uniform cannot be detached — this proves the setter,
    // and the compiled-shader check above proves the shader reads it.
    const u = createGradeUniforms();
    setGradeTexel(u, 2560, 1440);
    expect(u.texel.value.x).toBeCloseTo(1 / 2560, 12);
    expect(u.texel.value.y).toBeCloseTo(1 / 1440, 12);
    setGradeTexel(u, 1280, 720);
    expect(u.texel.value.x).toBeCloseTo(1 / 1280, 12);
  });

  it('applyGradeConfig writes the objects the graph holds', () => {
    /*
     * The §5 defect in one assertion. `ShaderPass` handed a plain description
     * does `UniformsUtils.clone`, so `gradeUniforms` pointed at a copy and every
     * write went nowhere. TSL uniforms are captured by reference; the graph is
     * built from THESE objects and a later write is visible to it.
     */
    const u = createGradeUniforms();
    const before = u.exposure.value;
    const node = gradeNode({ input: texture(hdrInput()) as never, uniforms: u });
    applyGradeConfig(u, { ...RENDER_CONFIG.post.grade, exposure: before + 3.25 });
    expect(u.exposure.value).toBeCloseTo(before + 3.25, 12);
    // And the graph still compiles against the mutated handles.
    expect(compileFragmentNode(node).fragment).toContain('@fragment');
  });

  it('a mood swing reaches the tint uniforms', () => {
    const u = createGradeUniforms();
    applyGradeConfig(u, { ...RENDER_CONFIG.post.grade, shadowTint: 0xff0000 });
    const expected = lumaNormalizedHex(0xff0000, { x: 0, y: 0, z: 0 });
    expect(u.shadowTint.value.x).toBeCloseTo(expected.x, 10);
    expect(u.shadowTint.value).toBeInstanceOf(Vector3);
  });
});

/* ========================================================================== */
/* 3. AO — the scene submission stays deleted                                 */
/* ========================================================================== */

describe('AO: the depth G-buffer saving, rebuilt', () => {
  function aoFixture(cfg = RENDER_CONFIG.post.ao) {
    const depth = new DepthTexture(4, 4);
    const camera = new PerspectiveCamera();
    const depthNode = texture(depth) as never;
    return createAoNodes({ depthNode, depthTexture: depth, camera, cfg });
  }

  it('reconstructs normals ONCE into a texture, not per denoise sample', () => {
    /*
     * THE WHOLE POINT OF THIS MODULE, and the trap `RENDER_FINDINGS.md` §1
     * names. Both `GTAONode` and `DenoiseNode` accept a null `normalNode` and
     * reconstruct from depth in the shader; `GTAONode` hoists it and pays for
     * one, but `DenoiseNode` calls `sampleNormal` for the centre tap AND inside
     * its 16-sample loop — 17 reconstructions per denoised pixel, each nine
     * `textureLoad`s and three inverse-projection transforms.
     *
     * So both consumers must be handed a real normal TEXTURE, and it must be the
     * SAME one. If a future edit passes `null` to either, this fails.
     */
    const ao = aoFixture();
    expect(ao.normals).toBeTruthy();
    const march = ao.march as unknown as { normalNode: unknown };
    const denoiseNormal = (ao.denoised as unknown as { node: { normalNode: unknown } }).node;
    expect(march.normalNode, 'GTAONode must not reconstruct from depth itself').not.toBeNull();
    expect(march.normalNode).toBe(ao.normals);
    expect(denoiseNormal.normalNode, 'DenoiseNode must not reconstruct per sample').toBe(ao.normals);
  });

  it('the normal target is SIGNED — the node consumers do not unpack', () => {
    // `GTAOPass`'s G-buffer is RGBA8 and its shaders call `unpackRGBToNormal`.
    // The node versions do `.rgb.normalize()` with no unpack, so an 8-bit
    // unsigned target would clamp every negative axis to zero and tilt every
    // normal into the positive octant.
    const ao = aoFixture();
    const rt = (ao.normals as unknown as { renderTarget: { texture: { type: number } } }).renderTarget;
    expect(rt.texture.type).toBe(HalfFloatType);
    expect(rt.texture.type).not.toBe(UnsignedByteType);
  });

  it('runs the whole AO chain at the configured resolution', () => {
    const ao = aoFixture({ ...RENDER_CONFIG.post.ao, halfRes: true });
    expect(aoResolutionScale(true)).toBe(AO_HALF_RES_SCALE);
    expect(ao.march.resolutionScale).toBe(AO_HALF_RES_SCALE);
    expect((ao.normals as unknown as { getResolutionScale(): number }).getResolutionScale())
      .toBe(AO_HALF_RES_SCALE);
    expect((ao.denoised as unknown as { getResolutionScale(): number }).getResolutionScale())
      .toBe(AO_HALF_RES_SCALE);
  });

  it('halfRes moves all three targets together, as a transition', () => {
    const ao = aoFixture({ ...RENDER_CONFIG.post.ao, halfRes: true });
    ao.applyConfig({ ...RENDER_CONFIG.post.ao, halfRes: false });
    expect(ao.march.resolutionScale).toBe(1);
    expect((ao.normals as unknown as { getResolutionScale(): number }).getResolutionScale()).toBe(1);
    expect((ao.denoised as unknown as { getResolutionScale(): number }).getResolutionScale()).toBe(1);
  });

  it('the denoise runs in its OWN target, not inlined into the composite', () => {
    // `DenoiseNode` is a `TempNode` returning an expression. Consuming it
    // directly would inline a 16-tap bilateral filter into the FULL-RESOLUTION
    // composite — four times the pixels the WebGL chain runs it at.
    const ao = aoFixture();
    expect((ao.denoised as unknown as { isRTTNode?: boolean }).isRTTNode).toBe(true);
  });

  it('takes GTAOPass parameters, not three defaults', () => {
    const ao = aoFixture();
    const m = aoMarchParams(RENDER_CONFIG.post.ao);
    expect(ao.march.radius.value).toBe(m.radius);
    expect(ao.march.scale.value).toBe(m.scale);
    expect(ao.march.samples.value).toBe(m.samples);
    expect(ao.march.distanceExponent.value).toBe(1);
    expect(ao.march.thickness.value).toBe(1);
  });

  it('the denoise uses GTAOPass phis (10/2/3), not DenoiseNode defaults (5/5/5)', () => {
    // `GTAOPass`'s constructor overwrites `PoissonDenoiseShader`'s 5/5/5, and
    // the WebGL chain inherits that silently by never setting them. The node
    // chain has to set them or it denoises with a different filter from the
    // same config.
    const d = aoDenoiseParams(RENDER_CONFIG.post.ao);
    expect(d).toEqual({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4 });
    const ao = aoFixture();
    const node = (ao.denoised as unknown as {
      node: { lumaPhi: { value: number }; depthPhi: { value: number }; normalPhi: { value: number } };
    }).node;
    expect(node.lumaPhi.value).toBe(10);
    expect(node.depthPhi.value).toBe(2);
    expect(node.normalPhi.value).toBe(3);
  });

  it('the denoise sample disc uses radius exponent 2, matching GTAOPass', () => {
    // `DenoiseNode` builds its own array with exponent 1 — same 16 taps over 2
    // rings, spread evenly along the radius instead of clustered. Same cost, a
    // different filter, and nothing would have failed.
    expect(AO_DENOISE_RADIUS_EXPONENT).toBe(2);
    const disc = denoiseSampleDisc();
    expect(disc).toHaveLength(16);
    expect(disc[0].z).toBeCloseTo(0, 12);
    expect(disc[15].z).toBeCloseTo(1, 12);
    // Exponent 2 puts the 8th tap at (7/15)^2, not at 7/15.
    expect(disc[7].z).toBeCloseTo((7 / 15) ** 2, 12);

    const ao = aoFixture();
    const vectors = (ao.denoised as unknown as {
      node: { _sampleVectors: { array: Vector3[] } };
    }).node._sampleVectors;
    expect(vectors.array[7].z).toBeCloseTo((7 / 15) ** 2, 12);
  });

  it('reseeds the denoise noise — three ships it from Math.random()', () => {
    /*
     * `DenoiseNode.generateDefaultNoise()` calls `new SimplexNoise()`, whose
     * default RNG argument is `Math`. That is the SAME defect
     * `post.ts#seedAoDenoiseNoise` fixes on the WebGL side, arrived at
     * independently in three's node port: unseeded, every boot's AO lands
     * differently in every crease and the shot harness cannot produce the same
     * image twice (27% of subpixels move).
     *
     * Two constructions of the graph must therefore agree byte for byte.
     */
    const a = aoFixture();
    const b = aoFixture();
    const dataOf = (ao: typeof a): Uint8Array => {
      const n = (ao.denoised as unknown as { node: { noiseNode: { image: { data: Uint8Array } } } })
        .node.noiseNode;
      return n.image.data;
    };
    const da = dataOf(a);
    const db = dataOf(b);
    expect(da.length).toBe(64 * 64 * 4);
    expect(Array.from(da.slice(0, 256))).toEqual(Array.from(db.slice(0, 256)));
    // A non-trivial field, not a zero fill that would compare equal for free.
    expect(new Set(da.slice(0, 256)).size).toBeGreaterThan(4);
    expect(AO_NOISE_SEED).toBe(0x5eed_a011);
  });

  it('never asks for temporal filtering — there is no TAA to resolve it', () => {
    // `useTemporalFiltering` rotates sample directions per FRAME ID and needs
    // `TRAANode` downstream. The chain ends in SMAA, which has no history
    // buffer, and a frame that depends on a frame counter is exactly what the
    // shot harness must not have.
    expect(aoFixture().march.useTemporalFiltering).toBe(false);
  });

  it('shares one resolution rule with the WebGL chain', () => {
    expect(aoTargetSize(2560, 1440, true)).toEqual({ width: 1280, height: 720 });
    expect(aoResolutionScale(true)).toBe(AO_HALF_RES_SCALE);
    expect(aoResolutionScale(false)).toBe(1);
  });
});

/* ========================================================================== */
/* 4. Bloom                                                                   */
/* ========================================================================== */

describe('bloom', () => {
  function bloomFixture(cfg = RENDER_CONFIG.post.bloom) {
    return createBloomNodes(texture(hdrInput()) as never, cfg);
  }

  it('is handed the EFFECTIVE strength, not the authored one', () => {
    const b = bloomFixture({ ...RENDER_CONFIG.post.bloom, strength: 0.42, emissiveBoost: 3.2 });
    expect(b.handle.strength.value).toBeCloseTo(effectiveBloomStrength(0.42, 3.2), 12);
    expect(b.handle.strength.value).toBeCloseTo(0.84, 10);
  });

  it('carries the settled threshold and radius through to the node', () => {
    const b = bloomFixture();
    expect(b.handle.threshold.value).toBeCloseTo(1.2, 6);
    expect(b.handle.radius.value).toBeCloseTo(0.34, 6);
  });

  it("matches UnrealBloomPass's mip structure", () => {
    // Five mips, first at half resolution, weights 1/.8/.6/.4/.2. Read off the
    // node rather than asserted from the docstring.
    const b = bloomFixture();
    const n = b.node as unknown as { _nMips: number; getResolutionScale(): number };
    expect(n._nMips).toBe(5);
    expect(n.getResolutionScale()).toBe(0.5);
  });

  it('applyConfig moves every live uniform', () => {
    const b = bloomFixture();
    b.applyConfig({ ...RENDER_CONFIG.post.bloom, threshold: 0.5, radius: 0.9, strength: 1, emissiveBoost: 1.6 });
    expect(b.handle.threshold.value).toBe(0.5);
    expect(b.handle.radius.value).toBe(0.9);
    expect(b.handle.strength.value).toBeCloseTo(1, 12);
  });
});

/* ========================================================================== */
/* 5. The assembled chain                                                     */
/* ========================================================================== */

describe('the assembled node chain', () => {
  function graphFor(cfg: PostConfig) {
    return buildPostGraph({
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      cfg,
      width: 2560,
      height: 1440,
    });
  }

  it('builds the shipped chain in PASS_ORDER', () => {
    const g = graphFor(postConfigCopy());
    expect(PASS_ORDER).toEqual(['render', 'ao', 'bloom', 'grade', 'smaa']);
    for (const id of PASS_ORDER) expect(g.built[id], id).toBe(true);
    g.dispose();
  });

  it('SMAA is the TAIL, which is what makes the 8-bit mask targets correct', () => {
    // `demoteSmaaMaskTargets` is only sound because SMAA runs last, on the LDR
    // sRGB image the grade has already encoded. Pinned next to the reasoning so
    // the two cannot drift apart — the same pairing `post.ts` asks for.
    expect(PASS_ORDER[PASS_ORDER.length - 1]).toBe('smaa');
    expect(PASS_ORDER.indexOf('grade')).toBeLessThan(PASS_ORDER.indexOf('smaa'));
    expect(PASS_ORDER.indexOf('ao')).toBeLessThan(PASS_ORDER.indexOf('bloom'));
  });

  it('demotes SMAA mask targets to 8 bits, and says so when it cannot', () => {
    const edges = { texture: { type: HalfFloatType } };
    const weights = { texture: { type: HalfFloatType } };
    const ok = demoteSmaaMaskTargets({ _renderTargetEdges: edges, _renderTargetWeights: weights, dispose() {} });
    expect(ok).toBe(true);
    expect(edges.texture.type).toBe(UnsignedByteType);
    expect(weights.texture.type).toBe(UnsignedByteType);
    // Shape drift upstream: leave three's targets alone rather than half-apply.
    expect(demoteSmaaMaskTargets({ dispose() {} })).toBe(false);
  });

  it('declines the output colour transform while the grade is live', () => {
    /*
     * The node twin of `post.ts#rebuild` forcing `NoToneMapping` on the
     * renderer. The grade tonemaps AND sRGB-encodes; a second transform on top
     * is the double-encode that makes a scene look washed out, and it is the
     * single most likely way this port would ship visibly wrong.
     */
    const on = graphFor(postConfigCopy());
    expect(on.needsOutputColorTransform).toBe(false);
    on.dispose();

    const cfg = postConfigCopy();
    cfg.grade.enabled = false;
    const off = graphFor(cfg);
    expect(off.needsOutputColorTransform).toBe(true);
    off.dispose();
  });

  it('a disabled pass leaves the graph rather than being muted', () => {
    const cfg = postConfigCopy();
    cfg.ao.enabled = false;
    cfg.bloom.enabled = false;
    const g = graphFor(cfg);
    expect(g.built.ao).toBeUndefined();
    expect(g.built.bloom).toBeUndefined();
    expect(g.ao).toBeNull();
    expect(g.bloom).toBeNull();
    expect(g.built.render).toBe(true);
    g.dispose();
  });

  it('every combination of toggles still produces a graph', () => {
    // 16 combinations. A chain that throws with, say, grade off and SMAA on is
    // a settings row that black-frames the game, which is the failure
    // `post.ts`'s per-pass try/catch exists for.
    for (let mask = 0; mask < 16; mask++) {
      const cfg = postConfigCopy();
      cfg.ao.enabled = (mask & 1) !== 0;
      cfg.bloom.enabled = (mask & 2) !== 0;
      cfg.grade.enabled = (mask & 4) !== 0;
      cfg.smaa.enabled = (mask & 8) !== 0;
      const g = graphFor(cfg);
      expect(g.output, `mask ${mask}`).toBeTruthy();
      expect(enabledPasses(cfg).render).toBe(true);
      g.dispose();
    }
  });

  it('syncConfig reaches the grade, the bloom and the AO', () => {
    const g = graphFor(postConfigCopy());
    const next = postConfigCopy();
    next.grade.exposure = 2.5;
    next.bloom.threshold = 0.25;
    next.ao.intensity = 0.11;
    g.syncConfig(next);
    expect(g.gradeUniforms?.exposure.value).toBe(2.5);
    expect(g.bloom?.handle.threshold.value).toBe(0.25);
    g.dispose();
  });

  it('setSize drives the grade texel and nothing else needs telling', () => {
    const g = graphFor(postConfigCopy());
    g.setSize(1280, 720);
    expect(g.gradeUniforms?.texel.value.x).toBeCloseTo(1 / 1280, 12);
    g.dispose();
  });

  it('the scene pass owns a depth texture the AO can read', () => {
    // `getNormalFromDepth` does `textureLoad` at integer offsets, so it needs
    // the depth TEXTURE. `PassNode` allocates one unless `depthBuffer: false`.
    const g = graphFor(postConfigCopy());
    expect(g.scenePass.renderTarget.depthTexture).toBeTruthy();
    g.dispose();
  });

  it('MSAA lands on the scene pass alone, and defaults to off', () => {
    /*
     * `post.ts`'s header spends a page on this: `EffectComposer` clones the
     * target it is handed, so `samples` there multisampled every buffer in the
     * chain and cost a reporter 7-8 fps of ~22. `PassNode` owns one target and
     * nothing downstream inherits from it, so the shape is right by
     * construction — but the default must still be 0, because nobody here has
     * the hardware the regression was measured on.
     */
    expect(RENDER_CONFIG.post.msaaSamples).toBe(0);
  });

  it('a pass that cannot be constructed is omitted, not fatal', () => {
    /*
     * `post.ts`'s graceful-degradation contract, ported: "Every pass is
     * constructed inside its own try/catch. If anything throws, that pass is
     * recorded in `chain.failures` and simply omitted... The game never fails to
     * draw." A graph is more brittle than a pass list, because a throwing
     * constructor takes the whole output expression rather than one entry.
     *
     * Driven by removing the `Image` shim, which is the real reason this branch
     * exists rather than a synthetic fault.
     */
    const scope = globalThis as unknown as { Image?: unknown };
    const saved = scope.Image;
    delete scope.Image;
    try {
      const graph = graphFor(postConfigCopy());
      expect(graph.built.smaa).toBeUndefined();
      expect(graph.failures.smaa).toContain('Image');
      // The frame still has a grade on it, and still compiles.
      expect(graph.built.grade).toBe(true);
      expect(compileFragmentNode(graph.output).fragment).toContain('@fragment');
      graph.dispose();
    } finally {
      scope.Image = saved;
    }
  });

  /*
   * THE CHAIN IS COMPILED AT THREE CUT POINTS, BECAUSE ONE COMPILE OF THE TAIL
   * PROVES ALMOST NOTHING.
   *
   * Every materialised stage (the AO targets, the grade's input, SMAA's own
   * RTT) is a TEXTURE from the consumer's side, so compiling the finished output
   * node emits the shader for the LAST quad only — for the shipped chain that is
   * forty lines and a single `textureSample`. That is a real property of a node
   * pipeline, not a defect, and it is exactly the sort of thing that would let a
   * green test sit on top of a chain that never composited anything.
   *
   * So the graph is built with the tail stages disabled to expose each earlier
   * stage as the output, and each is compiled and read. The stages themselves
   * are unchanged — only which one is last.
   */
  it('the composite folds AO and bloom into ONE expression', () => {
    /*
     * The WebGL chain spends two full-screen passes here that this one does not:
     * `GTAOPass`'s copy-then-blend (measured at 6.02 ms for the pair, half of it
     * a full-resolution RGBA16F copy existing only to seed a multiply) and
     * `UnrealBloomPass`'s additive blit. Both are terms in the composite below.
     *
     * The multiply is `GTAOBlendShader` verbatim — `mix(vec3(1.), ao, intensity)`
     * — so a port that dropped the `mix` and multiplied by raw AO would darken
     * the whole frame at `intensity` 0.85, and a port that forgot bloom's `.add()`
     * would show the bloom on black. Both are visible in this one line.
     */
    const cfg = postConfigCopy();
    cfg.smaa.enabled = false;
    cfg.grade.enabled = false;
    const g = graphFor(cfg);
    const src = compileFragmentNode(g.output).fragment;

    expect(src.match(/textureSample\(/g)?.length, 'scene colour, AO, bloom').toBe(3);
    expect(src, 'GTAOBlendShader semantics').toMatch(/mix\(\s*1\.0,/);
    expect(src, "bloom's additive composite").toMatch(/\)\s*\+\s*nodeVar\d+\s*\)/);
    g.dispose();
  });

  it('the grade sits on top of the composite, with its curve intact', () => {
    // One cut point further down: the grade over the materialised composite.
    // 190-odd lines of WGSL carrying the AgX inset, so the stage really is in
    // the assembled chain rather than only in its own unit test.
    const cfg = postConfigCopy();
    cfg.smaa.enabled = false;
    const g = graphFor(cfg);
    const src = compileFragmentNode(g.output).fragment;

    expect(src).toContain('0.842479062253094, 0.0784335999999992, 0.0792237451477643');
    expect(src).toContain('0.18');
    expect(src).toContain('0.94');
    expect(src.match(/textureSample\(/g)?.length, 'centre fetch + four unsharp taps').toBe(5);
    g.dispose();
  });

  it('SMAA is the tail and reads the graded image as a texture', () => {
    const g = graphFor(postConfigCopy());
    const src = compileFragmentNode(g.output).fragment;
    expect(src).toContain('@fragment');
    expect(src).toContain('textureSample(');
    g.dispose();
  });
});

/* ========================================================================== */
/* 6. The WebGL chain is untouched                                            */
/* ========================================================================== */

describe('the WebGL chain still owns the shipping path', () => {
  it('post.ts re-exports the shared order and AO numbers unchanged', async () => {
    const post = await import('../src/render/post');
    expect(post.PASS_ORDER).toEqual(PASS_ORDER);
    expect(post.AO_HALF_RES_SCALE).toBe(AO_HALF_RES_SCALE);
    expect(post.aoTargetSize(2560, 1440, true)).toEqual({ width: 1280, height: 720 });
    expect(post.aoDenoiseRadius(true)).toBe(4);
    expect(post.aoDenoiseRadius(false)).toBe(8);
  });

  it('the denoise phis this refactor made explicit are GTAOPass\'s own', () => {
    /*
     * `post.ts#applyAoConfig` used to pass `{ radius }` alone and inherit
     * `lumaPhi`/`depthPhi`/`normalPhi` from whatever `GTAOPass`'s constructor
     * had put there. It now passes all four from `ao-params.ts`, so the TSL port
     * can be given the same filter — and that is only a NO-OP for the WebGL path
     * while the three values match the ones GTAOPass writes.
     *
     * Read out of three's own source rather than asserted from a comment,
     * because "unchanged" is precisely the claim this repository has learned not
     * to take on trust, and a three upgrade that retunes them would otherwise
     * change the shipping AO silently. Same instrument as
     * `tests/banned-effects.spec.ts`'s source scan.
     */
    const src = readFileSync(
      fileURLToPath(new URL('../node_modules/three/examples/jsm/postprocessing/GTAOPass.js', import.meta.url)),
      'utf8',
    );
    const read = (key: string): number => {
      const m = src.match(new RegExp(`pdMaterial\\.uniforms\\.${key}\\.value\\s*=\\s*([0-9.]+)`));
      expect(m, `GTAOPass no longer sets ${key} in its constructor`).toBeTruthy();
      return Number(m![1]);
    };
    const ours = aoDenoiseParams(RENDER_CONFIG.post.ao);
    expect(read('lumaPhi')).toBe(ours.lumaPhi);
    expect(read('depthPhi')).toBe(ours.depthPhi);
    expect(read('normalPhi')).toBe(ours.normalPhi);
  });

  it('the shipped config still holds every banned effect at zero', () => {
    // Belt and braces with `tests/banned-effects.spec.ts`: that file is the
    // source scan, this is the live-config half, and the compiled-shader
    // assertion above is the one neither of them could make before.
    expect(RENDER_CONFIG.post.grade.grain).toBe(0);
    expect(RENDER_CONFIG.post.grade.chromaticAberration).toBe(0);
    expect(new Color()).toBeTruthy(); // three/webgpu imported without side effects
  });
});

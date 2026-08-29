/**
 * ============================================================================
 * VOLTMARCH — tests/water-node-material.spec.ts
 * ============================================================================
 * THE GATE FOR THE TSL WATER PORT (the WebGPU migration Stage E).
 *
 * Three jobs, and the second is the one that earns its keep:
 *
 *  1. **The graph builds**, on BOTH backends of the node path — WGSL for a real
 *     device and GLSL for the WebGL2 fallback that a machine without one gets.
 *  2. **The shared constants table did not change any number.** `water-uniforms.ts`
 *     was extracted from `createWaterMaterial`'s uniform block during this stage.
 *     A table both materials read means they cannot drift APART — it does nothing
 *     about them drifting TOGETHER, away from what shipped. So section 3
 *     transcribes the pre-move literals out of `config.ts` by hand and checks the
 *     live uniforms against them.
 *  3. **RULING #7 survived**, expressed the same way `tests/water.spec.ts`
 *     expresses it for the GLSL material: as a clamp and as an absence.
 *
 * WHAT A GREEN RUN DOES NOT MEAN: any pixel. Nothing here executes a shader.
 * Numeric equivalence between the two seas needs a device and a capture.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { compileNodeMaterial } from './helpers/node-compile';
import {
  MAP_SIZE, WATER_FIELD, WATER_FOAM, WATER_GLINT, WATER_LOOK, WATER_PALETTES,
  WATER_SHORE, WATER_SSR, WATER_WAKE, WATER_WAVES,
} from '../src/core/config';
import { DEG2RAD, TAU } from '../src/core/math';
import { createWaterMaterial } from '../src/world/WaterMaterial';
import { createWaterNodeMaterial } from '../src/world/WaterNodeMaterial';
import { WATER_CONSTANTS, resampleRamp, waterAbsorbFor } from '../src/world/water-uniforms';

/** Small tiles: none of these tests looks at a texel, and 512 is 64x the bytes. */
const OPTS = {
  palette: WATER_PALETTES.tropical, rampDepth: 6, seed: 1, textureSize: 64,
} as const;

function nodeSet() { return createWaterNodeMaterial({ ...OPTS }); }
function glslSet() { return createWaterMaterial({ ...OPTS }); }

/* ==========================================================================
 * 1. THE GRAPH COMPILES
 * ========================================================================== */

describe('the TSL water graph compiles', () => {
  it('builds WGSL for the WebGPU backend', () => {
    const set = nodeSet();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl');
    // The vertex stage does a texture fetch and evaluates the swell; it is not
    // a passthrough, and a suspiciously short one would mean `vertexNode` was
    // dropped and the sea rendered flat at y = 0.
    expect(vertex.length).toBeGreaterThan(500);
    expect(fragment.length).toBeGreaterThan(3000);
    set.dispose();
  });

  /*
   * NOT REDUNDANT. `WebGPURenderer` silently runs its WebGL2 backend wherever a
   * device is unavailable, and that backend compiles the SAME graph through
   * `GLSLNodeBuilder`. This is also why `wgslFn` was rejected for this port: it
   * links on one backend and lands verbatim inside a GLSL shader on the other.
   */
  it('builds GLSL for the WebGL2 fallback backend', () => {
    const set = nodeSet();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'glsl');
    expect(vertex.length).toBeGreaterThan(500);
    expect(fragment.length).toBeGreaterThan(3000);
    set.dispose();
  });

  it('emits no NaN literal into either shader', () => {
    // A NaN in a generated constant is the black-frame failure this repo has a
    // standing rule about: it propagates through the bloom mip chain and kills
    // every pixel while the stats keep reporting draws.
    const set = nodeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compileNodeMaterial(set.material, which);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
    }
    set.dispose();
  });

  it('applies the same restrained foam opacity on both generated backends', () => {
    const set = nodeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { fragment } = compileNodeMaterial(set.material, which);
      expect(fragment, `${which} lost the foam/body blend`).toContain('foamBlend');
    }
    set.dispose();
  });
});

/* ==========================================================================
 * 2. THE STRUCTURES `WATER_FRAG` RELIED ON
 * ========================================================================== */

describe('the translated water keeps what the GLSL did', () => {
  it('declares the PURE wave helpers as functions, and only those', () => {
    /*
     * `crestWave` is called twice inside `swellHeight` and `rot2`/`unrot2` twice
     * each, so a layout is worth having: without one a TSL `Fn` is a macro and
     * three emits the body at every call site, renaming collided locals on the
     * way past — Stage C measured that at -9.9% of source length on the terrain
     * shader when fixed.
     *
     * THE OTHER THREE HELPERS DELIBERATELY HAVE NO LAYOUT. `swellHeight`,
     * `decodeSigned` and `rampSample` all read module-scope UNIFORMS, and
     * section 2b is the assertion that says why that matters.
     */
    const set = nodeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { fragment } = compileNodeMaterial(set.material, which);
      for (const fn of ['waterCrestWave', 'waterRot2', 'waterUnrot2']) {
        expect(fragment, `${fn} missing from ${which}`).toContain(fn);
      }
    }
    set.dispose();
  });

  it('re-evaluates the swell in the FRAGMENT stage rather than interpolating it', () => {
    /*
     * `WaterMaterial.ts`'s own note: the crest height drives the foam threshold,
     * and a linearly interpolated crest across a 2 m quad visibly stair-steps
     * the foam edge. So the swell must be computed in BOTH stages, not once in
     * the vertex stage with a varying carrying the result.
     *
     * `swellHeight` is a macro (see above), so the marker is its inlined body
     * rather than a function name: `waterCrestWave` is the declared function it
     * calls, and it can only appear in a stage the swell was evaluated in.
     */
    const set = nodeSet();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl');
    expect(vertex).toContain('waterCrestWave');
    expect(fragment).toContain('waterCrestWave');
    set.dispose();
  });

  it('declares no WGSL function that reaches outside itself', () => {
    /*
     * STAGE D'S FINDING, APPLIED HERE — and the reason section 1's compile
     * checks are weaker than they read. `WGSLNodeBuilder.build()` GENERATES a
     * module; nothing in Node compiles one. Four of Stage D's five helpers
     * passed every offline test and were then refused by Chrome with
     * `unresolved value 'nodeUniform1'`, because `.setLayout()` emits a real
     * WGSL function and a WGSL function sees nothing but its parameters.
     *
     * This water shader had THREE helpers in that position — `swellHeight`,
     * `decodeSigned` and `rampSample` all read uniforms — and they are macros
     * now. This is what keeps them macros.
     */
    const set = nodeSet();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl');
    let seen = 0;
    for (const stage of [vertex, fragment]) {
      const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stage)) !== null) {
        if (m[1] === 'main') continue;
        const open = stage.indexOf('{', re.lastIndex);
        if (open < 0) continue;
        let depth = 0;
        let i = open;
        for (; i < stage.length; i++) {
          if (stage[i] === '{') depth++;
          else if (stage[i] === '}' && --depth === 0) break;
        }
        const body = stage.slice(open, i + 1);
        seen++;
        expect(body, `fn ${m[1]} reads a nodeUniform, which only main can see`)
          .not.toMatch(/\bnodeUniform\d+\b/);
        expect(body, `fn ${m[1]} reads vShroudUv, which only main can see`)
          .not.toMatch(/\bvShroudUv\b/);
      }
    }
    // The scan has to find the three that ARE declared, or it is vacuous.
    expect(seen, 'no declared function found — the scan is broken')
      .toBeGreaterThanOrEqual(3);
    set.dispose();
  });

  it('discards the land margin rather than drawing it', () => {
    // The mesh carries a margin past the waterline so the geometry never ends
    // before the water does. `if (depth <= 0.0) discard;` is where it goes.
    const set = nodeSet();
    expect(compileNodeMaterial(set.material, 'wgsl').fragment).toMatch(/discard/);
    set.dispose();
  });

  it('uses the SHARED shroud tint instead of copying the formula a third time', () => {
    /*
     * `WATER_FRAG` writes the fog block out by hand under a comment reading
     * "Same formula as applyShroudTint()", because a raw ShaderMaterial has no
     * `onBeforeCompile` to hook. On the node path it is Stage D's
     * `shroudTint` / `shroudVertexUv` pair, and the whole point is that the
     * third copy has nowhere to come back from.
     *
     * The markers are the tint's own `.toVar()` names and the varying, because
     * `shroudTintRgb` is a MACRO — it reads five uniforms and a sampler, so it
     * may not carry a layout and therefore emits no function name to look for.
     * Variable names survive inlining; that is what makes them usable here.
     */
    const set = nodeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compileNodeMaterial(set.material, which);
      for (const marker of ['vmV', 'vmRem', 'vmFog']) {
        expect(fragment, `${marker} missing from ${which}`).toMatch(
          new RegExp(`\\b${marker}\\b`),
        );
      }
      // And the vertex half — a material that applies the tint without writing
      // the varying compiles, renders, and tints from garbage.
      expect(vertex, `vShroudUv unwritten in ${which}`).toContain('vShroudUv');
    }
    set.dispose();
  });

  it('emits no DESCENDING smoothstep, which is UNDEFINED in WGSL', () => {
    /*
     * GLSL leaves `smoothstep( edge0, edge1, x )` with edge0 >= edge1
     * unspecified and every driver evaluates the same polynomial anyway. **WGSL
     * leaves it undefined**, so the habit GLSL forgave is a real portability
     * bug here — and `WATER_FRAG` had exactly one instance, the seabed cutoff
     * `smoothstep( uBed.x, uBed.x * 0.35, bedDepth )`. It is the ascending form
     * inverted in the port, which is exactly equal because S(1-t) === 1-S(t).
     *
     * This scans only the calls whose BOTH edges are numeric literals — the
     * uniform-edged ones cannot be decided without values — which is enough to
     * catch the shape a translator actually gets wrong: a constant pair copied
     * across in the original order.
     */
    const set = nodeSet();
    const call = /smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g;
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compileNodeMaterial(set.material, which);
      const src = `${vertex}\n${fragment}`;
      let m: RegExpExecArray | null;
      let seen = 0;
      call.lastIndex = 0;
      while ((m = call.exec(src)) !== null) {
        seen++;
        expect(Number(m[1]), `descending smoothstep in ${which}: ${m[0]}`)
          .toBeLessThan(Number(m[2]));
      }
      // The scan itself has to be known to work, or a regex that matches
      // nothing passes forever. The water has at least six literal-edged
      // smoothsteps: shallow, the two wake terms, the band mask, the shore
      // ramp, the foam colour blend and the waterline alpha.
      expect(seen, `no smoothstep found in ${which} — the scan is broken`)
        .toBeGreaterThanOrEqual(6);
    }
    set.dispose();
  });

  it('carries the material flags across verbatim', () => {
    const set = nodeSet();
    const glsl = glslSet();
    for (const key of ['transparent', 'depthWrite', 'depthTest', 'fog', 'toneMapped'] as const) {
      expect(set.material[key], key).toBe(glsl.material[key]);
    }
    expect(set.material.side).toBe(glsl.material.side);
    expect(set.material.side).toBe(THREE.FrontSide);
    set.dispose();
    glsl.dispose();
  });
});

/* ==========================================================================
 * 3. THE PRE-MOVE LITERALS, TRANSCRIBED
 *
 * `water-uniforms.ts` did not exist before this stage; every number below was
 * an expression inside `createWaterMaterial`'s uniform block. They are written
 * out from `config.ts` here by hand so that a shared table cannot hide a change
 * to what BOTH materials upload.
 * ========================================================================== */

describe('WATER_CONSTANTS is what createWaterMaterial used to compute', () => {
  it('keeps the scalar encodes', () => {
    expect(WATER_CONSTANTS.uInvMapSize).toBe(1 / MAP_SIZE);
    expect(WATER_CONSTANTS.uEncodeMetres).toBe(WATER_FIELD.encodeMetres);
    expect(WATER_CONSTANTS.uShoreEncode).toBe(WATER_SHORE.encodeMetres);
    expect(WATER_CONSTANTS.rampStops).toBe(WATER_LOOK.rampStops);
  });

  it('keeps the three wave bands and their rotations', () => {
    expect([...WATER_CONSTANTS.waveA]).toEqual([
      WATER_WAVES.swellMetres, WATER_WAVES.swellMetres2,
      WATER_WAVES.swellAmplitude, WATER_WAVES.swellSpeed,
    ]);
    expect([...WATER_CONSTANTS.waveB]).toEqual([
      WATER_WAVES.chopTileMetres, WATER_WAVES.chopSpeed,
      WATER_WAVES.chopStrength, WATER_WAVES.swellSharpness,
    ]);
    expect([...WATER_CONSTANTS.waveC]).toEqual([
      WATER_WAVES.microTileMetres, WATER_WAVES.microSpeed,
      WATER_WAVES.microStrength, WATER_WAVES.seaState,
    ]);

    const d1 = WATER_WAVES.swellHeadingDeg * DEG2RAD;
    const d2 = WATER_WAVES.swellHeadingDeg2 * DEG2RAD;
    expect([...WATER_CONSTANTS.swellDir]).toEqual([
      Math.cos(d1), Math.sin(d1), Math.cos(d2), Math.sin(d2),
    ]);

    // The bible's 0 / 47 / 113 degree sampling rotations.
    const rot = WATER_WAVES.rotationDeg;
    expect([...WATER_CONSTANTS.rot47]).toEqual([
      Math.cos(rot[1] * DEG2RAD), Math.sin(rot[1] * DEG2RAD),
    ]);
    expect([...WATER_CONSTANTS.rot113]).toEqual([
      Math.cos(rot[2] * DEG2RAD), Math.sin(rot[2] * DEG2RAD),
    ]);
  });

  it('keeps the foam thresholds, including the mip compensation', () => {
    expect([...WATER_CONSTANTS.foam]).toEqual([
      WATER_FOAM.thresholdLo, WATER_FOAM.thresholdHi,
      WATER_FOAM.crestGain, WATER_FOAM.scrollSpeed,
    ]);
    // `laceParams.w` is `1/sqrt(m^2 + (1-m)^2)` — mixing two gaussians of equal
    // sigma narrows the result by exactly that, and undoing it is what keeps
    // scorecard #26's coverage where the probe measured it.
    const m = WATER_FOAM.laceDetailMix;
    expect(WATER_CONSTANTS.laceParams[3]).toBeCloseTo(
      1 / Math.sqrt(m * m + (1 - m) * (1 - m)), 12,
    );
    // `foamMisc.y` was a bare 0.03 in the uniform block once, invisible to
    // `probeFoam`. It must stay the config value the probe also reads.
    expect([...WATER_CONSTANTS.foamMisc]).toEqual([
      WATER_FOAM.choppyBias, WATER_FOAM.distanceBias, WATER_WAKE.foamGain,
    ]);
  });

  it('keeps the shoreline band and its solved churn threshold', () => {
    expect([...WATER_CONSTANTS.shore]).toEqual([
      WATER_SHORE.bandMetres, WATER_SHORE.pulseHz * TAU,
      WATER_SHORE.pulseAmount, WATER_SHORE.scrollSpeed,
    ]);
    expect(WATER_CONSTANTS.shoreMisc[0]).toBe(WATER_SHORE.lightenDepthMetres);
    expect(WATER_CONSTANTS.shoreMisc[2]).toBe(WATER_FOAM.laceTileMetres * 0.5);
    // The threshold is SOLVED for `WATER_SHORE.coverage`, not eyeballed, which
    // is what makes scorecard #27 a property of the code. Its exact value is
    // pinned by the GLSL comparison below; here it only has to be in range.
    expect(WATER_CONSTANTS.shoreMisc[1]).toBeGreaterThan(0);
    expect(WATER_CONSTANTS.shoreMisc[1]).toBeLessThan(1.2);
  });

  it('keeps the light grade and the glint', () => {
    expect([...WATER_CONSTANTS.grade]).toEqual([
      WATER_LOOK.sunDiffuse, WATER_LOOK.fillDiffuse, WATER_LOOK.outputGain,
    ]);
    expect([...WATER_CONSTANTS.glint]).toEqual([
      WATER_GLINT.roughness, WATER_GLINT.anisotropy, WATER_GLINT.intensity, 0.9,
    ]);
    // Foam is lit 2.67x harder than the body, which is most of why it dominates
    // the frame at a coverage well under half (scorecard #25's rewrite).
    expect(WATER_CONSTANTS.foamSunDiffuse).toBe(WATER_LOOK.foamSunDiffuse);
    expect(WATER_CONSTANTS.foamFillDiffuse).toBe(WATER_LOOK.foamFillDiffuse);
  });

  it('scales absorption and the seabed fade by the SAME basin factor', () => {
    // A procedural basin is often 2 m deep; at the bible's literal coefficients
    // the water would be almost clear. Scaling both together preserves the look
    // at any depth — the bed still vanishes at the same FRACTION of the way down.
    const k = WATER_LOOK.rampDepthMetres / Math.max(6, 0.25);
    const a = waterAbsorbFor(WATER_PALETTES.tropical, 6);
    expect(a.r).toBeCloseTo(WATER_PALETTES.tropical.absorb[0] * k, 12);
    expect(a.fadeMetres).toBeCloseTo(WATER_LOOK.seabedFadeMetres / k, 12);
  });
});

/* ==========================================================================
 * 4. RULING #7 — WATER IS NOT A MIRROR
 *
 * `tests/water.spec.ts` asserts this for the GLSL material. The node path is a
 * second renderer and gets the same two questions, because a ruling that holds
 * on one of two shipped surfaces is not a ruling.
 * ========================================================================== */

describe('water — RULING #7 on the node path', () => {
  it('clamps the grazing mix at the source, so neither material can exceed it', () => {
    expect(WATER_CONSTANTS.ssrMix).toBeLessThanOrEqual(WATER_SSR.mixMax);
    expect(WATER_SSR.mixMax).toBeLessThanOrEqual(0.10);
    const set = nodeSet();
    expect(set.uniforms.uSsr.value.x).toBe(WATER_CONSTANTS.ssrMix);
    set.dispose();
  });

  it('uses WATER_SSR.fresnelPower, not the inert WATER_NOON one', () => {
    /*
     * `WATER_NOON.fresnelPower` is 5.4 and carries six lines of measurement.
     * NOTHING READS IT — nothing reads any of `DEFAULT_ART.water`. The live
     * exponent is `WATER_SSR.fresnelPower`, and it is 5.0. This test exists so
     * that the next person who notices the 5.4 finds a red assertion rather
     * than quietly "restoring" it.
     */
    expect(WATER_CONSTANTS.ssrFresnelPower).toBe(WATER_SSR.fresnelPower);
    expect(WATER_SSR.fresnelPower).toBe(5.0);
    const set = nodeSet();
    expect(set.uniforms.uSsr.value.y).toBe(5.0);
    set.dispose();
  });

  it('has no sky, cube-map, env or planar-reflection term in either shader', () => {
    /*
     * THE PRECISION PREAMBLE HAS TO COME OFF FIRST, and finding that out is the
     * reason this comment exists. `GLSLNodeBuilder` opens every shader it emits
     * with a fixed block —
     *
     *     precision highp samplerCube;
     *     precision highp usamplerCube;
     *     precision highp isamplerCube;
     *     precision highp samplerCubeShadow;
     *
     * — regardless of what the graph actually samples. A naive substring scan
     * for `samplercube` therefore fails on a shader with no cube map anywhere in
     * it, and the obvious "fix" is to drop the token from the list, which would
     * quietly stop the check from ever catching a real reflection probe. The
     * preamble is stripped instead, so the token keeps its teeth.
     */
    const set = nodeSet();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compileNodeMaterial(set.material, which);
      const src = `${vertex}\n${fragment}`
        .split('\n')
        .filter((line) => !/^\s*precision\s+\w+\s+\w*sampler\w*\s*;/.test(line))
        .join('\n')
        .toLowerCase();
      for (const banned of [
        'samplercube', 'texturecube', 'texture_cube', 'envmap', 'skybox',
        'reflectionmap', 'reflectorbase',
      ]) {
        expect(src, `${banned} appeared in ${which}`).not.toContain(banned);
      }
    }
    // And no fog, per bible §0 property 4.
    expect(set.material.fog).toBe(false);
    set.dispose();
  });

  it('caps the shore falloff inside the encode range', () => {
    // The shore channel saturates at its encode range, so a falloff past that
    // leaves the grazing term at a permanent floor offshore — a mirror by
    // another route.
    expect(WATER_CONSTANTS.ssrShoreFalloff).toBeLessThanOrEqual(
      WATER_SHORE.encodeMetres * 0.92,
    );
    expect(WATER_CONSTANTS.ssrShoreFalloff).toBeLessThanOrEqual(
      WATER_SSR.shoreFalloffMetres,
    );
  });
});

/* ==========================================================================
 * 5. THE TWO MATERIALS AGREE
 *
 * The strongest gate in this file: build both and compare every uniform they
 * share. Two seas that disagree about a number is the failure the whole
 * migration has to avoid, and it is cheap to check exhaustively.
 * ========================================================================== */

describe('the node material and the shipping material upload the same numbers', () => {
  it('agrees on every scalar and vector uniform', () => {
    const node = nodeSet();
    const glsl = glslSet();
    const u = glsl.uniforms;
    const n = node.uniforms;

    const scalars: [string, number, number][] = [
      ['uInvMapSize', n.uInvMapSize.value, u.uInvMapSize.value],
      ['uEncodeMetres', n.uEncodeMetres.value, u.uEncodeMetres.value],
      ['uShoreEncode', n.uShoreEncode.value, u.uShoreEncode.value],
      ['uRampDepth', n.uRampDepth.value, u.uRampDepth.value],
      ['uWaterLevel', n.uWaterLevel.value, u.uWaterLevel.value],
      ['uLightNorm', n.uLightNorm.value, u.uLightNorm.value],
      ['uTime', n.uTime.value, u.uTime.value],
    ];
    for (const [name, a, b] of scalars) expect(a, name).toBe(b);

    const vectors: [string, { toArray(): number[] }, { toArray(): number[] }][] = [
      ['uAbsorb', n.uAbsorb.value, u.uAbsorb.value],
      ['uSeabed', n.uSeabed.value, u.uSeabed.value],
      ['uBed', n.uBed.value, u.uBed.value],
      ['uWaveA', n.uWaveA.value, u.uWaveA.value],
      ['uWaveB', n.uWaveB.value, u.uWaveB.value],
      ['uWaveC', n.uWaveC.value, u.uWaveC.value],
      ['uSwellDir', n.uSwellDir.value, u.uSwellDir.value],
      ['uRot47', n.uRot47.value, u.uRot47.value],
      ['uRot113', n.uRot113.value, u.uRot113.value],
      ['uFoamColor', n.uFoamColor.value, u.uFoamColor.value],
      ['uFoam', n.uFoam.value, u.uFoam.value],
      ['uLaceParams', n.uLaceParams.value, u.uLaceParams.value],
      ['uFoamMisc', n.uFoamMisc.value, u.uFoamMisc.value],
      ['uShoreFoam', n.uShoreFoam.value, u.uShoreFoam.value],
      ['uShoreMid', n.uShoreMid.value, u.uShoreMid.value],
      ['uShoreWater', n.uShoreWater.value, u.uShoreWater.value],
      ['uShore', n.uShore.value, u.uShore.value],
      ['uShoreMisc', n.uShoreMisc.value, u.uShoreMisc.value],
      ['uSunDir', n.uSunDir.value, u.uSunDir.value],
      ['uSunColor', n.uSunColor.value, u.uSunColor.value],
      ['uHemiSky', n.uHemiSky.value, u.uHemiSky.value],
      ['uHemiGround', n.uHemiGround.value, u.uHemiGround.value],
      ['uGrade', n.uGrade.value, u.uGrade.value],
      ['uGlint', n.uGlint.value, u.uGlint.value],
      ['uSsr', n.uSsr.value, u.uSsr.value],
      ['uReflect', n.uReflect.value, u.uReflect.value],
    ];
    for (const [name, a, b] of vectors) expect(a.toArray(), name).toEqual(b.toArray());

    node.dispose();
    glsl.dispose();
  });

  it('agrees on the eight ramp stops', () => {
    // The GLSL keeps them on `{ value: Vector3[] }`; TSL's `uniformArray` keeps
    // them on `.array` and leaves `.value` null. Both are mutated in place and
    // neither is replaced, which is the whole reason the sink takes the bare
    // array rather than the slot.
    const node = nodeSet();
    const glsl = glslSet();
    const a = node.uniforms.uRamp.array as THREE.Vector3[];
    const b = glsl.uniforms.uRamp.value;
    expect(a.length).toBe(WATER_LOOK.rampStops);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i].toArray(), `stop ${i}`).toEqual(b[i].toArray());
    node.dispose();
    glsl.dispose();
  });

  it('still agrees after a palette swap', () => {
    // `applyPalette` is one shared function now; this proves both sinks reach
    // every slot, including the two (`uAbsorb`, `uBed`) that used to be written
    // by a separate `applyAbsorb` call the node path could have forgotten.
    const node = nodeSet();
    const glsl = glslSet();
    node.applyPalette(WATER_PALETTES.arctic, 11);
    glsl.applyPalette(WATER_PALETTES.arctic, 11);
    expect(node.uniforms.uAbsorb.value.toArray()).toEqual(glsl.uniforms.uAbsorb.value.toArray());
    expect(node.uniforms.uBed.value.toArray()).toEqual(glsl.uniforms.uBed.value.toArray());
    expect(node.uniforms.uSeabed.value.toArray()).toEqual(glsl.uniforms.uSeabed.value.toArray());
    expect(node.uniforms.uRampDepth.value).toBe(glsl.uniforms.uRampDepth.value);
    const expected = resampleRamp(WATER_PALETTES.arctic, WATER_LOOK.rampStops);
    const got = node.uniforms.uRamp.array as THREE.Vector3[];
    for (let i = 0; i < expected.length; i++) {
      expect(got[i].toArray(), `stop ${i}`).toEqual(expected[i].toArray());
    }
    node.dispose();
    glsl.dispose();
  });

  it('agrees on the light rig after applyLighting', () => {
    const rig = {
      sunDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
      sunColor: new THREE.Vector3(2.9, 2.6, 2.1),
      hemiSky: new THREE.Vector3(0.21, 0.36, 0.71),
      hemiGround: new THREE.Vector3(0.24, 0.19, 0.11),
    };
    const node = nodeSet();
    const glsl = glslSet();
    node.applyLighting(rig);
    glsl.applyLighting(rig);
    // `uLightNorm` is what makes the authored ramp hexes render as themselves at
    // noon. The two paths must derive it from the same function or the seas are
    // graded differently under the same sun.
    expect(node.uniforms.uLightNorm.value).toBe(glsl.uniforms.uLightNorm.value);
    expect(node.uniforms.uSunDir.value.toArray()).toEqual(glsl.uniforms.uSunDir.value.toArray());
    node.dispose();
    glsl.dispose();
  });

  it('builds the same tiles from the same key, so one prewarm serves both', () => {
    // `world-warm.ts` generates the tiles once. If the two materials disagreed
    // about `waveSize` or the lace seed offset the worker would serve only one
    // of them and the other would silently regenerate on the main thread —
    // 230-270 ms of boot, back again, with nothing logged.
    const node = nodeSet();
    const glsl = glslSet();
    expect(node.waveTexture.image.width).toBe(glsl.waveTexture.image.width);
    expect(node.laceTexture.image.width).toBe(glsl.laceTexture.image.width);
    expect(Array.from(node.waveTexture.image.data as Uint8Array).slice(0, 64))
      .toEqual(Array.from(glsl.waveTexture.image.data as Uint8Array).slice(0, 64));
    expect(Array.from(node.laceTexture.image.data as Uint8Array).slice(0, 64))
      .toEqual(Array.from(glsl.laceTexture.image.data as Uint8Array).slice(0, 64));
    node.dispose();
    glsl.dispose();
  });
});

/* ==========================================================================
 * 6. THE TWO GAPS THE PORT ACTUALLY HIT
 * ========================================================================== */

describe('the node path handles what the GLSL path got for free', () => {
  it('never leaves a texture node holding null', () => {
    /*
     * The GLSL uniforms carry `uField: { value: null }` until `Water.ts` builds
     * the field — harmless for a sampler2D that is never read. A TSL `texture()`
     * reads its sampler type off the value AT CONSTRUCTION, so null is a build
     * failure. `setField(null)` restores the stand-in instead of clearing.
     */
    const set = nodeSet();
    const real = new THREE.DataTexture(
      new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    set.setField(real);
    expect(set.uniforms.uField.value).toBe(real);
    set.setField(null);
    expect(set.uniforms.uField.value).not.toBeNull();
    // And it still compiles with the stand-in bound.
    expect(compileNodeMaterial(set.material, 'wgsl').fragment.length).toBeGreaterThan(3000);
    real.dispose();
    set.dispose();
  });

  it('clamps sea state exactly as the GLSL setter does', () => {
    const node = nodeSet();
    const glsl = glslSet();
    for (const v of [-1, 0, 0.42, 1, 2]) {
      node.setSeaState(v);
      glsl.setSeaState(v);
      expect(node.uniforms.uWaveC.value.w, `seaState ${v}`).toBe(glsl.uniforms.uWaveC.value.w);
    }
    node.dispose();
    glsl.dispose();
  });
});

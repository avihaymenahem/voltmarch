/**
 * ============================================================================
 * VOLTMARCH — tests/shroud-nodes.spec.ts
 * ============================================================================
 * THE GATE FOR THE TSL SHROUD **CARPET** (Stage E of
 * `docs/WEBGPU_MIGRATION_PLAN.md`).
 *
 * The SELF-TINT half of `src/render/shroud-nodes.ts` is Stage D's and is gated
 * by `tests/stage-d-node-materials.spec.ts`. This file covers what Stage E
 * added: `createShroudNodeMaterial`, the domain warp, the ordered dither, and
 * the four pure noise helpers that are the only things in the module allowed to
 * carry a `.setLayout()`.
 *
 * Same instrument and same limits as the terrain and water specs: a TSL graph
 * compiles to WGSL and to GLSL in plain Node. **A compiled shader is not a
 * correct picture, and — Stage D's finding — it is not even a VALID shader.**
 * `WGSLNodeBuilder.build()` generates a module; nothing here compiles one. That
 * is why section 2 exists.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { compileNodeMaterial } from './helpers/node-compile';
import { createShroudNodeMaterial } from '../src/render/shroud-nodes';
import { shroudUniforms } from '../src/render/FogOfWar';
import {
  DEFAULT_ART, FOG_DITHER, FOG_EDGE_WARP, FOG_EXPLORED_ALPHA, FOG_EXPLORED_LEVEL,
  FOG_UNEXPLORED_ALPHA, MAP_CELLS,
} from '../src/core/config';

/* ==========================================================================
 * 1. THE CARPET COMPILES — on BOTH backends
 * ========================================================================== */

describe('the TSL shroud carpet compiles', () => {
  it('builds WGSL for the WebGPU backend', () => {
    const set = createShroudNodeMaterial();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl');
    expect(vertex.length).toBeGreaterThan(200);
    expect(fragment.length).toBeGreaterThan(800);
    set.dispose();
  });

  /*
   * NOT REDUNDANT. `WebGPURenderer` silently runs its WebGL2 backend wherever a
   * device is unavailable, and that backend compiles the SAME graph through
   * `GLSLNodeBuilder`. Anything that builds on one and not the other ships a
   * renderer that works on half the machines.
   */
  it('builds GLSL for the WebGL2 fallback backend', () => {
    const set = createShroudNodeMaterial();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'glsl');
    expect(vertex.length).toBeGreaterThan(200);
    expect(fragment.length).toBeGreaterThan(800);
    set.dispose();
  });

  it('emits no NaN literal into either shader', () => {
    const set = createShroudNodeMaterial();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { vertex, fragment } = compileNodeMaterial(set.material, which);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
    }
    set.dispose();
  });
});

/* ==========================================================================
 * 2. NO DECLARED WGSL FUNCTION CAPTURES MODULE SCOPE
 *
 * Stage D's check, applied to Stage E's helpers. `.setLayout()` turns a TSL `Fn`
 * into a REAL WGSL function, and a WGSL function sees nothing but its declared
 * parameters — so a body reading an attribute, a varying or a uniform emits a
 * function full of names that are not in scope, and Chrome refuses the module
 * while every offline test passes. The GLSL backend inlines regardless.
 *
 * The carpet's four helpers are PURE, which is what makes their layouts legal.
 * This is the assertion that keeps them that way.
 * ========================================================================== */

describe('the carpet declares no capturing function', () => {
  function declaredFunctions(wgsl: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wgsl)) !== null) {
      // `main` IS the entry point and is the one scope that legitimately holds
      // every attribute and varying in the module.
      if (m[1] === 'main') continue;
      const open = wgsl.indexOf('{', re.lastIndex);
      if (open < 0) continue;
      let depth = 0;
      let i = open;
      for (; i < wgsl.length; i++) {
        if (wgsl[i] === '{') depth++;
        else if (wgsl[i] === '}' && --depth === 0) break;
      }
      out.push({ name: m[1], body: wgsl.slice(open, i + 1) });
    }
    return out;
  }

  it('reaches nothing only main can see', () => {
    const set = createShroudNodeMaterial();
    const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl');
    let seen = 0;
    for (const stage of [vertex, fragment]) {
      for (const fn of declaredFunctions(stage)) {
        seen++;
        expect(fn.body, `fn ${fn.name} reads a nodeUniform, which only main can see`)
          .not.toMatch(/\bnodeUniform\d+\b/);
        expect(fn.body, `fn ${fn.name} reads vShroudUv, which only main can see`)
          .not.toMatch(/\bvShroudUv\b/);
      }
    }
    // The scan must actually find the four helpers, or a build that stopped
    // emitting declared functions would pass this and prove nothing.
    expect(seen, 'no declared function found — the scan is vacuous')
      .toBeGreaterThanOrEqual(4);
    set.dispose();
  });

  it('still declares the four pure helpers as real functions', () => {
    /*
     * The other half of the same rule: a layout on a PURE helper is legal and
     * worth having. `shroudVnoise` calls `shroudHash21` four times and the
     * carpet calls `shroudVnoise` four times, so without layouts three emits the
     * hash body sixteen times over with renamed locals.
     */
    const set = createShroudNodeMaterial();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { fragment } = compileNodeMaterial(set.material, which);
      for (const fn of ['shroudHash21', 'shroudVnoise', 'shroudBayer2', 'shroudBayer4']) {
        expect(fragment, `${fn} missing from ${which}`).toContain(fn);
      }
    }
    set.dispose();
  });
});

/* ==========================================================================
 * 3. THE STRUCTURES `SHROUD_FRAG` RELIED ON
 * ========================================================================== */

describe('the translated carpet keeps what SHROUD_FRAG did', () => {
  it('discards the fully-clear fragment rather than blending a zero', () => {
    // Over a 33k-triangle full-map carpet, blending a transparent black is a
    // full-screen overdraw for nothing.
    const set = createShroudNodeMaterial();
    expect(compileNodeMaterial(set.material, 'wgsl').fragment).toMatch(/discard/);
    set.dispose();
  });

  it('takes its dither from screenCoordinate, never from an RNG', () => {
    /*
     * VISUAL_DNA I1 wants an ORDERED dither: stable frame to frame. White noise
     * would crawl and read as film grain, which is banned — and
     * `RENDER_FINDINGS` records three's own `DenoiseNode` seeding itself from
     * `Math.random()`, which would also destroy the shot harness's
     * byte-identical captures.
     */
    const set = createShroudNodeMaterial();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { fragment } = compileNodeMaterial(set.material, which);
      expect(fragment).not.toMatch(/\brand\(/);
      expect(fragment.toLowerCase()).not.toMatch(/math\.random/);
    }
    set.dispose();
  });

  it('emits no DESCENDING smoothstep, which is UNDEFINED in WGSL', () => {
    // `SHROUD_FRAG` was already written as `1.0 - smoothstep(lo, hi, v)` rather
    // than as a reversed-edge call, and its own comment says why. It translates
    // with nothing to rewrite; this keeps it that way.
    const set = createShroudNodeMaterial();
    const call = /smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g;
    for (const which of ['wgsl', 'glsl'] as const) {
      const src = Object.values(compileNodeMaterial(set.material, which)).join('\n');
      let m: RegExpExecArray | null;
      call.lastIndex = 0;
      while ((m = call.exec(src)) !== null) {
        expect(Number(m[1]), `descending smoothstep in ${which}: ${m[0]}`)
          .toBeLessThan(Number(m[2]));
      }
    }
    set.dispose();
  });

  it('carries the carpet material flags across verbatim', () => {
    // Every one is load-bearing and argued in `FogOfWar.ts` §1b / §2: depth ON
    // so the carpet cannot dim a unit in front of it, no depth write,
    // DoubleSide, no scene fog, and NOT tone mapped.
    const set = createShroudNodeMaterial();
    expect(set.material.transparent).toBe(true);
    expect(set.material.depthTest).toBe(true);
    expect(set.material.depthWrite).toBe(false);
    expect(set.material.side).toBe(THREE.DoubleSide);
    expect(set.material.fog).toBe(false);
    expect(set.material.toneMapped).toBe(false);
    set.dispose();
  });
});

/* ==========================================================================
 * 4. THE UNIFORM VALUES, TRANSCRIBED
 *
 * The literals `FogOfWar`'s `ShaderMaterial` uploads, written out here rather
 * than read back off the node set, so a shared source cannot hide a drift
 * between the two carpets.
 * ========================================================================== */

describe('the carpet uniforms match the shipping ShaderMaterial', () => {
  it('starts from the same constants', () => {
    const set = createShroudNodeMaterial();
    const u = set.uniforms;
    expect(u.uExploredAlpha.value).toBe(FOG_EXPLORED_ALPHA);
    expect(u.uUnexploredAlpha.value).toBe(FOG_UNEXPLORED_ALPHA);
    expect(u.uExploredLevel.value).toBe(FOG_EXPLORED_LEVEL);
    expect(u.uTexel.value).toBe(1 / MAP_CELLS);
    expect(u.uWarp.value).toBe(FOG_EDGE_WARP);
    expect(u.uDither.value).toBe(FOG_DITHER);
    expect(u.uNoiseScale.value).toBe(Math.max(1, DEFAULT_ART.shroud.noiseScale));
    expect(u.uNoiseSpeed.value).toBe(DEFAULT_ART.shroud.noiseSpeed);
    expect(u.uTime.value).toBe(0);
    set.dispose();
  });

  it('resolves the look hexes to LINEAR rgb, as the GLSL path does', () => {
    // `#05070A` is very dark, and sRGB-vs-linear is the whole difference between
    // "near black" and "visibly grey" over a full-map carpet.
    const set = createShroudNodeMaterial();
    const dark = set.uniforms.uUnexploredColor.value;
    expect(dark.x).toBeLessThan(0.01);
    expect(dark.y).toBeLessThan(0.01);
    expect(dark.z).toBeLessThan(0.01);
    // Not zero either — the config comment says "near black, but not pure".
    expect(dark.z).toBeGreaterThan(0);
    set.dispose();
  });

  it('applyLook moves the carpet AND the shared self-tint together', () => {
    /*
     * `FogOfWar.applyLook` writes both, and its comment says why: a mood change
     * that re-tints the ground and leaves every building and ship on the old
     * palette is the bug. Writing `shroudUniforms` also reaches the node path,
     * because Stage D's mirrored uniforms PULL from that singleton.
     */
    const set = createShroudNodeMaterial();
    const beforeTint = shroudUniforms.uFogTint.value.clone();
    const beforeDark = shroudUniforms.uFogDark.value.clone();
    set.applyLook({ ...DEFAULT_ART.shroud, exploredTint: '#FF0000', unexploredColor: '#00FF00' });
    expect(set.uniforms.uExploredTint.value.x).toBeGreaterThan(0.9);
    expect(shroudUniforms.uFogTint.value.x).toBeGreaterThan(0.9);
    expect(shroudUniforms.uFogDark.value.y).toBeGreaterThan(0.9);
    // Alpha channels are not part of a look and must survive the write.
    expect(shroudUniforms.uFogTint.value.w).toBe(FOG_EXPLORED_ALPHA);
    expect(shroudUniforms.uFogDark.value.w).toBe(FOG_UNEXPLORED_ALPHA);
    // Put the module-scope singleton back; other specs share it.
    shroudUniforms.uFogTint.value.copy(beforeTint);
    shroudUniforms.uFogDark.value.copy(beforeDark);
    set.dispose();
  });

  it('swaps the mask texture without rebuilding the graph', () => {
    // `FogOfWar` publishes the real 128x128 R8 long after the material exists.
    const set = createShroudNodeMaterial();
    const real = new THREE.DataTexture(
      new Uint8Array(MAP_CELLS * MAP_CELLS), MAP_CELLS, MAP_CELLS,
      THREE.RedFormat, THREE.UnsignedByteType,
    );
    set.setFogTexture(real);
    expect(set.uniforms.uFog.value).toBe(real);
    expect(compileNodeMaterial(set.material, 'wgsl').fragment.length).toBeGreaterThan(800);
    real.dispose();
    set.dispose();
  });
});

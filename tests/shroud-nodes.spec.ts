/**
 * ============================================================================
 * VOLTMARCH — tests/shroud-nodes.spec.ts
 * ============================================================================
 * THE GATE FOR THE TSL SHROUD PORT (`docs/WEBGPU_MIGRATION_PLAN.md` Stage E).
 *
 * Same instrument and same limits as `tests/terrain-node-material.spec.ts`: a
 * TSL graph compiles to WGSL and to GLSL in plain Node, so "does it still
 * build, on both backends of the node path" is a unit test rather than a
 * browser capture. **A compiled shader is not a correct picture.** What these
 * tests prove is that the graph builds, that the uniforms are wired to the
 * SAME live objects `FogOfWar` mutates, and that the formula the two GLSL
 * copies share is now one function.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { positionWorld, vec3, vec4 } from 'three/tsl';

import { compileNodeMaterial } from './helpers/node-compile';
import {
  createShroudNodeMaterial, shroudTint, shroudTintNodes, syncShroudNodes,
} from '../src/render/shroud-nodes';
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
 * 2. THE STRUCTURES THE GLSL RELIED ON
 * ========================================================================== */

describe('the translated carpet keeps what SHROUD_FRAG did', () => {
  it('declares its noise and dither helpers as FUNCTIONS, not sixteen inlinings', () => {
    /*
     * `vnoise` calls `hash21` four times and the carpet calls `vnoise` four
     * times. Without `.setLayout()` a TSL `Fn` is a MACRO — three emits the body
     * at every call site and renames the collided locals on the way past, which
     * is what Stage C measured on the terrain shader. The names below are the
     * layout names, so finding them is finding real callables.
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

  it('discards the fully-clear fragment rather than blending a zero', () => {
    // `if (a <= 0.003) discard;` — over a 33k-triangle full-map carpet, blending
    // a transparent black is a full-screen overdraw for nothing.
    const set = createShroudNodeMaterial();
    const { fragment } = compileNodeMaterial(set.material, 'wgsl');
    expect(fragment).toMatch(/discard/);
    set.dispose();
  });

  it('takes its screen-space dither from screenCoordinate, not from an RNG', () => {
    /*
     * VISUAL_DNA I1 wants an ORDERED dither: stable frame to frame. White noise
     * here would crawl and read as film grain, which is banned — and
     * `RENDER_FINDINGS` records three's own `DenoiseNode` seeding itself from
     * `Math.random()`, which would also destroy the shot harness's
     * byte-identical captures. Neither `random` nor a seeded-per-run constant
     * may appear.
     */
    const set = createShroudNodeMaterial();
    for (const which of ['wgsl', 'glsl'] as const) {
      const { fragment } = compileNodeMaterial(set.material, which);
      expect(fragment).not.toMatch(/\brand\(/);
      expect(fragment.toLowerCase()).not.toMatch(/math\.random/);
    }
    set.dispose();
  });

  it('carries the carpet material flags across verbatim', () => {
    // Every one of these is load-bearing and argued in `FogOfWar.ts` §1b / §2:
    // depth ON so the carpet cannot dim a unit in front of it, no depth write,
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
 * 3. THE UNIFORM VALUES, TRANSCRIBED
 *
 * These literals are the ones `FogOfWar`'s `ShaderMaterial` uploads, written
 * out here rather than read from the node set, so a shared table cannot hide a
 * drift between the two carpets.
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
    // `#05070A` is very dark and sRGB-vs-linear is the whole difference between
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
     * palette is the bug. The node carpet has to keep that pairing.
     */
    const set = createShroudNodeMaterial();
    const before = shroudUniforms.uFogTint.value.clone();
    set.applyLook({ ...DEFAULT_ART.shroud, exploredTint: '#FF0000', unexploredColor: '#00FF00' });
    expect(set.uniforms.uExploredTint.value.x).toBeGreaterThan(0.9);
    expect(shroudUniforms.uFogTint.value.x).toBeGreaterThan(0.9);
    expect(shroudUniforms.uFogDark.value.y).toBeGreaterThan(0.9);
    // Alpha channels are not part of a look and must survive the write.
    expect(shroudUniforms.uFogTint.value.w).toBe(FOG_EXPLORED_ALPHA);
    expect(shroudUniforms.uFogDark.value.w).toBe(FOG_UNEXPLORED_ALPHA);
    // Put the module-scope object back; other specs share it.
    shroudUniforms.uFogTint.value.copy(before);
    set.dispose();
  });
});

/* ==========================================================================
 * 4. THE SHARED SELF-TINT
 * ========================================================================== */

describe('the shroud self-tint is one graph with the carpet', () => {
  it('compiles into an arbitrary material on both backends', () => {
    /*
     * This is the case `applyShroudTint` serves on the WebGL side, and the case
     * `WaterMaterial.ts` could NOT serve — a raw `ShaderMaterial` has no
     * `onBeforeCompile` for the injection to hook, so the water writes the
     * formula out a third time by hand. On the node path it is a function call
     * from any graph, which is what this proves.
     */
    for (const which of ['wgsl', 'glsl'] as const) {
      const material = new NodeMaterial();
      material.fragmentNode = vec4(
        shroudTint(vec3(0.5, 0.5, 0.5), positionWorld.xz), 1.0,
      );
      const { fragment } = compileNodeMaterial(material, which);
      expect(fragment, `shroudTint missing from ${which}`).toContain('shroudTint');
      expect(fragment).not.toMatch(/NaN/);
      material.dispose();
    }
  });

  it('aliases the three uniforms FogOfWar mutates in place', () => {
    /*
     * THE WHOLE WIRING RESTS ON THIS. `FogOfWar` calls `.set(...)` on these
     * Vector4s; if the node path had allocated its own, the sea and every
     * self-tinting material on the node renderer would freeze at construction
     * and no test that only reads config would ever notice.
     */
    expect(shroudTintNodes.uFogTint.value).toBe(shroudUniforms.uFogTint.value);
    expect(shroudTintNodes.uFogDark.value).toBe(shroudUniforms.uFogDark.value);
    expect(shroudTintNodes.uFogParams.value).toBe(shroudUniforms.uFogParams.value);
  });

  it('syncs the two that CANNOT be aliased', () => {
    // A number and a texture reference are REPLACED by `FogOfWar`, never
    // mutated, so aliasing is impossible and `syncShroudNodes` is the answer.
    const mask = new THREE.DataTexture(
      new Uint8Array([128]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
    );
    const prevMask = shroudUniforms.uFogMask.value;
    const prevAmount = shroudUniforms.uFogAmount.value;

    shroudUniforms.uFogMask.value = mask;
    shroudUniforms.uFogAmount.value = 1;
    expect(shroudTintNodes.uFogAmount.value).not.toBe(1);

    syncShroudNodes();
    expect(shroudTintNodes.uFogMask.value).toBe(mask);
    expect(shroudTintNodes.uFogAmount.value).toBe(1);

    shroudUniforms.uFogMask.value = prevMask;
    shroudUniforms.uFogAmount.value = prevAmount;
    syncShroudNodes();
    mask.dispose();
  });
});

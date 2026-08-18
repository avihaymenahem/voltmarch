/**
 * ============================================================================
 * VOLTMARCH — tests/vfx-node-materials.spec.ts
 * ============================================================================
 * THE GATE FOR THE TSL VFX PORT (the WebGPU migration Stage E).
 *
 * ⚠️ WHAT THIS FILE IS REALLY GUARDING
 * ------------------------------------
 * Explosion brightness has been reported SEVEN times. v2.13.0's two-tier glare
 * budget is the fix, and its properties are measured in frame area over L=0.95:
 *
 *     ONE flash            4.253%   <- must stay BIT-IDENTICAL
 *     5 deaths at 18 m     7.433%
 *     20 deaths at 4 m    12.290%
 *     20 deaths at 18 m   14.314%   (36.200% before the fix)
 *
 * **None of that arithmetic lives in a shader.** `FlashBudget.admitGlare` runs
 * on the CPU and its multiplier reaches both material sets as the same
 * `aTint.x` instance attribute. So the only way a PORT of these materials could
 * move those numbers is by getting `aTint.x`'s USE wrong — and there are exactly
 * four places that use it non-trivially: the additive halo curve, the lit
 * albedo ceiling, the dynamic-light ceiling and the final output ceiling.
 * Section 3 checks all four against the emitted source.
 *
 * Same instrument and same limits as the other Stage C/D/E specs: a TSL graph
 * compiles to WGSL and GLSL in plain Node. **Generating a module is not
 * compiling one** — that is Stage D's finding and it is why section 2 exists.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { compileNodeMaterial } from './helpers/node-compile';
import {
  createVfxAdditiveNodeMaterial, createVfxDebrisNodeMaterial, createVfxLitNodeMaterial,
  createVfxRibbonNodeMaterial,
} from '../src/vfx/vfx-node-materials';
import {
  RIBBON_DEFAULT_FOV_DEG, VFX_ALPHA_CUTOFF, VFX_DEBRIS, VFX_HALO_T0, VFX_HALO_T1,
  VFX_INV_PI, VFX_LIT_FX_FALLOFF_EXP, VFX_LIT_FX_GAIN, VFX_LIT_FX_MAX, VFX_LIT_HEMI_GAIN,
  VFX_LIT_RIM_EXP, VFX_ROW_STEP, litSmokeDefaults, ribbonPxScale,
} from '../src/vfx/vfx-material-constants';
import {
  VFX_ATLAS_COLS, VFX_PX_REFERENCE_HEIGHT, VFX_RAMPS, VFX_SMOKE,
} from '../src/core/config';
import { ParticleSystem } from '../src/vfx/Particles';

/* ==========================================================================
 * FIXTURES
 *
 * The geometries carry every attribute the materials declare. `attribute()`
 * WARNS AND SUBSTITUTES when the geometry lacks a name, which silently compiles
 * a DIFFERENT shader from the one the game runs — so a missing attribute here
 * would turn this whole file into a check on the wrong thing.
 * ========================================================================== */

function fakeTexture(name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** `RibbonBatch`'s geometry: position + aDir + aParam + aRamp, non-instanced. */
function ribbonGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(new Float32Array(16), 4));
  g.setAttribute('aRamp', new THREE.BufferAttribute(new Float32Array(16), 4));
  return g;
}

/** `SpriteLayer`'s geometry: a unit quad plus four instanced attributes. */
function spriteGeometry(): THREE.InstancedBufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  quad.dispose();
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
  g.setAttribute('aQuad', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  g.setAttribute('aRamp', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
  g.instanceCount = 1;
  return g;
}

const BACKENDS = ['wgsl', 'glsl'] as const;

/* ==========================================================================
 * 1. EVERY GRAPH COMPILES, ON BOTH BACKENDS
 * ========================================================================== */

describe('the TSL VFX graphs compile', () => {
  for (const which of BACKENDS) {
    it(`builds the ribbon on ${which}`, () => {
      const set = createVfxRibbonNodeMaterial(fakeTexture('ramps'), VFX_RAMPS.length, 'VfxBeamOverlay', false);
      const { vertex, fragment } = compileNodeMaterial(set.material, which, ribbonGeometry());
      expect(vertex.length).toBeGreaterThan(300);
      expect(fragment.length).toBeGreaterThan(200);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
      set.dispose();
    });

    it(`builds the additive sprite on ${which}`, () => {
      const set = createVfxAdditiveNodeMaterial(fakeTexture('atlas'), fakeTexture('ramps'));
      const { vertex, fragment } = compileNodeMaterial(set.material, which, spriteGeometry());
      expect(vertex.length).toBeGreaterThan(300);
      expect(fragment.length).toBeGreaterThan(300);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
      set.dispose();
    });

    it(`builds the lit smoke on ${which}`, () => {
      const set = createVfxLitNodeMaterial(fakeTexture('atlas'), fakeTexture('ramps'));
      const { vertex, fragment } = compileNodeMaterial(set.material, which, spriteGeometry());
      expect(vertex.length).toBeGreaterThan(300);
      // The lit shader is the biggest of the three: a spherical normal, four
      // albedo terms, a dynamic light and three magnitude clamps.
      expect(fragment.length).toBeGreaterThan(1000);
      expect(vertex).not.toMatch(/NaN/);
      expect(fragment).not.toMatch(/NaN/);
      set.dispose();
    });

    it(`builds the debris on ${which}`, () => {
      const material = createVfxDebrisNodeMaterial();
      const { vertex, fragment } = compileNodeMaterial(material, which);
      expect(vertex.length).toBeGreaterThan(200);
      expect(fragment.length).toBeGreaterThan(500);
      material.dispose();
    });
  }
});

/* ==========================================================================
 * 2. NO DECLARED WGSL FUNCTION REACHES OUTSIDE ITSELF
 *
 * Stage D's check. `.setLayout()` emits a real WGSL function and a WGSL
 * function sees nothing but its declared parameters, so a body reading an
 * attribute, a varying or a uniform produces `unresolved value` in Chrome while
 * every offline test above passes — the GLSL backend inlines regardless.
 *
 * This file declares exactly ONE layout, on `rotate2d`, whose only inputs are
 * its parameters. This is what keeps that true.
 * ========================================================================== */

describe('the VFX graphs declare no capturing function', () => {
  const OUT_OF_SCOPE = [
    'aDir', 'aParam', 'aRamp', 'aOffset', 'aQuad', 'aTint',
    'vSide', 'vFall', 'vRamp', 'vUv', 'vLocal', 'vTint', 'vViewPos',
  ];

  function declaredFunctions(wgsl: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wgsl)) !== null) {
      // `main` IS the entry point and legitimately holds every attribute and
      // varying in the module.
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

  const cases: ReadonlyArray<readonly [string, () => THREE.Material, () => THREE.BufferGeometry]> = [
    ['the ribbon',
      () => createVfxRibbonNodeMaterial(fakeTexture('r'), VFX_RAMPS.length, 'VfxBeamOverlay', false).material,
      ribbonGeometry],
    ['the additive sprite',
      () => createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r')).material,
      spriteGeometry],
    ['the lit smoke',
      () => createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r')).material,
      spriteGeometry],
  ];

  for (const [label, make, geo] of cases) {
    it(`declares no capturing function in ${label}`, () => {
      const material = make();
      const { vertex, fragment } = compileNodeMaterial(material, 'wgsl', geo());
      for (const stage of [vertex, fragment]) {
        for (const fn of declaredFunctions(stage)) {
          for (const name of OUT_OF_SCOPE) {
            expect(fn.body, `fn ${fn.name} reads ${name}, which only main can see`)
              .not.toMatch(new RegExp(`\\b${name}\\b`));
          }
          expect(fn.body, `fn ${fn.name} reads a nodeUniform, which only main can see`)
            .not.toMatch(/\bnodeUniform\d+\b/);
        }
      }
      material.dispose();
    });
  }

  it('still declares the ONE pure helper as a real function', () => {
    /*
     * The other half of the rule. `rotate2d` is called twice per sprite vertex
     * with the same angle, and its inputs are all parameters, so the layout is
     * both legal and worth having. If this disappears, either the layout was
     * dropped or three stopped emitting declared functions — and in the second
     * case section 2's scans above have quietly become vacuous.
     */
    const set = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    for (const which of BACKENDS) {
      const { vertex } = compileNodeMaterial(set.material, which, spriteGeometry());
      expect(vertex, `vfxRotate2d missing from ${which}`).toContain('vfxRotate2d');
    }
    set.dispose();
  });
});

/* ==========================================================================
 * 2b. THE VARYINGS CARRY WHAT THE VERTEX STAGE COMPUTED
 *
 * THIS SECTION EXISTS BECAUSE THE FIRST VERSION OF THE PORT SHIPPED (0, 0) IN
 * TWO OF THEM AND EVERY OTHER TEST IN THIS FILE PASSED.
 *
 * The shape that fails: compute into a module-scope `vec2().toVar()`, call the
 * vertex `Fn`, then wrap the var with `varying( v, 'vUv' )`. `varying()` emits
 * its assignment where the NODE IS RESOLVED, not where the var is last written,
 * so the emitted vertex stage read
 *
 *     spriteUvOut = vec2( 0.0, 0.0 );
 *     vUv = spriteUvOut;                 <- the INITIAL value
 *     ...
 *     spriteUvOut = ( ( uv + ... ) );    <- twenty lines later
 *
 * That is a black atlas tile and a dead radial ramp: no white fireball core
 * (scorecard #14), no spherical shading on smoke, on the WebGPU path only. It
 * compiled clean on both backends and tripped no name-presence check.
 *
 * So these assert the RIGHT-HAND SIDE, not the name.
 * ========================================================================== */

describe('the sprite varyings are assigned from the computed values', () => {
  it('takes vUv from the atlas cell, not from an initialiser', () => {
    const set = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { vertex } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    // `vUv = ( ( uv + vec2( spriteCol, spriteRow ) ) / vec2( uCols ) )`
    expect(vertex).toMatch(/vUv\s*=\s*\(\s*\(\s*uv\b/);
    expect(vertex).toMatch(/spriteCol/);
    expect(vertex).toMatch(/spriteRow/);
    // And it is never assigned a bare zero vector, which is what the broken
    // version did as its ONLY assignment.
    expect(vertex).not.toMatch(/vUv\s*=\s*vec2\(\s*0\.0\s*,\s*0\.0\s*\)/);
    set.dispose();
  });

  it('takes vLocal from the rotated quad corner', () => {
    // `vLocal = vfxRotate2d( position.xy * 2.0, c, s )` — this is what sweeps
    // the ramp across the sprite radius and what fakes the spherical normal.
    const set = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { vertex } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(vertex).toMatch(/vLocal\s*=\s*vfxRotate2d\(/);
    expect(vertex).not.toMatch(/vLocal\s*=\s*vec2\(\s*0\.0\s*,\s*0\.0\s*\)/);
    set.dispose();
  });

  it('takes vViewPos from the branch-resolved view position', () => {
    // The lit shader's dynamic light is `uFxPosView - vViewPos`. A varying stuck
    // at the origin would put every puff at the camera and light none of them.
    const set = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { vertex } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(vertex).toMatch(/vViewPos\s*=\s*spriteMv\.xyz/);
    set.dispose();
  });

  it('carries the ramp and tint attributes straight through', () => {
    // These two have no ordering hazard — they are attributes, not computed —
    // but `vTint.x` is where the flash budget's multiplier arrives, so a
    // dropped assignment would be the loudest possible regression.
    const set = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { vertex } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(vertex).toMatch(/vRamp\s*=\s*aRamp/);
    expect(vertex).toMatch(/vTint\s*=\s*aTint/);
    set.dispose();
  });

  it('gives the ribbon its three varyings off the right attribute channels', () => {
    // side, falloff exponent, and the packed ramp row / t / intensity / alpha.
    const set = createVfxRibbonNodeMaterial(fakeTexture('r'), VFX_RAMPS.length, 'VfxBeamOverlay', false);
    const { vertex } = compileNodeMaterial(set.material, 'glsl', ribbonGeometry());
    expect(vertex).toMatch(/vSide\s*=\s*aParam\.x/);
    expect(vertex).toMatch(/vFall\s*=\s*aParam\.w/);
    expect(vertex).toMatch(/vRamp\s*=\s*aRamp/);
    set.dispose();
  });
});

/* ==========================================================================
 * 3. THE FOUR PLACES `aTint.x` IS TRANSFORMED
 *
 * The flash budget's multiplier arrives here. Everywhere else it is a plain
 * multiply, which cannot go subtly wrong; these four can.
 * ========================================================================== */

describe('the gain path the flash budget feeds is translated verbatim', () => {
  it('ramps the additive HDR gain down across the sprite, not flat', () => {
    /*
     * `halo = 1 - smoothstep(T0, T1, t); graded = mix(1, vTint.x, halo);
     *  col = ramp.rgb * mix(vTint.x, graded, vRamp.w)`.
     *
     * A flat gain pushes the fireball ramp's #FF9350 fringe over 1.0 in every
     * channel and the tonemapper maps the whole billow to the same white as the
     * core — scorecard #14 failed while the ramp looks correct. The previous
     * curve, `pow(1 - t, 0.6)`, kept the ENTIRE billow above the bloom threshold
     * out to t~0.96; the smoothstep ends it around t=0.68.
     */
    const set = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { fragment } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(fragment).toMatch(
      new RegExp(`smoothstep\\(\\s*${VFX_HALO_T0}\\s*,\\s*${VFX_HALO_T1}\\s*,`),
    );
    // Both halves of the two-level mix have to survive, or a life-driven sprite
    // (vRamp.w = 0) silently takes the radial curve as well.
    expect(fragment).toMatch(/\badditiveHalo\b/);
    expect(fragment).toMatch(/\badditiveGraded\b/);
    set.dispose();
  });

  it('keeps all THREE magnitude renormalisations in the lit shader', () => {
    /*
     * Each one is a `if (peak > lim) x *= lim / peak` over the MAGNITUDE, never
     * per channel — clamping channels independently pins R, G and B to the same
     * ceiling and turns a warm dust puff white, which is the exact failure they
     * were added to fix.
     *
     *   litPeak     the albedo sum ceiling  (05-combat's white sheet)
     *   litFxPeak   the dynamic light       (+12.9 linear on a 0.283 budget)
     *   litOutPeak  after vTint.x           (a wreck column's envelope)
     */
    const set = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { fragment } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    for (const marker of ['litPeak', 'litFxPeak', 'litOutPeak', 'litLim']) {
      expect(fragment, `${marker} missing`).toMatch(new RegExp(`\\b${marker}\\b`));
    }
    set.dispose();
  });

  it('does not let the inner block shadow the outer w and peak', () => {
    /*
     * `LIT_FRAG` declares `float w` and `float peak` at the outer scope and AGAIN
     * inside `if (d < uFxRange)`. Both are legal in GLSL and a naive flattening
     * translation silently reuses the outer ones — which would make the dynamic
     * light's falloff window the sun's half-lambert term. The port renames them,
     * and this is the assertion that says so.
     */
    const set = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { fragment } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(fragment).toMatch(/\blitW\b/);
    expect(fragment).toMatch(/\blitFxW\b/);
    expect(fragment).toMatch(/\blitPeak\b/);
    expect(fragment).toMatch(/\blitFxPeak\b/);
    set.dispose();
  });

  it('treats the dynamic light as IRRADIANCE, through albedo and 1/PI', () => {
    // Light reflects off smoke; it does not add to it. The old line added raw
    // candela and moved frame-mean luminance by -37 L on a 112 L frame when the
    // mesh was hidden.
    const set = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { fragment } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect(fragment).toContain(String(VFX_INV_PI));
    expect(fragment).toMatch(/\blitAtten\b/);
    // The range window is SQUARED — `w * w` — matching three's own point-light
    // cutoff, so the wash reaches zero AT uFxRange rather than stepping off.
    expect(fragment).toMatch(/litFxW\s*\*\s*litFxW|litFxW\d*\s*\*\s*litFxW/);
    set.dispose();
  });
});

/* ==========================================================================
 * 4. BLENDING, FLAGS AND THE TWO SPRITE DISCARDS
 * ========================================================================== */

describe('the VFX materials carry the shipping flags', () => {
  it('blends PREMULTIPLIED, never through a three preset', () => {
    /*
     * The fragment already multiplied by alpha, so SRC must be ONE.
     * `AdditiveBlending` uses SRC_ALPHA and would SQUARE the alpha, dimming
     * every core exactly where it has to clip to white.
     */
    const live = new ParticleSystem();
    const additive = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const lit = createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r'));

    /*
     * `SpriteLayer.material` is typed `THREE.Material` now, so Stage F can hand
     * it a node material. `fog` is declared on the concrete subclasses rather
     * than on the base, so the comparison narrows here rather than widening the
     * field back and losing the point of the change.
     */
    const asFogged = (m: THREE.Material): THREE.MeshBasicMaterial =>
      m as THREE.MeshBasicMaterial;

    for (const [node, shipped] of [
      [asFogged(additive.material), asFogged(live.additive.material)],
      [asFogged(lit.material), asFogged(live.lit.material)],
    ] as const) {
      expect(node.blending).toBe(shipped.blending);
      expect(node.blendSrc).toBe(shipped.blendSrc);
      expect(node.blendDst).toBe(shipped.blendDst);
      expect(node.blendEquation).toBe(shipped.blendEquation);
      expect(node.transparent).toBe(shipped.transparent);
      expect(node.depthWrite).toBe(shipped.depthWrite);
      expect(node.depthTest).toBe(shipped.depthTest);
      expect(node.side).toBe(shipped.side);
      expect(node.fog).toBe(shipped.fog);
    }
    expect(additive.material.blendSrc).toBe(THREE.OneFactor);
    expect(additive.material.blendDst).toBe(THREE.OneFactor);
    expect(lit.material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);

    additive.dispose();
    lit.dispose();
    live.dispose();
  });

  it('gives the two ribbon instances the same material and different depth', () => {
    // `VfxBeamOverlay` draws over everything; `VfxRibbonDepth` sits inside the
    // particle band. One flag, exactly as `RibbonBatch`'s constructor does it.
    const overlay = createVfxRibbonNodeMaterial(fakeTexture('r'), VFX_RAMPS.length, 'VfxBeamOverlay', false);
    const depthed = createVfxRibbonNodeMaterial(fakeTexture('r'), VFX_RAMPS.length, 'VfxRibbonDepth', true);
    expect(overlay.material.depthTest).toBe(false);
    expect(depthed.material.depthTest).toBe(true);
    expect(overlay.material.depthWrite).toBe(false);
    expect(depthed.material.depthWrite).toBe(false);
    expect(overlay.material.name).toBe('VfxBeamOverlay');
    expect(depthed.material.name).toBe('VfxRibbonDepth');
    overlay.dispose();
    depthed.dispose();
  });

  it('discards twice in the sprite prologue, as SPRITE_SAMPLE does', () => {
    // The atlas cutout and the composed alpha are separate rejections: 1200
    // additive sprites blending a transparent black is real overdraw for no
    // pixels. Both must survive, and `Discard` is a statement rather than an
    // early return.
    const set = createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r'));
    const { fragment } = compileNodeMaterial(set.material, 'glsl', spriteGeometry());
    expect((fragment.match(/discard/g) ?? []).length).toBeGreaterThanOrEqual(2);
    set.dispose();
  });

  it('keeps the debris opaque, rough and flat-shaded', () => {
    const node = createVfxDebrisNodeMaterial();
    const live = new ParticleSystem();
    const shipped = live.debris.mesh.material as THREE.MeshStandardMaterial;
    expect(node.roughness).toBe(shipped.roughness);
    expect(node.metalness).toBe(shipped.metalness);
    expect(node.flatShading).toBe(shipped.flatShading);
    expect(node.color.getHex()).toBe(shipped.color.getHex());
    expect(node.transparent).toBe(false);
    node.dispose();
    live.dispose();
  });
});

/* ==========================================================================
 * 5. THE SHARED CONSTANTS ARE ON THEIR PRE-MOVE VALUES
 *
 * `vfx-material-constants.ts` did not exist before this stage; every value was
 * a module-private `const` or an inline literal in a GLSL template. They are
 * written out again here from `config.ts` and from the pre-move numbers, so a
 * shared table cannot hide a change that reaches BOTH renderers at once.
 * ========================================================================== */

describe('the extracted VFX constants did not move', () => {
  it('keeps the additive halo curve', () => {
    expect(VFX_HALO_T0).toBe(0.50);
    expect(VFX_HALO_T1).toBe(0.70);
  });

  it('keeps the lit dynamic-light gain and ceiling', () => {
    expect(VFX_LIT_FX_GAIN).toBe(0.35);
    // Bible §8.7's fireball-lit underside `#926339`, brightest channel 0.283
    // linear. A puff may reach it and no further.
    expect(VFX_LIT_FX_MAX).toBe(0.30);
    expect(VFX_INV_PI).toBe(0.3183098862);
    expect(VFX_LIT_FX_FALLOFF_EXP).toBe(1.35);
    expect(VFX_LIT_HEMI_GAIN).toBe(0.22);
    expect(VFX_LIT_RIM_EXP).toBe(3.0);
  });

  it('keeps the alpha cutoff and the ramp row step', () => {
    expect(VFX_ALPHA_CUTOFF).toBe(0.003);
    expect(VFX_ROW_STEP).toBe(1 / VFX_RAMPS.length);
    expect(VFX_RAMPS.length).toBe(16);
    expect(VFX_ATLAS_COLS).toBe(4);
  });

  it('keeps the reference-pixel scale formula', () => {
    // `2 * tan(fovY/2) / 1440`, and the 36 both batches are built at.
    expect(RIBBON_DEFAULT_FOV_DEG).toBe(36);
    expect(ribbonPxScale(36)).toBeCloseTo(
      2 * Math.tan(THREE.MathUtils.degToRad(36) * 0.5) / VFX_PX_REFERENCE_HEIGHT, 12,
    );
    // And a zoom really does change it, or `setFov` is decoration.
    expect(ribbonPxScale(20)).toBeLessThan(ribbonPxScale(36));
  });

  it('keeps the fourteen lit-smoke defaults', () => {
    const d = litSmokeDefaults();
    expect(d.uSunColor.toArray()).toEqual([1, 0.87, 0.72]);
    expect(d.uHemiSky.toArray()).toEqual([0.28, 0.42, 0.72]);
    expect(d.uHemiGround.toArray()).toEqual([0.18, 0.14, 0.10]);
    expect(d.uTintGain).toBe(VFX_SMOKE.tintGain);
    expect(d.uShadeGain).toBe(VFX_SMOKE.shadeGain);
    expect(d.uRimGain).toBe(VFX_SMOKE.rimGain);
    // Parked far below the map = inactive. Zero would be a real position, and
    // a plume standing at the origin would take a black light every frame.
    expect(d.uFxPosView.toArray()).toEqual([0, -1e6, 0]);
    expect(d.uFxRange).toBe(0);
    // The three shading swatches are LINEAR, not sRGB — the difference between
    // #14120F reading as near-black and reading as mid-grey over a whole plume.
    expect(d.uShadeDark.x).toBeLessThan(0.02);
    expect(d.uShadeLit.x).toBeGreaterThan(0.2);
    expect(d.uShadeLit.x).toBeLessThan(0.35);
  });

  it('gives each factory its own mutable vectors', () => {
    // `syncLighting` and `setDominantLight` write these every frame. A shared
    // Vector3 would make one renderer's camera drive the other's.
    const a = litSmokeDefaults();
    const b = litSmokeDefaults();
    expect(a.uSunDirView).not.toBe(b.uSunDirView);
    expect(a.uShadeLit).not.toBe(b.uShadeLit);
  });

  it('leaves the shipping GLSL byte-identical after the extraction', () => {
    /*
     * The literals were interpolated back into the template strings with an
     * explicit `toFixed`, so the emitted GLSL is exactly what it was. `3.0`
     * is the one that would break silently: `${VFX_LIT_RIM_EXP}` alone
     * stringifies to `"3"`, which is an INT literal, and `pow(float, int)` does
     * not exist in GLSL ES 3.00.
     */
    const live = new ParticleSystem();
    const lit = live.lit.material as THREE.ShaderMaterial;
    const additive = live.additive.material as THREE.ShaderMaterial;
    expect(lit.fragmentShader).toContain('pow(max(ndl, 0.0), 3.0)');
    expect(lit.fragmentShader).toContain('+ hemi * 0.22');
    expect(lit.fragmentShader).toContain('pow(d, 1.35)');
    expect(lit.fragmentShader).toContain('0.3183098862');
    expect(additive.fragmentShader).toContain('smoothstep(0.50, 0.70, t)');
    expect(additive.fragmentShader).toContain('if (tex.a <= 0.003) discard;');
    live.dispose();
  });
});

/* ==========================================================================
 * 6. VFX IS NOT SHROUDED, ON EITHER PATH
 * ========================================================================== */

describe('VFX takes no shroud tint', () => {
  it('never writes or reads the shroud varying', () => {
    /*
     * Deliberate and worth pinning: an explosion inside the fog is a thing you
     * are MEANT to see, and `applyShroudTint` appears nowhere under `src/vfx/`.
     * A port that helpfully added it would dim every muzzle flash in unexplored
     * territory, which is a gameplay change wearing a renderer's clothes.
     */
    const sets = [
      createVfxAdditiveNodeMaterial(fakeTexture('a'), fakeTexture('r')),
      createVfxLitNodeMaterial(fakeTexture('a'), fakeTexture('r')),
    ];
    for (const set of sets) {
      const { vertex, fragment } = compileNodeMaterial(set.material, 'wgsl', spriteGeometry());
      expect(vertex).not.toContain('vShroudUv');
      expect(fragment).not.toContain('vShroudUv');
      set.dispose();
    }
  });
});

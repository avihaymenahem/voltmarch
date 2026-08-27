/**
 * ============================================================================
 * VOLTMARCH — src/render/ground-overlay-nodes.ts
 * ============================================================================
 * THE TWO MULTIPLY-BLENDED GROUND OVERLAYS, AS TSL NODE GRAPHS. Stage F of
 * the WebGPU migration.
 *
 *   - the contact-shadow pool  (`./ContactShadows.ts`'s `CONTACT_FRAG`)
 *   - the decal field          (`../world/Decals.ts`'s `DECAL_FRAG`)
 *
 * TWO SHADERS IN ONE FILE BECAUSE THEY ARE ONE CONTRACT. Both emit a
 * MULTIPLY FACTOR into `(DstColorFactor, ZeroFactor)` with alpha untouched, and
 * both clamp that factor at `DECAL_DARKEN_FLOOR` so no single overlay can take
 * a square metre of terrain to black. `Decals.ts` documents that contract at
 * length and `ContactShadows.ts` says "the identical multiply contract"; putting
 * the node twins in one file is what stops the next person porting half of it.
 *
 * ── WHY THESE TWO WERE NOT IN STAGES B..E ───────────────────────────────────
 * Same reason as `sky-nodes.ts`: the stage inventory tracked `onBeforeCompile`
 * sites and the raw `ShaderMaterial`s that carry LIT shading, and these two are
 * unlit `ShaderMaterial`s that nothing injects into (the contact pool's single
 * `onBeforeCompile` is one call to `applyShroudFactor`, which counted as a shroud
 * site rather than a material). `ShaderMaterial` is absent from
 * `StandardNodeLibrary`, so under `WebGPURenderer` both draw through a bare
 * `NodeMaterial` — a black quad where a multiply factor should be, over a
 * `DstColor` blend, i.e. every unit gets a hard black square under it.
 *
 * ── THE ONE THING THAT IS NOT A TRANSCRIPTION ───────────────────────────────
 * `CONTACT_FRAG`'s `if (a <= 0.0) discard;` becomes `Discard( a.lessThanEqual(0) )`
 * and `DECAL_FRAG`'s `if (fade <= 0.002) discard;` likewise. Everything else is
 * the same expression in the same order.
 * ============================================================================
 */

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Discard, Fn, attribute, clamp, float, floor, length, max, mix, mod, smoothstep,
  texture, uniform, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';

import {
  CONTACT_DARKEN_COLOR, CONTACT_DARKEN_CORE, CONTACT_DARKEN_PEAK_ALPHA,
  DECAL_DARKEN_FLOOR,
} from '../core/config';
import { hexToLinearRgb } from '../core/math';
import { shroudFactor, shroudVertexUv } from './shroud-nodes';

type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE CONTACT POOL
 * ========================================================================== */

/**
 * The node twin of `ContactShadows.ts`'s material.
 *
 * It carries the shroud multiply-factor fade from the GLSL path: a pool is
 * ground truth about explored terrain and must become the neutral factor white
 * under fog. `shroudVertexUv()` in `setupPosition` and `shroudFactor()` in
 * `setupOutput` are a pair — forget the first and the second samples garbage.
 */
export function createContactShadowNodeMaterial(): NodeMaterial {
  const rgb = new Float32Array(3);
  hexToLinearRgb(CONTACT_DARKEN_COLOR, rgb as unknown as number[]);

  const uColor = uniform(new THREE.Vector3(rgb[0], rgb[1], rgb[2]));
  const uPeak = uniform(CONTACT_DARKEN_PEAK_ALPHA);
  const uCore = uniform(CONTACT_DARKEN_CORE);
  const uFloor = uniform(DECAL_DARKEN_FLOOR);

  const pool = Fn(() => {
    // Radial distance from the quad centre, 0..1 at the inscribed circle.
    const r = length(uv().sub(0.5)).mul(2.0).toVar('poolR');
    // ASCENDING with the inversion outside, as the GLSL wrote it.
    const a = smoothstep(uCore, float(1.0), r).oneMinus().toVar('poolA');
    Discard(a.lessThanEqual(0.0));
    const k = a.mul(uPeak).toVar('poolK');
    // A FACTOR, not a paint.
    const f = mix(vec3(1.0), uColor, k).toVar('poolF');
    return vec4(max(f, vec3(uFloor)), 1.0);
  });

  const material = new (class ContactShadowNodeMaterial extends NodeMaterial {
    override setupPosition(builder: Parameters<NodeMaterial['setupPosition']>[0]): Node {
      const position = super.setupPosition(builder) as Node;
      shroudVertexUv();
      return position;
    }
    override setupOutput(
      builder: Parameters<NodeMaterial['setupOutput']>[0], out: Node,
    ): Node {
      return super.setupOutput(builder, shroudFactor(out as Vec4N)) as Node;
    }
  })();

  material.name = 'ContactShadowsNode';
  material.fragmentNode = pool() as unknown as Vec4N;
  applyMultiplyBlend(material);
  return material;
}

/* ==========================================================================
 * 2. THE DECAL FIELD
 * ========================================================================== */

export interface DecalNodeMaterialSet {
  readonly material: NodeMaterial;
  /** The field's own clock. Written every frame by `DecalField.frame`. */
  setTime(t: number): void;
  dispose(): void;
}

/**
 * The node twin of `Decals.ts`'s material.
 *
 * `ATLAS_COLS` and `TILE_INSET` are passed in rather than imported so this file
 * does not have to reach into `Decals.ts`'s private section — and, more usefully,
 * so the numbers arrive from the ONE place that builds the atlas they describe.
 *
 * **`uCols` IS A UNIFORM AND `TILE_INSET` IS A LITERAL, EXACTLY AS IN THE GLSL.**
 * The GLSL interpolates `${TILE_INSET.toFixed(6)}` into its source, which is the
 * trap `TSL_GAPS` records from the other direction (`${3.0}` prints `3`, which
 * GLSL ES reads as an int). Here it is a JS number handed to `clamp`, which TSL
 * wraps as a float node — no printing involved, so the trap cannot fire.
 */
export function createDecalNodeMaterial(
  atlas: THREE.Texture, atlasCols: number, tileInset: number,
): DecalNodeMaterialSet {
  const uAtlas = texture(atlas);
  const uTime = uniform(0);
  const uCols = uniform(atlasCols);
  const uFloor = uniform(DECAL_DARKEN_FLOOR);

  /** `aUv`, `aParams`, `aTint` — the three custom vertex attributes. */
  const aUv = attribute<'vec2'>('aUv', 'vec2');
  const aParams = attribute<'vec4'>('aParams', 'vec4');
  const aTint = attribute<'vec3'>('aTint', 'vec3');

  const vUv = varyingProperty('vec2', 'vUv');
  const vParams = varyingProperty('vec4', 'vParams');
  const vTint = varyingProperty('vec3', 'vTint');

  const paint = Fn(() => {
    const life = vParams.z.toVar('decalLife');
    const age = max(uTime.sub(vParams.y), float(0.0)).toVar('decalAge');
    /*
     * `life <= 0` means permanent (bible §8.10: scorch never fades, it is
     * evicted). Otherwise hold full strength to 55% of life, then ramp out.
     *
     * The GLSL is a ternary; `select` is the node form and evaluates BOTH arms,
     * which is fine because the fading arm is pure arithmetic on values that are
     * always finite — `smoothstep(0, 0, age)` where life is 0 is the degenerate
     * `edge0 == edge1` case, and WGSL leaves only `edge0 > edge1` undefined.
     * Written as a `select` on the multiplier rather than on the whole
     * expression so the discard below sees one value.
     */
    const fade = life.lessThanEqual(0.0).select(
      float(1.0),
      smoothstep(life.mul(0.55), life, age).oneMinus(),
    ).toVar('decalFade');
    Discard(fade.lessThanEqual(0.002));

    // Clamp inside the tile so bilinear filtering can never sample a neighbour.
    const t = clamp(vUv, float(tileInset), float(1 - tileInset)).toVar('decalT');
    const col = mod(vParams.x, uCols).toVar('decalCol');
    const row = floor(vParams.x.div(uCols)).toVar('decalRow');
    const s = uAtlas.sample(vec2(col, row).add(t).div(uCols)).toVar('decalS');

    const a = s.a.mul(vParams.w).mul(fade).toVar('decalA');
    // RGB is a multiply factor stored at half scale, so 0.5 decodes to 1.0.
    const factor = vTint.mul(s.rgb.mul(2.0)).toVar('decalFactor');
    return vec4(max(mix(vec3(1.0), factor, a), vec3(uFloor)), 1.0);
  });

  const material = new (class DecalNodeMaterial extends NodeMaterial {
    override setupPosition(builder: Parameters<NodeMaterial['setupPosition']>[0]): Node {
      const position = super.setupPosition(builder) as Node;
      // Written INSIDE the vertex flow, after super, for the Stage E reason:
      // a `varying()` wrapped around a module-scope `toVar` emits its assignment
      // where the node RESOLVES, so both of that port's varyings shipped as
      // (0, 0) — compiling clean on both backends and passing every
      // name-presence assertion.
      vUv.assign(aUv);
      vParams.assign(aParams);
      vTint.assign(aTint);
      shroudVertexUv();
      return position;
    }
    override setupOutput(
      builder: Parameters<NodeMaterial['setupOutput']>[0], out: Node,
    ): Node {
      return super.setupOutput(builder, shroudFactor(out as Vec4N)) as Node;
    }
  })();

  material.name = 'GroundDecalsNode';
  material.fragmentNode = paint() as unknown as Vec4N;
  applyMultiplyBlend(material);

  return {
    material,
    setTime(t: number): void { uTime.value = t; },
    dispose(): void { material.dispose(); },
  };
}

/* ==========================================================================
 * 3. THE SHARED BLEND
 * ========================================================================== */

/**
 * The multiply contract, written once.
 *
 * src is a FACTOR, dst is the lit frame. Alpha is left alone so an overlay can
 * never punch a hole in a target carrying coverage. The polygon offset is what
 * supplements the physical overlay lift at a grazing camera.
 */
function applyMultiplyBlend(material: NodeMaterial): void {
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.toneMapped = false;
  material.fog = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.DstColorFactor;
  material.blendDst = THREE.ZeroFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -3;
  material.polygonOffsetUnits = -3;
}

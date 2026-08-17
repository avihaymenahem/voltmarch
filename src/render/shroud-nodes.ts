/**
 * ============================================================================
 * VOLTMARCH — src/render/shroud-nodes.ts
 * ============================================================================
 * THE SHROUD, AS A TSL NODE GRAPH. Stage E of `docs/WEBGPU_MIGRATION_PLAN.md`.
 *
 * `./FogOfWar.ts` is the shipping WebGL implementation and stays exactly as it
 * is. It draws the fog TWICE, in two languages that happen to agree:
 *
 *   1. `SHROUD_FRAG` — the draped carpet, which owns the ground plane;
 *   2. `SHROUD_TINT_FRAG` — the same alpha/colour formula, injected by
 *      `applyShroudTint` into every material that draws ABOVE the carpet.
 *
 * and `src/world/WaterMaterial.ts` writes it out a THIRD time inline, with a
 * comment reading "Same formula as applyShroudTint()", because a raw
 * `ShaderMaterial` has no `onBeforeCompile` for the injection to hook.
 *
 * ON THE NODE PATH THAT THIRD COPY IS UNNECESSARY AND THE SECOND IS A FUNCTION
 * CALL. `shroudTint()` below is ONE graph. The carpet calls it for its own
 * colour, `WaterNodeMaterial` calls it for the sea, and any Stage D material
 * that wants the self-tint calls it too. Three copies of a formula that must
 * agree become one, which is the single clearest thing this stage buys.
 *
 * WHAT IS DELIBERATELY IDENTICAL
 * ------------------------------
 *  - **The warp and the dither are on the CARPET only.** `FogOfWar.ts` §1b says
 *    why: they exist to break a 4 m texel grid across a full-screen surface and
 *    buy nothing on a 3 m silhouette. `shroudTint` therefore does NOT warp, and
 *    a remembered building keeps exactly the tint it has today.
 *  - **`exploredDesat` still has no uniform**, on either path, for the reason
 *    `FogOfWar.applyLook` gives: desaturating what is already in the frame needs
 *    a destination read a forward pass does not have. It is expressed as alpha
 *    toward an already-desaturated `exploredTint`.
 *  - **Both `smoothstep`s were already ascending** — `1.0 - smoothstep(a, b, v)`
 *    with a < b, not `smoothstep(b, a, v)` — so the WGSL hazard Stage C hit does
 *    not arise here. The GLSL comment at that line explains that it was written
 *    that way on purpose; it turns out to have been written for the right
 *    reason four years early.
 *
 * THE UNIFORMS ARE SHARED BY REFERENCE WHERE THAT IS POSSIBLE, AND SYNCED WHERE
 * IT IS NOT — AND EXACTLY TWO NEED SYNCING
 * ---------------------------------------------------------------------------
 * `shroudUniforms` in `FogOfWar.ts` is the live object every WebGL material
 * holds. A TSL `uniform( v )` node keeps `v` on `.value`, so handing it the SAME
 * `THREE.Vector4` makes `FogOfWar`'s in-place `.set(...)` calls visible to the
 * node graph for free — that covers `uFogTint`, `uFogDark` and `uFogParams`.
 *
 * The other two are REPLACED rather than mutated: `uFogMask.value = texture`
 * when the real 128x128 mask is published, and `uFogAmount.value = 0 | 1` from
 * `syncGate()`. A number and a texture reference cannot be aliased, so
 * `syncShroudNodes()` copies those two and only those two. It is called once per
 * frame by the node renderer's bridge; calling it more often is free and calling
 * it never means the sea and the ground disagree about whether fog exists, which
 * is precisely the failure `syncGate` was written to prevent.
 *
 * NOTHING IN `src/` IMPORTS THIS YET. The seam wires it up in Stage F, through a
 * DYNAMIC import behind `requestedBackend()` — a static import from anything the
 * main chunk already pulls in drags the whole node system into the bundle every
 * WebGL player downloads.
 * ============================================================================
 */

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Discard, Fn, float, floor, fract, mix, positionWorld, screenCoordinate,
  smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

import {
  DEFAULT_ART, FOG_DITHER, FOG_EDGE_WARP, FOG_EXPLORED_ALPHA, FOG_EXPLORED_LEVEL,
  FOG_UNEXPLORED_ALPHA, MAP_CELLS,
} from '../core/config';
import { hexToLinearRgb } from '../core/math';
import type { ShroudLook } from '../core/types';
import { shroudUniforms } from './FogOfWar';

type FloatN = Node<'float'>;
type Vec2N = Node<'vec2'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;

/* ==========================================================================
 * 1. THE SHARED SELF-TINT
 * ========================================================================== */

/**
 * The node twins of `shroudUniforms`.
 *
 * Three of the five alias the WebGL objects outright; see the header for which
 * two cannot and why. Nothing here allocates a Vector — that would fork the
 * value and the sea would freeze at whatever tint it was built with.
 */
export const shroudTintNodes = {
  /**
   * Constructed from whatever `shroudUniforms.uFogMask` holds RIGHT NOW, which
   * at module load is the 1x1 "fully visible" `RedFormat` default. The shape is
   * what matters — a TSL `texture()` reads its sampler type off the value it was
   * given — and the real 128x128 mask is the same shape, so the swap in
   * `syncShroudNodes` is a pointer move rather than a recompile.
   */
  uFogMask: texture(shroudUniforms.uFogMask.value),
  /** Aliased: `FogOfWar` mutates this Vector4 in place. */
  uFogTint: uniform(shroudUniforms.uFogTint.value),
  /** Aliased. */
  uFogDark: uniform(shroudUniforms.uFogDark.value),
  /** Aliased. x = 1/MAP_SIZE, y = FOG_EXPLORED_LEVEL. */
  uFogParams: uniform(shroudUniforms.uFogParams.value),
  /** NOT aliased — a number is replaced, never mutated. */
  uFogAmount: uniform(shroudUniforms.uFogAmount.value),
};

/**
 * Pull the two un-aliasable slots across from `shroudUniforms`.
 *
 * Cheap and idempotent: two property reads and two writes, no allocation, no
 * `needsUpdate`. Call it once per frame from wherever the node renderer's frame
 * hook lives.
 */
export function syncShroudNodes(): void {
  shroudTintNodes.uFogMask.value = shroudUniforms.uFogMask.value;
  shroudTintNodes.uFogAmount.value = shroudUniforms.uFogAmount.value;
}

/**
 * `SHROUD_TINT_FRAG`, and the block `WATER_FRAG` inlines, as one graph.
 *
 * @param color    Scene-linear rgb, BEFORE tone mapping — the carpet composites
 *                 in that space too, because three forces `NoToneMapping` while
 *                 rendering into the half-float post target.
 * @param worldXZ  World-space (x, z) of the fragment. Not a UV: the scale lives
 *                 in `uFogParams.x` so one graph serves surfaces whose geometry
 *                 carries no fog UV at all.
 */
export const shroudTint = Fn(([color, worldXZ]: [Vec3N, Vec2N]) => {
  const vmV = shroudTintNodes.uFogMask.sample(worldXZ.mul(shroudTintNodes.uFogParams.x)).r
    .toVar('vmV');
  const vmRem = smoothstep(0.0, shroudTintNodes.uFogParams.y, vmV).oneMinus().toVar('vmRem');
  const vmFog = smoothstep(shroudTintNodes.uFogParams.y, 1.0, vmV).oneMinus().toVar('vmFog');
  const vmA = mix(shroudTintNodes.uFogTint.w.mul(vmFog), shroudTintNodes.uFogDark.w, vmRem)
    .mul(shroudTintNodes.uFogAmount).toVar('vmA');
  return mix(color, mix(shroudTintNodes.uFogTint.xyz, shroudTintNodes.uFogDark.xyz, vmRem), vmA);
}).setLayout({
  name: 'shroudTint',
  type: 'vec3',
  inputs: [{ name: 'color', type: 'vec3' }, { name: 'worldXZ', type: 'vec2' }],
});

/* ==========================================================================
 * 2. THE CARPET'S OWN NOISE
 *
 * `.setLayout()` on all three. `vnoise` calls `hash21` four times and the
 * carpet calls `vnoise` four times, so a bare `Fn` would inline the hash
 * sixteen times over — Stage C measured what that costs on the terrain shader
 * and there is no reason to pay it again here.
 * ========================================================================== */

/** `hash21` from `SHROUD_FRAG`, unchanged. */
const hash21 = Fn(([pIn]: [Vec2N]) => {
  const p = fract(pIn.mul(vec2(127.1, 311.7))).toVar('p');
  p.addAssign(p.dot(p.add(34.345)));
  return fract(p.x.mul(p.y));
}).setLayout({ name: 'shroudHash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Value noise. Cheap on purpose: this only has to break a straight edge. */
const vnoise = Fn(([p]: [Vec2N]) => {
  const i = floor(p).toVar('i');
  const f = fract(p).toVar('f');
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}).setLayout({ name: 'shroudVnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * 4x4 ordered Bayer, closed form.
 *
 * VISUAL_DNA I1 asks for ordered dithering on every gradient in the game, and an
 * ordered pattern is stable frame to frame — white noise here would crawl and
 * read as film grain, which is banned. It is also why nothing in this file draws
 * from an RNG: `docs/RENDER_FINDINGS.md` records three's own `DenoiseNode`
 * seeding itself from `Math.random()`, and the shot harness's byte-identical
 * captures would not survive a per-run seed anywhere in the frame.
 */
const bayer2 = Fn(([aIn]: [Vec2N]) => {
  const a = floor(aIn).toVar('a');
  return fract(a.x.mul(0.5).add(a.y.mul(a.y).mul(0.75)));
}).setLayout({ name: 'shroudBayer2', type: 'float', inputs: [{ name: 'aIn', type: 'vec2' }] });

const bayer4 = Fn(([a]: [Vec2N]) => bayer2(a.mul(0.5)).mul(0.25).add(bayer2(a)))
  .setLayout({ name: 'shroudBayer4', type: 'float', inputs: [{ name: 'a', type: 'vec2' }] });

/* ==========================================================================
 * 3. THE CARPET MATERIAL
 * ========================================================================== */

export interface ShroudNodeMaterialSet {
  readonly material: NodeMaterial;
  /** Live uniform nodes; mutate `.value`, never replace the node. */
  readonly uniforms: ReturnType<typeof createCarpetUniforms>;
  /** Point the carpet at the real 128x128 R8 mask. */
  setFogTexture(tex: THREE.Texture): void;
  setTime(t: number): void;
  /** Re-read an `ArtDirection.shroud` patch. Uniforms only; never allocates. */
  applyLook(look: ShroudLook): void;
  dispose(): void;
}

function createCarpetUniforms(fog: THREE.Texture, look: ShroudLook) {
  const tint = new Float32Array(3);
  const dark = new Float32Array(3);
  hexToLinearRgb(look.exploredTint, tint);
  hexToLinearRgb(look.unexploredColor, dark);
  return {
    uFog: texture(fog),
    uExploredTint: uniform(new THREE.Vector3(tint[0], tint[1], tint[2])),
    uUnexploredColor: uniform(new THREE.Vector3(dark[0], dark[1], dark[2])),
    uExploredAlpha: uniform(FOG_EXPLORED_ALPHA),
    uUnexploredAlpha: uniform(FOG_UNEXPLORED_ALPHA),
    uExploredLevel: uniform(FOG_EXPLORED_LEVEL),
    uTexel: uniform(1 / MAP_CELLS),
    uWarp: uniform(FOG_EDGE_WARP),
    uDither: uniform(FOG_DITHER),
    uNoiseScale: uniform(Math.max(1, look.noiseScale)),
    uNoiseSpeed: uniform(look.noiseSpeed),
    uTime: uniform(0),
  };
}

/** 1x1 R8 = 255, matching `FogOfWar.makeClearMask`. */
function clearMask(): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
  );
  t.name = 'ShroudNodeMaskDefault';
  t.needsUpdate = true;
  return t;
}

/**
 * The draped carpet, as a node material.
 *
 * NO CUSTOM VERTEX NODE, and that is not a shortcut. `SHROUD_VERT` computes
 * exactly `projectionMatrix * viewMatrix * modelMatrix * position` and passes
 * `uv` and the world position through — which is three's default transform plus
 * two stock varyings. `positionWorld` and `uv()` are those varyings, so the
 * vertex stage the node builder emits is the one the GLSL hand-wrote.
 */
export function createShroudNodeMaterial(look?: ShroudLook): ShroudNodeMaterialSet {
  const placeholder = clearMask();
  const uniforms = createCarpetUniforms(placeholder, look ?? DEFAULT_ART.shroud);

  const carpet = Fn(() => {
    /*
     * Domain-warp the lookup so the 4 m texel grid never reads as a polygon.
     * TWO octaves, because one is not enough: a single low-frequency warp just
     * bends the straight segments instead of dissolving them, and at the
     * default zoom one texel is ~90 screen px.
     */
    const np = positionWorld.xz.div(uniforms.uNoiseScale)
      .add(vec2(uniforms.uTime.mul(uniforms.uNoiseSpeed))).toVar('np');
    const warp = vec2(vnoise(np).sub(0.5), vnoise(np.add(17.31)).sub(0.5)).toVar('warp');
    const np2 = np.mul(4.0).sub(vec2(uniforms.uTime.mul(uniforms.uNoiseSpeed).mul(1.7)))
      .toVar('np2');
    warp.addAssign(vec2(vnoise(np2).sub(0.5), vnoise(np2.add(41.7)).sub(0.5)).mul(0.5));
    warp.mulAssign(uniforms.uWarp.mul(uniforms.uTexel).mul(2.0));

    const v = uniforms.uFog.sample(uv().add(warp)).r.toVar('v');

    /*
     * Sub-cell dither at the frontier. Screen-space on purpose: it keeps its
     * size at every zoom, which is what makes it read as a stipple rather than
     * as texture noise. `gl_FragCoord.xy` -> `screenCoordinate.xy`, the same
     * quantity on both backends.
     */
    v.addAssign(bayer4(screenCoordinate.xy).sub(0.46875).mul(uniforms.uDither));

    // Ascending edges with the inversion outside, exactly as the GLSL wrote
    // them — and now for a second reason: a descending `smoothstep` is
    // UNDEFINED in WGSL, where GLSL merely left it unspecified.
    const remembered = smoothstep(0.0, uniforms.uExploredLevel, v).oneMinus()
      .toVar('remembered');
    const fogged = smoothstep(uniforms.uExploredLevel, 1.0, v).oneMinus().toVar('fogged');

    const a = mix(uniforms.uExploredAlpha.mul(fogged), uniforms.uUnexploredAlpha, remembered)
      .toVar('a');
    Discard(a.lessThanEqual(0.003));

    const col = mix(uniforms.uExploredTint, uniforms.uUnexploredColor, remembered).toVar('col');
    return vec4(col, a);
  });

  const material = new NodeMaterial();
  material.name = 'ShroudNodeMaterial';
  material.fragmentNode = carpet() as unknown as Vec4N;
  material.transparent = true;
  // DEPTH ON. The carpet owns the GROUND PLANE only; anything standing above it
  // tints itself from the same mask via `shroudTint`. See `FogOfWar.ts` §1b for
  // the 3,600-frame measurement that settled this.
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // Scene fog on the shroud would tint the shroud toward the sky, which is both
  // wrong and, per the bible §1, a thing we do not have anyway.
  material.fog = false;
  material.toneMapped = false;

  return {
    material,
    uniforms,

    setFogTexture(tex: THREE.Texture): void { uniforms.uFog.value = tex; },
    setTime(t: number): void { uniforms.uTime.value = t; },

    applyLook(look2: ShroudLook): void {
      const rgb = scratchRgb;
      hexToLinearRgb(look2.exploredTint, rgb);
      uniforms.uExploredTint.value.set(rgb[0], rgb[1], rgb[2]);
      // The self-tint has to move with it, or a mood change re-tints the ground
      // and leaves every building and ship on the old palette. These are the
      // SHARED Vector4s, so writing them here reaches the WebGL materials too —
      // which is correct: only one of the two carpets is ever in the scene.
      shroudUniforms.uFogTint.value.set(rgb[0], rgb[1], rgb[2], FOG_EXPLORED_ALPHA);
      hexToLinearRgb(look2.unexploredColor, rgb);
      uniforms.uUnexploredColor.value.set(rgb[0], rgb[1], rgb[2]);
      shroudUniforms.uFogDark.value.set(rgb[0], rgb[1], rgb[2], FOG_UNEXPLORED_ALPHA);
      uniforms.uNoiseScale.value = Math.max(1, look2.noiseScale);
      uniforms.uNoiseSpeed.value = look2.noiseSpeed;
    },

    dispose(): void {
      material.dispose();
      placeholder.dispose();
    },
  };
}

const scratchRgb = new Float32Array(3);

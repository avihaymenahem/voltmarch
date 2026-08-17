/**
 * ============================================================================
 * VOLTMARCH — src/vfx/vfx-node-materials.ts
 * ============================================================================
 * THE FOUR VFX MATERIALS, AS TSL NODE GRAPHS. Stage E of
 * `docs/WEBGPU_MIGRATION_PLAN.md`.
 *
 * `./Particles.ts` and `./Beams.ts` are the shipping WebGL implementations and
 * stay untouched. This file draws the same effects for `WebGPURenderer` — on its
 * WebGPU backend and on its WebGL2 fallback. Each block below carries the name
 * of the GLSL it replaces.
 *
 *   `vfxRibbonNodeMaterial`   RIBBON_VERT + RIBBON_FRAG   VfxBeamOverlay / VfxRibbonDepth
 *   `vfxAdditiveNodeMaterial` SPRITE_VERT + ADDITIVE_FRAG VfxAdditive
 *   `vfxLitNodeMaterial`      SPRITE_VERT + LIT_FRAG      VfxLitSmoke
 *   `vfxDebrisNodeMaterial`   (stock standard)            VfxDebris
 *
 * ⚠️ THE FLASH BUDGET IS NOT IN HERE, AND THAT IS THE MOST IMPORTANT SENTENCE
 * ON THIS PAGE
 * --------------------------------------------------------------------------
 * v2.13.0 shipped a two-tier glare budget (`./FlashBudget.ts`) after the seventh
 * report of "flashes become huge again with 100% brightness, cant see nothing in
 * fight". The measured properties are
 *
 *     ONE flash            4.253%   <- must stay BIT-IDENTICAL
 *     5 deaths at 18 m     7.433%
 *     20 deaths at 4 m    12.290%
 *     20 deaths at 18 m   14.314%   (36.200% before the fix)
 *
 * of frame area over L=0.95, and every previous attempt at this bug broke the
 * first row by paying for the crowd out of the soloist's budget.
 *
 * **None of that arithmetic is in a shader, on either path.** `admitGlare`
 * returns a multiplier on the CPU; the emitters fold it into `EmitDesc`'s
 * intensity envelope; it reaches both of these materials as the same `aTint.x`
 * INSTANCE ATTRIBUTE, and neither shader can read the budget or change it. So a
 * port of these materials cannot move those numbers, and the only way this file
 * could is by getting `aTint.x`'s USE wrong — which is why the halo curve, the
 * two magnitude renormalisations and the final ceiling below are translated line
 * by line rather than tidied, and why `tests/vfx-node-materials.spec.ts` checks
 * each of them against the emitted source.
 *
 * WHAT MADE THIS THE EASY THIRD OF STAGE E
 * ----------------------------------------
 * Measured across all seven files of `src/vfx/`: **no `onBeforeCompile`, no
 * `customProgramCacheKey`, no `dithering: true`, and no shroud tint anywhere.**
 * VFX is deliberately un-shrouded — an explosion inside the fog is a thing you
 * are meant to see — and the three custom materials are raw `ShaderMaterial`s
 * with hand-written GLSL, so there is no chunk structure to mirror and no stale
 * cache key to inherit. `VfxDebris` is a stock `MeshStandardMaterial` and its
 * port is a class swap.
 *
 * `.setLayout()` APPEARS EXACTLY ONCE HERE, AND ON THE ONE PURE HELPER
 * -------------------------------------------------------------------
 * A layout emits a real WGSL function, and a WGSL function sees nothing but its
 * declared parameters — Stage D had four helpers refused by Chrome for reading
 * module-scope names while every offline test passed. `rotate2d` takes its angle
 * and its vector as arguments and touches nothing else, so it qualifies.
 * Everything else in this file reads an attribute, a varying or a uniform and is
 * therefore a macro on purpose.
 *
 * NOTHING IN `src/` IMPORTS THIS YET. The seam wires it up in Stage F through a
 * DYNAMIC import behind `requestedBackend()`.
 * ============================================================================
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Discard, Fn, If, attribute, cameraProjectionMatrix, clamp, cos, dot, float, floor,
  length, max, min, mix, mod, modelViewMatrix, normalize, pow, sin, smoothstep, texture,
  uniform, uv, varying, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';

import { VFX_ATLAS_COLS } from '../core/config';
import {
  RIBBON_DEFAULT_FOV_DEG, VFX_ALPHA_CUTOFF, VFX_DEBRIS, VFX_HALO_T0, VFX_HALO_T1,
  VFX_INV_PI, VFX_LIT_FX_FALLOFF_EXP, VFX_LIT_FX_GAIN, VFX_LIT_FX_MAX, VFX_LIT_HEMI_GAIN,
  VFX_LIT_RIM_EXP, VFX_ROW_STEP, litSmokeDefaults, ribbonPxScale,
} from './vfx-material-constants';

type FloatN = Node<'float'>;
type Vec2N = Node<'vec2'>;
type Vec3N = Node<'vec3'>;
type Vec4N = Node<'vec4'>;
/** What `texture()` hands back. Named because two helpers take one as a parameter. */
type TextureN = ReturnType<typeof texture>;

/* ==========================================================================
 * 1. THE ONE PURE HELPER
 * ========================================================================== */

/**
 * Rotate a 2-vector by (cos, sin), supplied rather than computed.
 *
 * `SPRITE_VERT` does this twice with the SAME angle — once for the quad corner
 * and once for `vLocal` — so the sine and cosine are taken once at the call site
 * and handed in. That is also what makes this layout legal: both inputs are
 * parameters, so the emitted WGSL function is closed.
 */
const rotate2d = Fn(([v, c, s]: [Vec2N, FloatN, FloatN]) => vec2(
  v.x.mul(c).sub(v.y.mul(s)),
  v.x.mul(s).add(v.y.mul(c)),
)).setLayout({
  name: 'vfxRotate2d',
  type: 'vec2',
  inputs: [
    { name: 'v', type: 'vec2' }, { name: 'c', type: 'float' }, { name: 's', type: 'float' },
  ],
});

/* ==========================================================================
 * 2. THE RIBBON — `RIBBON_VERT` + `RIBBON_FRAG`
 *
 * One material, two instances: `VfxBeamOverlay` (depth OFF, drawn at
 * `RENDER_ORDER.TRAILS`) and `VfxRibbonDepth` (depth ON, at `PARTICLES`). They
 * differ in exactly one flag, exactly as the `RibbonBatch` constructor does.
 * ========================================================================== */

export interface VfxRibbonNodeSet {
  readonly material: NodeMaterial;
  /**
   * Push the camera's vertical FOV so pixel widths stay honest after a zoom.
   *
   * `RibbonBatch` reaches through `material.uniforms.uPxScale` for this, and for
   * `pxToMetres`. A node material has no `uniforms` map, so the accessor is the
   * seam Stage F needs — see the note at the foot of this file.
   */
  setFov(fovDeg: number): void;
  /** The live metres-per-reference-pixel scalar, for `BeamSystem.pxToMetres`. */
  readonly pxScale: number;
  dispose(): void;
}

export function createVfxRibbonNodeMaterial(
  rampTexture: THREE.Texture, rampRows: number, name: string, depthTest: boolean,
): VfxRibbonNodeSet {
  const uRamp = texture(rampTexture);
  const uRowStep = uniform(1 / rampRows);
  const uPxScale = uniform(ribbonPxScale(RIBBON_DEFAULT_FOV_DEG));

  const aDir = attribute<'vec3'>('aDir', 'vec3');
  /** side(-1/+1), widthPx, extendPx, falloffExp */
  const aParam = attribute<'vec4'>('aParam', 'vec4');
  /** rampRow, rampT, hdrIntensity, alpha */
  const aRamp = attribute<'vec4'>('aRamp', 'vec4');

  const vSide = varying(aParam.x, 'vSide') as unknown as FloatN;
  const vFall = varying(aParam.w, 'vFall') as unknown as FloatN;
  const vRamp = varying(aRamp, 'vRamp') as unknown as Vec4N;

  /*
   * A BARE `Fn` — it reads `positionLocal` and three attributes, none of which a
   * declared WGSL function could see.
   */
  const ribbonClip = Fn(() => {
    const mv = modelViewMatrix.mul(vec4(attribute<'vec3'>('position', 'vec3'), 1.0)).toVar('ribbonMv');
    const tv = modelViewMatrix.mul(vec4(aDir, 0.0)).xyz.toVar('ribbonTv');

    /*
     * Screen-space tangent. When the stroke points almost straight at the camera
     * the projection collapses; fall back to a fixed axis so the quad degenerates
     * gracefully instead of exploding to NaN.
     *
     * THE DIVISOR IS `max( l, 1e-5 )` WHERE THE GLSL WROTE `l`. Both operands of
     * a WGSL `select` are evaluated, so `t2 / 0` would compute a NaN that the
     * select then discards — harmless in principle, and exactly the kind of
     * thing that reaches a bloom mip chain and kills a frame. Inside the branch
     * that is actually taken, `l > 1e-5`, so the clamp changes no result.
     */
    const t2 = tv.xy.toVar('ribbonT2');
    const l = length(t2).toVar('ribbonL');
    const tan2 = l.greaterThan(1e-5).select(t2.div(max(l, 1e-5)), vec2(1.0, 0.0))
      .toVar('ribbonTan2');
    const perp = vec2(tan2.y.negate(), tan2.x).toVar('ribbonPerp');

    const depth = max(mv.z.negate(), 0.1).toVar('ribbonDepth');
    // Metres per REFERENCE pixel — the whole reason a beam's width is authored
    // in pixels and stays that width at any zoom or resolution.
    const mpp = uPxScale.mul(depth).toVar('ribbonMpp');

    const offset = perp.mul(aParam.x.mul(aParam.y).mul(0.5).mul(mpp))
      .add(tan2.mul(aParam.z.mul(mpp))).toVar('ribbonOffset');

    return cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, mv.w));
  });

  const ribbonFrag = Fn(() => {
    // Cross-section profile. A near-flat exponent gives the hard filament core
    // that must clip to white; a high one gives the soft +/-20-40 px glow.
    const cs = pow(max(float(0.0), vSide.abs().oneMinus()), vFall).toVar('ribbonCs');
    const ramp = uRamp.sample(vec2(vRamp.y, vRamp.x.add(0.5).mul(uRowStep))).toVar('ribbonRamp');
    const a = ramp.a.mul(vRamp.w).mul(cs).toVar('ribbonA');
    Discard(a.lessThanEqual(VFX_ALPHA_CUTOFF));
    const col = ramp.rgb.mul(vRamp.z).toVar('ribbonCol');
    // PREMULTIPLIED additive. See the blend block below.
    return vec4(col.mul(a), a);
  });

  const material = new NodeMaterial();
  material.name = name;
  material.vertexNode = ribbonClip() as unknown as Vec4N;
  material.fragmentNode = ribbonFrag() as unknown as Vec4N;
  applyPremultipliedAdditive(material);
  material.depthTest = depthTest;
  material.side = THREE.DoubleSide;
  material.fog = false;

  return {
    material,
    setFov(fovDeg: number): void { uPxScale.value = ribbonPxScale(fovDeg); },
    get pxScale(): number { return uPxScale.value; },
    dispose(): void { material.dispose(); },
  };
}

/* ==========================================================================
 * 3. THE SPRITE VERTEX STAGE — `SPRITE_VERT`
 *
 * Shared by the additive and the lit layers, exactly as the GLSL string is.
 * Returns the clip position; the five varyings are published as a side effect,
 * which is what a vertex stage is.
 *
 * EVERY VARYING IS A `varyingProperty` ASSIGNED INSIDE THE `Fn`, AND THE FIRST
 * VERSION OF THIS FILE GOT THAT WRONG IN A WAY NO TEST CAUGHT
 * ---------------------------------------------------------------------------
 * The obvious shape is to compute into a module-scope `vec2().toVar()`, call the
 * vertex `Fn`, and then wrap the vars with `varying( v, 'vUv' )`. It typechecks,
 * it compiles on both backends, and the emitted vertex stage reads:
 *
 *     spriteUvOut = vec2( 0.0, 0.0 );
 *     vUv = spriteUvOut;              <- the varying, taken from the INITIAL value
 *     ...
 *     spriteUvOut = ( ( uv + ... ) ); <- computed twenty lines later
 *
 * `varying()` emits its assignment WHERE THE NODE IS RESOLVED, not where the var
 * is last written, so `vUv` and `vLocal` both shipped as (0, 0). That is a black
 * atlas tile and a dead radial ramp — no white fireball core, no spherical
 * shading on smoke — and it would have rendered, silently, on the WebGPU path
 * only. `varyingProperty` + `.assign()` puts the write exactly where the GLSL
 * puts it, and this module's spec now checks the emitted RHS rather than the
 * presence of the name.
 * ========================================================================== */

/** The five `SPRITE_VERT` varyings, named to match the GLSL. */
const vSpriteUv = varyingProperty('vec2', 'vUv');
const vSpriteLocal = varyingProperty('vec2', 'vLocal');
const vSpriteRamp = varyingProperty('vec4', 'vRamp');
const vSpriteTint = varyingProperty('vec3', 'vTint');
const vSpriteViewPos = varyingProperty('vec3', 'vViewPos');

interface SpriteVaryings {
  vUv: Vec2N;
  vLocal: Vec2N;
  vRamp: Vec4N;
  vTint: Vec3N;
  vViewPos: Vec3N;
  /** Clip-space position for `material.vertexNode`. */
  clip: Vec4N;
}

function spriteStage(uCols: FloatN): SpriteVaryings {
  const position = attribute<'vec3'>('position', 'vec3');
  /** world position */
  const aOffset = attribute<'vec3'>('aOffset', 'vec3');
  /** sizeX, sizeY, rotation, tile + 16*orientation */
  const aQuad = attribute<'vec4'>('aQuad', 'vec4');
  /** rampRow, tA, tB, radialMix */
  const aRamp = attribute<'vec4'>('aRamp', 'vec4');
  /** hdrIntensity, alpha, spare — `.x` is where the flash budget lands. */
  const aTint = attribute<'vec3'>('aTint', 'vec3');

  const vertex = Fn(() => {
    const packed = aQuad.w.toVar('spritePacked');
    const orient = floor(packed.mul(0.0625)).toVar('spriteOrient');   // /16
    const tile = packed.sub(orient.mul(16.0)).toVar('spriteTile');

    const c = cos(aQuad.z).toVar('spriteC');
    const s = sin(aQuad.z).toVar('spriteS');
    const r = rotate2d(position.xy.mul(aQuad.xy), c, s).toVar('spriteR');

    const mv = vec4(0.0).toVar('spriteMv');
    If(orient.lessThan(0.5), () => {
      /*
       * Camera-facing billboard. Offsetting in VIEW space AFTER the transform is
       * what keeps a sprite exactly screen-aligned at any camera yaw.
       */
      const base = modelViewMatrix.mul(vec4(aOffset, 1.0)).toVar('spriteBase');
      mv.assign(vec4(base.xy.add(r), base.z, base.w));
    }).Else(() => {
      // Ground-plane quad: shockwave rings are "flattened to ground, scaleY 0.12".
      mv.assign(modelViewMatrix.mul(vec4(aOffset.add(vec3(r.x, 0.0, r.y)), 1.0)));
    });

    vSpriteViewPos.assign(mv.xyz);

    // The atlas cell, and the rotated local coords the radial ramp sweeps over.
    // Both reuse `tile` / `c` / `s`, which is why they are computed here rather
    // than in a second pass over the same attributes.
    const col = mod(tile, uCols).toVar('spriteCol');
    const row = floor(tile.div(uCols)).toVar('spriteRow');
    vSpriteUv.assign(uv().add(vec2(col, row)).div(uCols));
    vSpriteLocal.assign(rotate2d(position.xy.mul(2.0), c, s));

    vSpriteRamp.assign(aRamp);
    vSpriteTint.assign(aTint);

    return cameraProjectionMatrix.mul(mv);
  });

  return {
    vUv: vSpriteUv as unknown as Vec2N,
    vLocal: vSpriteLocal as unknown as Vec2N,
    vRamp: vSpriteRamp as unknown as Vec4N,
    vTint: vSpriteTint as unknown as Vec3N,
    vViewPos: vSpriteViewPos as unknown as Vec3N,
    clip: vertex() as unknown as Vec4N,
  };
}

/* ==========================================================================
 * 4. `SPRITE_SAMPLE` — the shared fragment prologue
 * ========================================================================== */

interface SpriteSample {
  /** Ramp coordinate, 0..1. Drives the halo curve. */
  t: FloatN;
  /** The ramp texel at `t`. */
  ramp: Vec4N;
  /** Composed alpha: atlas shape x ramp alpha x the emitter's envelope. */
  alpha: FloatN;
}

function spriteSample(
  uAtlas: TextureN, uRamp: TextureN, uRowStep: FloatN, V: SpriteVaryings,
): SpriteSample {
  const tex = uAtlas.sample(V.vUv).toVar('spriteTex');
  Discard(tex.a.lessThanEqual(VFX_ALPHA_CUTOFF));

  const rad = clamp(length(V.vLocal), 0.0, 1.0).toVar('spriteRad');
  /*
   * radialMix 0 -> ramp driven by particle age (the CPU wrote it into tA).
   * radialMix 1 -> ramp swept tA..tB across the sprite radius, which is what
   *                gives every fireball billow a white core (scorecard #14).
   */
  const t = clamp(mix(V.vRamp.y, V.vRamp.z, rad.mul(V.vRamp.w)), 0.0, 1.0).toVar('spriteT');
  const ramp = uRamp.sample(vec2(t, V.vRamp.x.add(0.5).mul(uRowStep))).toVar('spriteRamp');
  const alpha = tex.a.mul(ramp.a).mul(V.vTint.y).toVar('spriteAlpha');
  Discard(alpha.lessThanEqual(VFX_ALPHA_CUTOFF));

  return { t, ramp, alpha };
}

/* ==========================================================================
 * 5. THE ADDITIVE LAYER — `ADDITIVE_FRAG`
 * ========================================================================== */

export interface VfxSpriteNodeSet {
  readonly material: NodeMaterial;
  dispose(): void;
}

export function createVfxAdditiveNodeMaterial(
  atlas: THREE.Texture, ramps: THREE.Texture,
): VfxSpriteNodeSet {
  const uAtlas = texture(atlas);
  const uRamp = texture(ramps);
  const uRowStep = uniform(VFX_ROW_STEP);
  const uCols = uniform(VFX_ATLAS_COLS);

  const V = spriteStage(uCols);

  const frag = Fn(() => {
    const S = spriteSample(uAtlas, uRamp, uRowStep, V);
    /*
     * `vTint.x` is an HDR gain well above 1.0. Bible §8.1: author emissives >1.0
     * in linear so the tonemapper crushes the core to pure white and the bloom
     * threshold only catches genuine effect cores.
     *
     * BUT THE GAIN CANNOT BE FLAT ACROSS A RADIAL SPRITE. Applied uniformly, a
     * gain of 3.2 pushes the fireball ramp's #FF9350 fringe to (3.2, 1.8, 1.0) —
     * every channel over 1.0 — and the tonemapper maps it to the same white as
     * the core. The whole billow goes pale cream and the fireball reads as fog:
     * the single subtlest way to fail scorecard #14 while believing the ramp is
     * correct.
     *
     * So on a RADIAL sprite the gain ramps down with t: full HDR across the
     * white core, unity just outside it, where the authored orange keeps its
     * saturation AND drops under the 1.05 bloom threshold — so the halo is fed
     * by the core alone instead of by the whole billow.
     *
     * Life-driven sprites (`vRamp.w` = 0) are untouched: the CPU already
     * interpolates their gain across the lifetime.
     *
     * THIS IS THE ONE BLOCK IN THE FILE THAT COULD MOVE THE FLASH-STACK
     * NUMBERS, because it is the only place `aTint.x` — the value the glare
     * budget attenuated — is transformed rather than merely multiplied.
     */
    const halo = smoothstep(VFX_HALO_T0, VFX_HALO_T1, S.t).oneMinus().toVar('additiveHalo');
    const graded = mix(1.0, V.vTint.x, halo).toVar('additiveGraded');
    const col = S.ramp.rgb.mul(mix(V.vTint.x, graded, V.vRamp.w)).toVar('additiveCol');
    return vec4(col.mul(S.alpha), S.alpha);   // premultiplied
  });

  const material = new NodeMaterial();
  material.name = 'VfxAdditive';
  material.vertexNode = V.clip;
  material.fragmentNode = frag() as unknown as Vec4N;
  applyPremultipliedAdditive(material);
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.fog = false;

  return { material, dispose(): void { material.dispose(); } };
}

/* ==========================================================================
 * 6. THE LIT SMOKE LAYER — `LIT_FRAG`
 * ========================================================================== */

export interface VfxLitNodeSet extends VfxSpriteNodeSet {
  /** The live uniform nodes `syncLighting` / `setDominantLight` write. */
  readonly uniforms: ReturnType<typeof createLitUniforms>;
}

function createLitUniforms() {
  const d = litSmokeDefaults();
  return {
    uSunDirView: uniform(d.uSunDirView),
    uSunColor: uniform(d.uSunColor),
    uUpView: uniform(d.uUpView),
    uHemiSky: uniform(d.uHemiSky),
    uHemiGround: uniform(d.uHemiGround),
    uShadeDark: uniform(d.uShadeDark),
    uShadeLit: uniform(d.uShadeLit),
    uRimLit: uniform(d.uRimLit),
    uTintGain: uniform(d.uTintGain),
    uShadeGain: uniform(d.uShadeGain),
    uRimGain: uniform(d.uRimGain),
    uFxPosView: uniform(d.uFxPosView),
    uFxColor: uniform(d.uFxColor),
    uFxRange: uniform(d.uFxRange),
  };
}

export function createVfxLitNodeMaterial(
  atlas: THREE.Texture, ramps: THREE.Texture,
): VfxLitNodeSet {
  const uAtlas = texture(atlas);
  const uRamp = texture(ramps);
  const uRowStep = uniform(VFX_ROW_STEP);
  const uCols = uniform(VFX_ATLAS_COLS);
  const U = createLitUniforms();

  const V = spriteStage(uCols);

  const frag = Fn(() => {
    const S = spriteSample(uAtlas, uRamp, uRowStep, V);

    // Fake a spherical normal across the billboard. A flat card cannot shade,
    // and bible §8.7 is unambiguous that flat grey smoke looks wrong.
    const r2 = min(dot(V.vLocal, V.vLocal), 1.0).toVar('litR2');
    const n = normalize(vec3(V.vLocal.x, V.vLocal.y, max(r2.oneMinus(), 0.05).sqrt()))
      .toVar('litN');

    const ndl = dot(n, U.uSunDirView).toVar('litNdl');
    const wLit = ndl.mul(0.5).add(0.5).toVar('litW');

    const shade = mix(U.uShadeDark, U.uShadeLit, wLit).toVar('litShade');   // bible §8.7 verbatim
    const up = dot(n, U.uUpView).mul(0.5).add(0.5).toVar('litUp');
    const hemi = mix(U.uHemiGround, U.uHemiSky, up).toVar('litHemi');

    /*
     * The puff's own diffuse albedo: its ramp colour, the bible's shading pair,
     * the sky/ground bounce and the sun rim. Pulled out as one named value for
     * two reasons — the dynamic light below has to MULTIPLY by it (light
     * reflects off smoke, it does not add to it), and it is the thing the
     * ceiling below has to bound.
     */
    const albedo = S.ramp.rgb.mul(U.uTintGain)
      .add(shade.mul(U.uShadeGain))
      .add(hemi.mul(VFX_LIT_HEMI_GAIN))
      .add(U.uRimLit.mul(U.uSunColor).mul(pow(max(ndl, 0.0), VFX_LIT_RIM_EXP)).mul(U.uRimGain))
      .toVar('litAlbedo');

    /*
     * THE CEILING — the other half of why 05-combat and 08-naval-water rendered
     * as a white sheet.
     *
     * Those four terms are a SUM and nothing bounded it. At the shipped
     * constants a fully sun-facing puff of the #1A1A1A wreck-smoke ramp came out
     * at 0.45 scene-linear and a #C6C6C0 dust puff at 0.58 — against a bible
     * that names #8A857E (0.254 linear) as the brightest a LIT smoke puff gets.
     * So the DARKEST smoke in the game rendered 1.8x brighter than the palest
     * value allowed, and a plume is 14-22 puffs up to 28 m across.
     *
     * Renormalising by MAGNITUDE rather than clamping each channel is what keeps
     * a warm dust puff warm instead of pinning R, G and B to the same ceiling
     * and turning it white — the exact failure being fixed.
     */
    const lim = max(
      max(U.uShadeLit.r, max(U.uShadeLit.g, U.uShadeLit.b)),
      max(S.ramp.r, max(S.ramp.g, S.ramp.b)),
    ).toVar('litLim');
    const peakAlbedo = max(albedo.r, max(albedo.g, albedo.b)).toVar('litPeak');
    If(peakAlbedo.greaterThan(lim), () => {
      albedo.mulAssign(lim.div(peakAlbedo));
    });

    const col = vec3(albedo).toVar('litCol');

    /*
     * ONE dynamic VFX light on the plume — bible §8.7's fireball-lit #926339
     * underside.
     *
     * THIS TERM USED TO WHITE OUT THE FRAME. `uFxColor` carries the light pool's
     * RAW CANDELA and an explosion light is peak 28 x the x5 exposure scale =
     * 140; the old line added that straight into `col` behind a bare 1/d^1.35
     * falloff, so a puff five metres from a blast received +12.9 LINEAR — forty-
     * five times what the bible allows. Hiding this ONE mesh moved frame-mean
     * luminance by -37 L on a 112 L frame.
     *
     * Three things make it behave, and all three are translated verbatim:
     *   1. it is IRRADIANCE, so it is multiplied by the puff's own albedo and by
     *      1/PI, not added as radiance;
     *   2. the range window is SQUARED, matching three's own point-light cutoff,
     *      so the wash reaches zero AT `uFxRange` instead of stepping off a cliff;
     *   3. the result is clamped by MAGNITUDE, not per channel — clamping each
     *      channel independently would pin red, green and blue to the same
     *      ceiling and turn a hot orange wash white again.
     *
     * `fxW` and `fxPeak` are named apart from `wLit` and `peakAlbedo` above. The
     * GLSL shadows both inside this block, which is legal and which a flattening
     * translation silently breaks.
     */
    const toL = U.uFxPosView.sub(V.vViewPos).toVar('litToL');
    const d = max(length(toL), 0.5).toVar('litD');
    If(d.lessThan(U.uFxRange), () => {
      const fxW = d.div(U.uFxRange).oneMinus().toVar('litFxW');
      const atten = fxW.mul(fxW).div(pow(d, VFX_LIT_FX_FALLOFF_EXP)).toVar('litAtten');
      const fx = U.uFxColor.mul(albedo)
        .mul(atten.mul(VFX_INV_PI).mul(VFX_LIT_FX_GAIN))
        .mul(max(dot(n, toL.div(d)), 0.0)).toVar('litFx');
      const fxPeak = max(fx.r, max(fx.g, fx.b)).toVar('litFxPeak');
      If(fxPeak.greaterThan(VFX_LIT_FX_MAX), () => {
        fx.mulAssign(float(VFX_LIT_FX_MAX).div(fxPeak));
      });
      col.addAssign(fx);
      // A puff standing in a fireball's light may reach the bible's own
      // "fireball-lit underside" value and no further.
      lim.assign(max(lim, VFX_LIT_FX_MAX));
    });

    col.mulAssign(V.vTint.x);

    /*
     * THE FINAL CEILING, and it has to be here rather than on albedo alone.
     *
     * `vTint.x` is the emitter's own intensity envelope and a wreck column ships
     * it well above 1. Clamping the albedo and THEN multiplying by that envelope
     * let a smokeDark puff — the darkest smoke in the game — leave the shader at
     * 0.44 scene-linear, 1.7x the #8A857E the bible names as the brightest a lit
     * puff gets. Measured on ?shot=naval: 438 of 505 live lit sprites were row 2
     * and the frame sampled (177,164,144) sRGB across a third of its area — a
     * pale sheet made entirely of black smoke.
     */
    const outPeak = max(col.r, max(col.g, col.b)).toVar('litOutPeak');
    If(outPeak.greaterThan(lim), () => {
      col.mulAssign(lim.div(outPeak));
    });

    return vec4(col.mul(S.alpha), S.alpha);   // premultiplied
  });

  const material = new NodeMaterial();
  material.name = 'VfxLitSmoke';
  material.vertexNode = V.clip;
  material.fragmentNode = frag() as unknown as Vec4N;
  applyPremultipliedOver(material);
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.fog = false;

  return { material, uniforms: U, dispose(): void { material.dispose(); } };
}

/* ==========================================================================
 * 7. THE DEBRIS — a class swap, and the only opaque VFX material
 * ========================================================================== */

/**
 * The only VFX material that casts a shadow, and the only one three lights.
 *
 * It displaces NOTHING — the chips are `instanceMatrix` on a stock standard
 * material — so Stage D's finding that the node shadow path harvests
 * `castShadowPositionNode ?? positionNode` and never runs `setupPosition` does
 * not bite here. That was checked rather than assumed.
 */
export function createVfxDebrisNodeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'VfxDebris';
  material.color = new THREE.Color(...VFX_DEBRIS.color);
  material.roughness = VFX_DEBRIS.roughness;
  material.metalness = VFX_DEBRIS.metalness;
  material.flatShading = VFX_DEBRIS.flatShading;
  return material;
}

/* ==========================================================================
 * 8. THE BLEND MODES
 *
 * Both are CUSTOM and neither may be replaced by a three preset. The fragment
 * shaders above already multiplied by alpha, so SRC must be ONE:
 * `AdditiveBlending` uses SRC_ALPHA and would SQUARE the alpha, dimming every
 * core exactly where it has to clip to white.
 * ========================================================================== */

function applyPremultipliedAdditive(material: THREE.Material): void {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquation = THREE.AddEquation;
}

function applyPremultipliedOver(material: THREE.Material): void {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquation = THREE.AddEquation;
}

/* ==========================================================================
 * 9. WHAT STAGE F STILL HAS TO DO, IN TWO LINES
 * ========================================================================== */

export const VFX_NODE_CUTOVER_NOTES: readonly string[] = [
  /*
   * 1. `SpriteLayer`'s constructor takes `THREE.ShaderMaterial`. It uses the
   *    material for exactly one thing — handing it to a `THREE.Mesh` — so
   *    widening it to `THREE.Material` is a one-word change and is done.
   *    `DebrisLayer` already takes `THREE.Material`.
   */
  'SpriteLayer accepts THREE.Material, so a node material can be passed straight in',
  /*
   * 2. `RibbonBatch` REACHES THROUGH `material.uniforms.uPxScale` in two places
   *    — `setFov` and `BeamSystem.pxToMetres` — and a node material has no
   *    `uniforms` map. `VfxRibbonNodeSet` publishes `setFov` and `pxScale` for
   *    exactly those two callers; the batch needs a small accessor rather than a
   *    direct reach before it can hold either kind. That is a Stage F change to
   *    `Beams.ts`, deliberately not made here.
   */
  'RibbonBatch reads material.uniforms.uPxScale directly; Stage F needs an accessor',
];

/**
 * ============================================================================
 * VOLTMARCH — src/vfx/Particles.ts
 * ============================================================================
 * THE PARTICLE ENGINE: one procedural sprite atlas, one colour-ramp LUT, three
 * instanced draw calls for the entire battlefield.
 *
 * WHY IT IS BUILT THIS WAY
 * ------------------------
 * Bible §8.10 budgets ~2500 live particles at a 20-unit battle and demands
 * "one InstancedMesh per blend-mode group, one shared canvas-generated 4×4
 * sprite atlas". That is exactly what is here:
 *
 *   ADDITIVE  — fire, flashes, sparks, embers, shockwaves, muzzle stars.
 *   LIT       — smoke, dust, vapour. Normal blend, and genuinely shaded by the
 *               sun and sky, because bible §8.7 is explicit: "Smoke MUST
 *               receive scene light. Flat grey smoke looks wrong."
 *   DEBRIS    — opaque tumbling mesh chunks (§8.2 says mesh, not sprite).
 *
 * Three draw calls, three geometries, three materials, zero allocation after
 * boot. Every pool is a flat typed array with a LIFO free list; an overflowing
 * emission is DROPPED and counted, never grown.
 *
 * THE TWO TEXTURES
 * ----------------
 * Both are generated into plain `Uint8Array`s and uploaded as `DataTexture`s —
 * **no `<canvas>` anywhere**. That matters for three reasons: it is
 * deterministic (a canvas' antialiasing differs between browsers), it works in
 * the headless test runner, and it sidesteps the wrap-around bug the unit-art
 * module found in `core/assets.ts`'s draw primitives.
 *
 *   ATLAS  512², 4×4 tiles of 128². RGB is flat white; ALPHA carries the shape.
 *          Colour comes from the ramp, so one tile serves fire, smoke and foam.
 *   RAMP   128×16, one bible ramp per row, stored sRGB so the GPU's
 *          SRGB8_ALPHA8 sampler decodes to linear for free.
 *
 * THE RAMP TRICK THAT MAKES FIREBALLS WHITE
 * -----------------------------------------
 * Scorecard #14: "the brightest 40% of any fireball is L>245, channel spread
 * <30". A ramp driven by particle AGE cannot do that — the whole billow would
 * be white and then the whole billow would be orange. So a particle can ask for
 * a RADIAL ramp instead (`radial = 1`): `t` sweeps `tA→tB` across the sprite's
 * radius, and because the fireball ramp holds `#FFFAFF` out to 0.52 the billow
 * gets a pure-white core occupying half its radius with saturated orange
 * fringes — the RA3 signature, per billow, for free.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  VFX_ATLAS_COLS,
  VFX_ATLAS_SIZE,
  VFX_MAX_ADDITIVE,
  VFX_MAX_DEBRIS,
  VFX_MAX_LIT,
  VFX_RAMPS,
  VFX_RAMP_WIDTH,
  VFX_SMOKE,
} from '../core/config';
import { clamp01, hexToLinearRgb, hexToRgb, value2 } from '../core/math';
import { RENDER_ORDER } from '../render/scene';
/*
 * The tuned numbers moved to `./vfx-material-constants.ts` so the TSL twins in
 * `./vfx-node-materials.ts` read the same ones. They are still interpolated into
 * the GLSL below exactly as before; only the declaration site changed. A second
 * implementation that re-typed any of them would be a brightness change on one
 * renderer only, which is the shape of a bug reported seven times here.
 */
import {
  VFX_ALPHA_CUTOFF, VFX_DEBRIS, VFX_HALO_T0, VFX_HALO_T1, VFX_INV_PI,
  VFX_LIT_FX_FALLOFF_EXP, VFX_LIT_FX_GAIN, VFX_LIT_FX_MAX, VFX_LIT_HEMI_GAIN,
  VFX_LIT_RIM_EXP, VFX_ROW_STEP, litSmokeDefaults,
} from './vfx-material-constants';

/* ==========================================================================
 * 1. THE SPRITE ATLAS
 *
 * Every tile is authored as pure coverage in the alpha channel. RGB stays at
 * 255 so a tile never fights the ramp for the hue — a smoke lobe and a fire
 * billow are the same pixels with different rows of the LUT.
 * ========================================================================== */

/**
 * Fractional-Brownian value noise, remapped to 0..1. `value2` returns −1..1,
 * so every caller here would otherwise be reading half its range as clamped
 * black — the reason to funnel all of it through one helper.
 */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += value2(x * freq, y * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return (sum / norm) * 0.5 + 0.5;
}

/**
 * Rasterise one tile. `write(u, v)` is called for every texel with normalised
 * tile coordinates and must return coverage 0..1. Coordinates are centred:
 * `x`,`y` run −1..1 with the origin at the tile centre.
 */
type TileFn = (x: number, y: number, u: number, v: number) => number;

function paintTile(data: Uint8Array, size: number, cols: number, tile: number, fn: TileFn): void {
  const px = size / cols;
  const ox = (tile % cols) * px;
  const oy = Math.floor(tile / cols) * px;
  for (let j = 0; j < px; j++) {
    const v = (j + 0.5) / px;
    const y = v * 2 - 1;
    for (let i = 0; i < px; i++) {
      const u = (i + 0.5) / px;
      const x = u * 2 - 1;
      let a = fn(x, y, u, v);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      const o = ((oy + j) * size + (ox + i)) * 4;
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255;
      data[o + 3] = (a * 255) | 0;
    }
  }
}

/** A soft round puff whose silhouette is broken up by noise into lobes. */
function billowAt(x: number, y: number, seed: number, lobes: number, wobble: number): number {
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  // Perturb the radius so the outline reads as discrete billows, not a disc.
  const n = fbm(Math.cos(theta) * lobes + 4.1, Math.sin(theta) * lobes + 7.3, seed, 3);
  const edge = 0.86 + (n - 0.5) * wobble;
  const body = 1 - clamp01(r / Math.max(0.05, edge));
  if (body <= 0) return 0;
  // Interior density: a second noise field so the puff has visible mass.
  const d = 0.62 + 0.38 * fbm(x * 2.4 + 11.7, y * 2.4 - 3.9, seed + 977, 4);
  // A dense central plateau on top of the noise. Without it the noise can hold
  // the middle of a billow at ~0.8 alpha, and a fireball whose white core is
  // translucent shows the orange billow behind it — exactly the failure
  // scorecard #14 measures. The core must be SOLID; the edge does the breakup.
  const core = Math.exp(-(r * r) / 0.18);
  return Math.min(1, Math.pow(body, 0.85) * d + core * 0.55);
}

/** Build the 512² RGBA atlas. Pure typed arrays; no DOM, no GL. */
export function buildSpriteAtlas(size = VFX_ATLAS_SIZE, cols = VFX_ATLAS_COLS): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  // 0 SOFT — the workhorse radial falloff.
  paintTile(data, size, cols, 0, (x, y) => {
    const r = Math.hypot(x, y);
    return Math.pow(Math.max(0, 1 - r), 2.2);
  });

  // 1 BILLOW — fireball / smoke puff with a lobed silhouette.
  paintTile(data, size, cols, 1, (x, y) => billowAt(x, y, 0x1f01, 3.1, 0.30));

  // 2 STREAK — tracer lozenge: rounded bright head at v=0, tail to a point.
  paintTile(data, size, cols, 2, (x, y, _u, v) => {
    const w = 0.34 * Math.pow(1 - v, 1.5);       // taper along the length
    if (w <= 0.001) return 0;
    const across = 1 - clamp01(Math.abs(x) / w);
    const head = Math.exp(-(v * v) / 0.010);      // the bright rounded head
    const body = Math.pow(across, 1.4) * (1 - v * 0.15);
    const cap = Math.max(0, 1 - Math.hypot(x / 0.30, (y + 0.86) / 0.30));
    return Math.min(1, body * (0.55 + 0.75 * head) + cap * 0.9);
  });

  // 3 RING — thin annulus for shockwaves and pulses.
  paintTile(data, size, cols, 3, (x, y) => {
    const r = Math.hypot(x, y);
    const d = (r - 0.80) / 0.085;
    return Math.exp(-d * d);
  });

  // 4 STAR — the 4-point anamorphic muzzle flash. Bible §8.5: white/cream,
  // elongated, LARGE. The LONG spike runs along Y so that `alignVel` lays it
  // down the barrel (see the atlas convention note in SpriteLayer.step).
  paintTile(data, size, cols, 4, (x, y) => {
    const long = Math.pow(Math.max(0, 1 - Math.abs(y)), 1.7) * Math.exp(-(x * x) / 0.0075);
    const cross = Math.pow(Math.max(0, 1 - Math.abs(x) * 1.55), 1.7) * Math.exp(-(y * y) / 0.0045);
    const core = Math.exp(-(x * x + y * y) / 0.022);
    return Math.min(1, long + cross * 0.85 + core * 1.25);
  });

  // 5 FILIGREE — foam / spray filaments. Ridged noise, never round blobs.
  paintTile(data, size, cols, 5, (x, y) => {
    const r = Math.hypot(x, y);
    const n = fbm(x * 3.2, y * 3.2, 0x5a1a, 4);
    const ridge = Math.pow(1 - Math.abs(n * 2 - 1), 6.5);
    return ridge * Math.pow(Math.max(0, 1 - r), 1.6);
  });

  // 6 CORE — hard-edged white disc. This is what CLIPS and feeds the bloom.
  paintTile(data, size, cols, 6, (x, y) => {
    const r = Math.hypot(x, y);
    const disc = r < 0.50 ? 1 : Math.max(0, 1 - (r - 0.50) / 0.06);
    const rim = Math.exp(-((r - 0.52) * (r - 0.52)) / 0.02) * 0.35;
    return Math.min(1, disc + rim);
  });

  // 7 CHUNK — angular debris silhouette (also used for crushed rubble).
  paintTile(data, size, cols, 7, (x, y) => {
    const r = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    const edge = 0.62
      + 0.13 * Math.cos(th * 3 + 0.7)
      + 0.09 * Math.cos(th * 5 - 1.9)
      + 0.06 * Math.cos(th * 7 + 2.4);
    return r < edge ? 1 : Math.max(0, 1 - (r - edge) / 0.05);
  });

  // 8 SPARK — hair-thin streak with a hot head. Impact spark bursts.
  paintTile(data, size, cols, 8, (x, y, _u, v) => {
    const w = 0.085 * Math.pow(1 - v, 1.1);
    if (w <= 0.001) return 0;
    const across = 1 - clamp01(Math.abs(x) / w);
    const head = Math.exp(-(v * v) / 0.006);
    return Math.min(1, Math.pow(across, 0.9) * (0.5 + head));
  });

  // 9 LOBE — an off-centre puff, so a smoke column is not 12 copies of one
  //          symmetrical blob. Scorecard: 8–14 VISIBLE discrete lobes.
  paintTile(data, size, cols, 9, (x, y) => billowAt(x + 0.13, y - 0.10, 0x9b3c, 2.4, 0.38));

  // 10 BEAD — the trail bead. Harder edge than SOFT so a scanline along a
  //           rocket trail oscillates (scorecard #31) instead of smearing.
  paintTile(data, size, cols, 10, (x, y) => {
    const r = Math.hypot(x, y) * (0.94 + 0.10 * fbm(x * 3, y * 3, 0x0b3a, 2));
    return Math.pow(Math.max(0, 1 - r / 0.88), 0.85);
  });

  // 11 SHOCK — a shockwave ring: bright hard leading edge, soft inward wash.
  paintTile(data, size, cols, 11, (x, y) => {
    const r = Math.hypot(x, y);
    const lead = Math.exp(-((r - 0.88) * (r - 0.88)) / 0.0022);
    const wash = r < 0.88 ? Math.pow(clamp01((r - 0.30) / 0.58), 2.6) * 0.30 : 0;
    return Math.min(1, lead + wash);
  });

  // 12 EMBER DOT — a hot pinprick with a faint 4-way flare.
  paintTile(data, size, cols, 12, (x, y) => {
    const core = Math.exp(-(x * x + y * y) / 0.012);
    const cross = Math.exp(-(y * y) / 0.0015) * Math.max(0, 1 - Math.abs(x)) * 0.30
                + Math.exp(-(x * x) / 0.0015) * Math.max(0, 1 - Math.abs(y)) * 0.30;
    return Math.min(1, core + cross);
  });

  // 13 KITE — the medium muzzle flash. A teardrop with its POINT at v=0 (the
  //           head, per the atlas convention) fanning back to a rounded base,
  //           so `alignVel` throws the point down the barrel.
  paintTile(data, size, cols, 13, (x, y, _u, v) => {
    const t = clamp01(v);
    const w = 0.50 * Math.pow(t, 0.5) * (1 - 0.30 * t);
    if (w <= 0.001) return 0;
    const across = 1 - clamp01(Math.abs(x) / w);
    // Round the base off instead of chopping it square at v=1.
    const back = clamp01((1 - t) / 0.14);
    return Math.pow(across, 1.15) * (0.70 + 0.55 * Math.exp(-((t - 0.30) * (t - 0.30)) / 0.03))
         * (t > 0.86 ? back : 1);
  });

  // 14 FLARE — wide horizontal streak + narrow vertical. Beam terminators.
  paintTile(data, size, cols, 14, (x, y) => {
    const h = Math.pow(Math.max(0, 1 - Math.abs(x)), 2.0) * Math.exp(-(y * y) / 0.004);
    const v2 = Math.pow(Math.max(0, 1 - Math.abs(y) * 2.2), 2.0) * Math.exp(-(x * x) / 0.0022);
    const core = Math.exp(-(x * x + y * y) / 0.010);
    return Math.min(1, h + v2 + core);
  });

  // 15 PUFF ALT — a second billow seed, for per-instance variety.
  paintTile(data, size, cols, 15, (x, y) => billowAt(x, y, 0x77e2, 3.8, 0.26));

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'VfxSpriteAtlas';
  tex.colorSpace = THREE.NoColorSpace;    // shape data, not colour
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 2. THE COLOUR RAMP LUT
 *
 * One row per bible ramp. Stored in sRGB with `colorSpace = SRGBColorSpace`,
 * so on WebGL2 three allocates SRGB8_ALPHA8 and the sampler decodes to linear
 * in hardware — no pow() in the fragment shader and no banding in the darks.
 * ========================================================================== */

export function buildRampTexture(width = VFX_RAMP_WIDTH): THREE.DataTexture {
  const rows = VFX_RAMPS.length;
  const data = new Uint8Array(width * rows * 4);
  const rgbA: number[] = [0, 0, 0];
  const rgbB: number[] = [0, 0, 0];

  for (let row = 0; row < rows; row++) {
    const stops = VFX_RAMPS[row].stops;
    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      // Find the bracketing stops. Ramps are short (≤9 stops); a scan is
      // cheaper than any structure and this runs once at boot.
      let a = 0;
      while (a < stops.length - 2 && stops[a + 1][0] < t) a++;
      const b = Math.min(a + 1, stops.length - 1);
      const t0 = stops[a][0];
      const t1 = stops[b][0];
      const f = t1 > t0 ? clamp01((t - t0) / (t1 - t0)) : 0;
      hexToRgb(stops[a][1], rgbA);
      hexToRgb(stops[b][1], rgbB);
      const o = (row * width + i) * 4;
      data[o] = Math.round((rgbA[0] + (rgbB[0] - rgbA[0]) * f) * 255);
      data[o + 1] = Math.round((rgbA[1] + (rgbB[1] - rgbA[1]) * f) * 255);
      data[o + 2] = Math.round((rgbA[2] + (rgbB[2] - rgbA[2]) * f) * 255);
      data[o + 3] = Math.round((stops[a][2] + (stops[b][2] - stops[a][2]) * f) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'VfxRampLUT';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;   // no mips: a 16-row LUT must not blend rows
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 3. SHADERS
 * ========================================================================== */

const SPRITE_VERT = /* glsl */ `
precision highp float;

attribute vec3 aOffset;   // world position
attribute vec4 aQuad;     // sizeX, sizeY, rotation, tile + 16*orientation
attribute vec4 aRamp;     // rampRow, tA, tB, radialMix
attribute vec3 aTint;     // hdrIntensity, alpha, spare

uniform float uCols;

varying vec2 vUv;
varying vec2 vLocal;      // rotated quad coords in VIEW space, -1..1
varying vec4 vRamp;
varying vec3 vTint;
varying vec3 vViewPos;

void main() {
  float packed = aQuad.w;
  float orient = floor(packed * 0.0625);          // /16
  float tile   = packed - orient * 16.0;

  float c = cos(aQuad.z);
  float s = sin(aQuad.z);
  vec2 p = position.xy * aQuad.xy;
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

  vec4 mv;
  if (orient < 0.5) {
    // Camera-facing billboard. Offsetting in VIEW space after the transform is
    // what keeps a sprite exactly screen-aligned at any camera yaw.
    mv = modelViewMatrix * vec4(aOffset, 1.0);
    mv.xy += r;
  } else {
    // Ground-plane quad: shockwave rings are "flattened to ground, scaleY 0.12".
    mv = modelViewMatrix * vec4(aOffset + vec3(r.x, 0.0, r.y), 1.0);
  }

  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;

  float col = mod(tile, uCols);
  float row = floor(tile / uCols);
  vUv = (uv + vec2(col, row)) / uCols;

  vec2 lc = position.xy * 2.0;
  vLocal = vec2(lc.x * c - lc.y * s, lc.x * s + lc.y * c);
  vRamp = aRamp;
  vTint = aTint;
}
`;

/** Shared prologue: atlas lookup, ramp lookup, alpha resolve. */
const SPRITE_SAMPLE = /* glsl */ `
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a <= ${VFX_ALPHA_CUTOFF.toFixed(3)}) discard;
  float rad = clamp(length(vLocal), 0.0, 1.0);
  // radialMix 0 -> ramp driven by particle age (CPU wrote it into tA).
  // radialMix 1 -> ramp swept tA..tB across the sprite radius, which is what
  //                gives every fireball billow a white core (scorecard #14).
  float t = clamp(mix(vRamp.y, vRamp.z, rad * vRamp.w), 0.0, 1.0);
  vec4 ramp = texture2D(uRamp, vec2(t, (vRamp.x + 0.5) * uRowStep));
  float alpha = tex.a * ramp.a * vTint.y;
  if (alpha <= ${VFX_ALPHA_CUTOFF.toFixed(3)}) discard;
`;

/**
 * Where the HDR overshoot of a RADIAL sprite ends — scorecard #24's lever.
 *
 * `HALO_T0` is the ramp coordinate at which the gain starts collapsing towards
 * 1.0 and `HALO_T1` is where it gets there. It is deliberately pinned to the
 * fireball ramp's own white-core stop (0.52), so the two cannot drift apart:
 * inside the core the sprite keeps every bit of its authored gain (scorecard
 * #14 wants the brightest 40% at L>245), and outside it the sprite falls under
 * the bloom threshold within a fifth of its radius.
 *
 * WHY IT CHANGED. The previous curve was `pow(1 - t, 0.6)`, which is far too
 * lazy: at t=0.87 it still returned a gain of 1.95, and the fireball ramp's
 * `#FF9350` there is 1.0 linear in red — so red came out at 1.95, comfortably
 * over the 1.05 bloom threshold. Worked through every stop, the ENTIRE billow
 * out to t≈0.96 was above threshold, which means each of the 8-14 billows fed
 * the bloom mip chain as a solid 18-metre disc. That is the user's report that
 * "the glow on a tank explosion is too big", and it was a shader curve, not a
 * bloom setting: the pass was being handed a disc the size of the fireball and
 * asked to halo it.
 *
 * With the smoothstep, the above-threshold region ends around t=0.68 — about
 * 66% of the visible billow radius instead of 95%, a bit under half the area,
 * at a much lower average overshoot. The white core is untouched; only its
 * skirt is.
 */
// Declared in `./vfx-material-constants.ts`; the reasoning above is why.
const HALO_T0 = VFX_HALO_T0;
const HALO_T1 = VFX_HALO_T1;

const ADDITIVE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform sampler2D uRamp;
uniform float uRowStep;

varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vRamp;
varying vec3 vTint;
varying vec3 vViewPos;

void main() {
${SPRITE_SAMPLE}
  // vTint.x is an HDR gain well above 1.0. Bible §8.1: author emissives >1.0
  // in linear so the tonemapper crushes the core to pure white and the bloom
  // threshold (1.25 linear) only catches genuine effect cores.
  //
  // BUT THE GAIN CANNOT BE FLAT ACROSS A RADIAL SPRITE. Applied uniformly, a
  // gain of 3.2 pushes the fireball ramp's #FF9350 fringe to (3.2, 1.8, 1.0)
  // -- every channel over 1.0 -- and the tonemapper maps it to the same white as
  // the core. The whole billow goes pale cream and the fireball reads as fog:
  // measured in-engine, and it is the single subtlest way to fail scorecard
  // #14 while believing the ramp is correct.
  //
  // So on a RADIAL sprite the gain ramps down with t: full HDR across the white
  // core, unity just outside it, where the authored orange keeps its saturation
  // AND — the part that matters for scorecard #24 — drops under the 1.05 bloom
  // threshold, so the halo is fed by the core alone instead of by the whole
  // billow. See HALO_T0 / HALO_T1 above for the measurement.
  //
  // Life-driven sprites (vRamp.w = 0) are untouched: the CPU already
  // interpolates their gain across the lifetime.
  float halo = 1.0 - smoothstep(${HALO_T0.toFixed(2)}, ${HALO_T1.toFixed(2)}, t);
  float graded = mix(1.0, vTint.x, halo);
  vec3 col = ramp.rgb * mix(vTint.x, graded, vRamp.w);
  gl_FragColor = vec4(col * alpha, alpha);   // premultiplied
}
`;

/**
 * Ceiling, in scene-linear, on how much ONE VFX point light may add to a smoke
 * puff — and the gain applied before that ceiling bites.
 *
 * THIS IS THE BUG THAT BROKE `05-combat` AND `08-naval-water`. See the block
 * comment in LIT_FRAG; the numbers are quoted there.
 *
 * 0.30 is not arbitrary: bible §8.7 gives a plume's fireball-lit underside as
 * `#926339`, whose brightest channel is 0.283 in linear. A plume may take the
 * fire's colour; it may not become a light source in its own right. Anything
 * that wants to be brighter than the bible's own swatch is a bug by
 * construction, so the clamp is set at the swatch and cannot be argued with.
 */
// Declared in `./vfx-material-constants.ts`; the reasoning above is why.
const LIT_FX_GAIN = VFX_LIT_FX_GAIN;
const LIT_FX_MAX = VFX_LIT_FX_MAX;

const LIT_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform sampler2D uRamp;
uniform float uRowStep;

uniform vec3  uSunDirView;    // TOWARD the sun, view space
uniform vec3  uSunColor;      // linear, already scaled by intensity
uniform vec3  uUpView;        // world +Y in view space
uniform vec3  uHemiSky;
uniform vec3  uHemiGround;
uniform vec3  uShadeDark;     // #14120F
uniform vec3  uShadeLit;      // #8A857E
uniform vec3  uRimLit;        // #B8B2A6
uniform float uTintGain;
uniform float uShadeGain;
uniform float uRimGain;
// The single strongest VFX point light, so a plume genuinely takes the
// fireball's orange on its underside instead of staying neutral grey.
uniform vec3  uFxPosView;
uniform vec3  uFxColor;
uniform float uFxRange;

varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vRamp;
varying vec3 vTint;
varying vec3 vViewPos;

void main() {
${SPRITE_SAMPLE}

  // Fake a spherical normal across the billboard. A flat card cannot shade,
  // and bible §8.7 is unambiguous that flat grey smoke looks wrong.
  float r2 = min(dot(vLocal, vLocal), 1.0);
  vec3 n = normalize(vec3(vLocal, sqrt(max(1.0 - r2, 0.05))));

  float ndl = dot(n, uSunDirView);
  float w = ndl * 0.5 + 0.5;

  vec3 shade = mix(uShadeDark, uShadeLit, w);          // bible §8.7 verbatim
  float up = dot(n, uUpView) * 0.5 + 0.5;
  vec3 hemi = mix(uHemiGround, uHemiSky, up);

  // The puff's own diffuse albedo: its ramp colour, the bible's shading pair,
  // the sky/ground bounce and the sun rim. Pulled out as one named value for
  // two reasons — the dynamic light below has to MULTIPLY by it (light
  // reflects off smoke, it does not add to it), and it is the thing the
  // ceiling below has to bound.
  vec3 albedo = ramp.rgb * uTintGain
              + shade * uShadeGain
              + hemi * ${VFX_LIT_HEMI_GAIN.toFixed(2)}
              + uRimLit * uSunColor * pow(max(ndl, 0.0), ${VFX_LIT_RIM_EXP.toFixed(1)}) * uRimGain;

  /*
   * THE CEILING — the other half of why 05-combat and 08-naval-water rendered
   * as a white sheet.
   *
   * Those four terms are a SUM, and nothing bounded it. Worked through at the
   * shipped constants, a fully sun-facing puff of the #1A1A1A wreck-smoke ramp
   * came out at 0.45 scene-linear and a #C6C6C0 dust puff at 0.58 — against a
   * bible that names #8A857E (0.254 linear) as the brightest a LIT smoke puff
   * gets and #C6C6C0 (0.55) as the dust colour. So the darkest smoke in the
   * game rendered 1.8x brighter than the palest value the bible allows it, and
   * an explosion plume is 14-22 puffs up to 28 m across: at the 48 m camera
   * distance the combat fixture uses, two deaths cover the frame. Ablation is
   * unambiguous — hiding this ONE mesh turns the broken fixture into a correct
   * frame with nothing else touched.
   *
   * The rule is the bible's own numbers: a puff may be as bright as the
   * brighter of (its authored ramp colour, the lit-smoke swatch) and no
   * brighter. Renormalising by MAGNITUDE rather than clamping each channel is
   * what keeps a warm dust puff warm instead of pinning R, G and B to the same
   * ceiling and turning it white — the exact failure being fixed.
   */
  float lim = max(max(uShadeLit.r, max(uShadeLit.g, uShadeLit.b)),
                  max(ramp.r, max(ramp.g, ramp.b)));
  // lim is reused as the FINAL output ceiling at the bottom of main(), so it
  // is deliberately a mutable local rather than a const.
  float peak = max(albedo.r, max(albedo.g, albedo.b));
  if (peak > lim) albedo *= lim / peak;

  vec3 col = albedo;

  /*
   * ONE dynamic VFX light on the plume — bible §8.7's fireball-lit #926339
   * underside.
   *
   * THIS TERM USED TO WHITE OUT THE FRAME, and it is why the 05-combat and
   * 08-naval-water fixtures rendered as a white haze. uFxColor carries the
   * light pool's RAW CANDELA (colour times intensity), and an explosion light
   * is peak 28 x the x5 exposure scale = 140. The old line added that straight
   * into col behind a bare 1/d^1.35 falloff, so a smoke puff five metres from
   * a blast received +12.9 LINEAR — forty-five times the 0.283 the bible
   * allows a lit puff. Every sprite anywhere near a fireball or a burning
   * wreck clipped to pure white, and the bloom pass then smeared it over the
   * whole frame. Measured on ?shot=battle at 1280x720: hiding this ONE mesh
   * moved frame-mean luminance by -37 L on a 112 L frame.
   *
   * Three things make it behave:
   *   1. it is IRRADIANCE, so it is multiplied by the puff's own albedo and by
   *      1/PI, not added as radiance;
   *   2. the range window is squared, matching three's own point-light cutoff,
   *      so the wash reaches zero AT uFxRange instead of stepping off a cliff;
   *   3. the result is clamped by MAGNITUDE, not per channel. Clamping each
   *      channel independently would pin red, green and blue to the same
   *      ceiling and turn a hot orange wash white again — the exact failure
   *      this is here to prevent — so the vector is rescaled and the hue held.
   */
  vec3 toL = uFxPosView - vViewPos;
  float d = max(length(toL), 0.5);
  if (d < uFxRange) {
    float w = 1.0 - d / uFxRange;
    float atten = (w * w) / pow(d, ${VFX_LIT_FX_FALLOFF_EXP.toFixed(2)});
    vec3 fx = uFxColor * albedo
            * (atten * ${VFX_INV_PI.toFixed(10)} * ${LIT_FX_GAIN.toFixed(3)})
            * max(dot(n, toL / d), 0.0);
    float peak = max(fx.r, max(fx.g, fx.b));
    if (peak > ${LIT_FX_MAX.toFixed(3)}) fx *= ${LIT_FX_MAX.toFixed(3)} / peak;
    col += fx;
    // A puff standing in a fireball's light may reach the bible's own
    // "fireball-lit underside" value and no further.
    lim = max(lim, ${LIT_FX_MAX.toFixed(3)});
  }

  col *= vTint.x;

  /*
   * THE FINAL CEILING, and it has to be here rather than on albedo alone.
   *
   * vTint.x is the emitter's own intensity envelope (EmitDesc.i0/i1), and a
   * wreck column or a damage plume ships it well above 1. Clamping the albedo
   * and then multiplying by that envelope let a smokeDark puff — ramp #1A1A1A,
   * the DARKEST smoke in the game — leave the shader at 0.44 scene-linear,
   * which is 1.7x the #8A857E the bible names as the brightest a LIT puff
   * gets. Measured on ?shot=naval: 438 of 505 live lit sprites were row 2
   * (smokeDark) and the frame sampled (177,164,144) sRGB across a third of its
   * area — a pale sheet made entirely of black smoke.
   *
   * Renormalising by MAGNITUDE keeps a warm dust puff warm; clamping per
   * channel would pin R, G and B together and turn it white, which is the
   * failure being fixed.
   */
  float outPeak = max(col.r, max(col.g, col.b));
  if (outPeak > lim) col *= lim / outPeak;

  gl_FragColor = vec4(col * alpha, alpha);   // premultiplied
}
`;

/* ==========================================================================
 * 4. THE EMIT DESCRIPTOR
 *
 * A single reusable struct instead of a 24-argument call. `emit()` copies out
 * of it immediately, so the caller may refill and fire again in the same
 * statement. Nothing here ever allocates.
 * ========================================================================== */

export interface EmitDesc {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Milliseconds. */
  lifeMs: number;
  /** Metres, interpolated `size0 -> size1` by `pow(lifeFrac, sizeEase)`. */
  size0: number; size1: number; sizeEase: number;
  /** Anisotropy: `size * aspect` on the quad's Y axis. 1 = square. */
  aspect: number;
  /** Row of the ramp LUT. Use the `VFX_RAMP` table. */
  ramp: number;
  /** Ramp window. `radial 0` sweeps tA->tB over life; `radial 1` over radius. */
  tA: number; tB: number; radial: number;
  /** Atlas tile (`VFX_TILE`) and orientation: 0 billboard, 1 ground plane. */
  tile: number; orient: number;
  /** Radians, and radians/second. */
  rot: number; rotVel: number;
  /** HDR gain, interpolated i0 -> i1 across life. >1 clips to white. */
  i0: number; i1: number;
  /** Master alpha multiplier on top of the ramp's own alpha curve. */
  alpha: number;
  /** Per-second velocity damping and downward acceleration (m/s²). */
  drag: number; gravity: number;
  /** Hz of an intensity flicker. 0 disables. */
  flickerHz: number;
  /** Rotate the sprite to point along its velocity each frame (spark streaks). */
  alignVel: number;
  /** Stop falling at this Y. Used by dust so it does not sink into terrain. */
  floorY: number;
  /** Milliseconds of delay before the particle appears. */
  delayMs: number;
}

const EMIT_DEFAULTS: EmitDesc = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
  lifeMs: 600,
  size0: 1, size1: 1, sizeEase: 1, aspect: 1,
  ramp: 0, tA: 0, tB: 1, radial: 0,
  tile: 0, orient: 0,
  rot: 0, rotVel: 0,
  i0: 1, i1: 1, alpha: 1,
  drag: 0, gravity: 0,
  flickerHz: 0, alignVel: 0, floorY: -1e9, delayMs: 0,
};

/** The shared descriptor. Fill it, emit, refill — never construct your own. */
export const EMIT: EmitDesc = { ...EMIT_DEFAULTS };

/** Restore every field to its default and hand the descriptor back. */
export function resetEmit(): EmitDesc {
  const e = EMIT;
  const d = EMIT_DEFAULTS;
  e.x = d.x; e.y = d.y; e.z = d.z;
  e.vx = d.vx; e.vy = d.vy; e.vz = d.vz;
  e.lifeMs = d.lifeMs;
  e.size0 = d.size0; e.size1 = d.size1; e.sizeEase = d.sizeEase; e.aspect = d.aspect;
  e.ramp = d.ramp; e.tA = d.tA; e.tB = d.tB; e.radial = d.radial;
  e.tile = d.tile; e.orient = d.orient;
  e.rot = d.rot; e.rotVel = d.rotVel;
  e.i0 = d.i0; e.i1 = d.i1; e.alpha = d.alpha;
  e.drag = d.drag; e.gravity = d.gravity;
  e.flickerHz = d.flickerHz; e.alignVel = d.alignVel;
  e.floorY = d.floorY; e.delayMs = d.delayMs;
  return e;
}

/* ==========================================================================
 * 5. SPRITE LAYER — one blend mode, one draw call
 * ========================================================================== */

const FLAG_ALIGN_VEL = 1 << 0;
const FLAG_FLOOR = 1 << 1;

export class SpriteLayer {
  readonly capacity: number;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly material: THREE.Material;

  /* -- particle state (SoA) --------------------------------------------- */
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly delay: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly sizeEase: Float32Array;
  private readonly aspect: Float32Array;
  private readonly rampRow: Float32Array;
  private readonly tA: Float32Array;
  private readonly tB: Float32Array;
  private readonly radial: Float32Array;
  private readonly packedTile: Float32Array;
  private readonly rot: Float32Array;
  private readonly rotVel: Float32Array;
  private readonly i0: Float32Array;
  private readonly i1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly flicker: Float32Array;
  private readonly floorY: Float32Array;
  private readonly seed: Float32Array;
  private readonly flags: Uint8Array;

  /* -- pool bookkeeping -------------------------------------------------- */
  private readonly free: Int32Array;
  private freeCount: number;
  private readonly live: Int32Array;
  private liveCount = 0;
  private readonly livePos: Int32Array;

  /* -- instance attribute buffers ---------------------------------------- */
  private readonly aOffset: THREE.InstancedBufferAttribute;
  private readonly aQuad: THREE.InstancedBufferAttribute;
  private readonly aRamp: THREE.InstancedBufferAttribute;
  private readonly aTint: THREE.InstancedBufferAttribute;

  /** Depth keys + scratch used by the back-to-front sort of the lit layer. */
  private readonly sortKey: Float32Array;
  private readonly sorted: boolean;

  /** Emissions rejected because the pool was full. */
  dropped = 0;
  /** Wall-clock milliseconds; drives the flicker phase. Render-side only. */
  private clockMs = 0;

  /**
   * `THREE.Material`, not `THREE.ShaderMaterial` — this class uses the material
   * for exactly one thing, handing it to a `THREE.Mesh`, and the TSL twins in
   * `./vfx-node-materials.ts` are `NodeMaterial`s. Widening it is what lets
   * Stage F pass either kind without a cast. `DebrisLayer` already took the base
   * type for the same reason.
   */
  constructor(capacity: number, material: THREE.Material, name: string, sorted: boolean) {
    this.capacity = capacity;
    this.sorted = sorted;
    this.material = material;

    const f = (n = capacity) => new Float32Array(n);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.delay = f();
    this.size0 = f(); this.size1 = f(); this.sizeEase = f(); this.aspect = f();
    this.rampRow = f(); this.tA = f(); this.tB = f(); this.radial = f();
    this.packedTile = f();
    this.rot = f(); this.rotVel = f();
    this.i0 = f(); this.i1 = f(); this.alpha = f();
    this.drag = f(); this.gravity = f(); this.flicker = f(); this.floorY = f();
    this.seed = f();
    this.flags = new Uint8Array(capacity);
    this.sortKey = f();

    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeCount = capacity;
    this.live = new Int32Array(capacity);
    this.livePos = new Int32Array(capacity).fill(-1);

    // A unit quad centred on the origin; the vertex shader does the rest.
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    quad.dispose();

    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aQuad = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aRamp = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.aOffset, this.aQuad, this.aRamp, this.aTint]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOffset', this.aOffset);
    geo.setAttribute('aQuad', this.aQuad);
    geo.setAttribute('aRamp', this.aRamp);
    geo.setAttribute('aTint', this.aTint);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = name;
    // Particles are everywhere and their real bounds change every frame;
    // culling a single whole-map batch would only ever cull it wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
  }

  get count(): number { return this.liveCount; }

  /**
   * Fill fraction, 0..1. Low-value emitters (tread dust, damage wisps) check
   * this and stand down before the pool is full, so an explosion's plume can
   * still find slots in the middle of a big fight.
   */
  get pressure(): number { return this.liveCount / this.capacity; }

  /** Emit one particle from the shared descriptor. Returns false when full. */
  emit(d: EmitDesc): boolean {
    if (this.freeCount === 0) { this.dropped++; return false; }
    const i = this.free[--this.freeCount];

    this.px[i] = d.x; this.py[i] = d.y; this.pz[i] = d.z;
    this.vx[i] = d.vx; this.vy[i] = d.vy; this.vz[i] = d.vz;
    this.age[i] = 0;
    this.life[i] = d.lifeMs > 1 ? d.lifeMs : 1;
    this.delay[i] = d.delayMs;
    this.size0[i] = d.size0; this.size1[i] = d.size1;
    this.sizeEase[i] = d.sizeEase; this.aspect[i] = d.aspect;
    this.rampRow[i] = d.ramp; this.tA[i] = d.tA; this.tB[i] = d.tB; this.radial[i] = d.radial;
    this.packedTile[i] = d.tile + 16 * d.orient;
    this.rot[i] = d.rot; this.rotVel[i] = d.rotVel;
    this.i0[i] = d.i0; this.i1[i] = d.i1; this.alpha[i] = d.alpha;
    this.drag[i] = d.drag; this.gravity[i] = d.gravity;
    this.flicker[i] = d.flickerHz; this.floorY[i] = d.floorY;
    this.seed[i] = (i * 0.61803398875) % 1;
    this.flags[i] = (d.alignVel !== 0 ? FLAG_ALIGN_VEL : 0)
                  | (d.floorY > -1e8 ? FLAG_FLOOR : 0);

    this.livePos[i] = this.liveCount;
    this.live[this.liveCount++] = i;
    return true;
  }

  private kill(slot: number): void {
    const pos = this.livePos[slot];
    if (pos < 0) return;
    const last = this.live[--this.liveCount];
    this.live[pos] = last;
    this.livePos[last] = pos;
    this.livePos[slot] = -1;
    this.free[this.freeCount++] = slot;
  }

  /**
   * Integrate every live particle and refill the instance attributes.
   *
   * The camera basis arrives as three scalars per axis rather than a Vector3
   * so the hot loop stays on plain numbers — `alignVel` needs to project a
   * world velocity onto the screen axes for every spark in a 45-streak burst.
   */
  step(
    dtMs: number,
    rx: number, ry: number, rz: number,   // camera right, world space
    ux: number, uy: number, uz: number,   // camera up, world space
    fx: number, fy: number, fz: number,   // camera forward, world space
    camX: number, camY: number, camZ: number,
  ): void {
    this.clockMs += dtMs;
    const dt = dtMs * 0.001;

    // --- integrate, killing expired particles by swap-remove --------------
    for (let k = this.liveCount - 1; k >= 0; k--) {
      const i = this.live[k];
      this.age[i] += dtMs;
      if (this.age[i] >= this.life[i] + this.delay[i]) { this.kill(i); continue; }
      if (this.age[i] < this.delay[i]) continue;      // still waiting to appear

      const g = this.gravity[i];
      if (g !== 0) this.vy[i] -= g * dt;
      const dr = this.drag[i];
      if (dr !== 0) {
        // Exponential damping without an exp() call: exact enough at 60 Hz and
        // stable at any dt because the factor is clamped to [0,1].
        const f = 1 - dr * dt;
        const m = f > 0 ? f : 0;
        this.vx[i] *= m; this.vy[i] *= m; this.vz[i] *= m;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      if ((this.flags[i] & FLAG_FLOOR) !== 0 && this.py[i] < this.floorY[i]) {
        this.py[i] = this.floorY[i];
        // Dust and sparks skid along the ground rather than bouncing.
        this.vy[i] = 0;
        this.vx[i] *= 0.72; this.vz[i] *= 0.72;
      }

      this.rot[i] += this.rotVel[i] * dt;
    }

    // --- depth sort (lit layer only) --------------------------------------
    if (this.sorted && this.liveCount > 1) {
      const key = this.sortKey;
      for (let k = 0; k < this.liveCount; k++) {
        const i = this.live[k];
        key[i] = (this.px[i] - camX) * fx + (this.py[i] - camY) * fy + (this.pz[i] - camZ) * fz;
      }
      // Insertion sort, far to near. The array is almost sorted from frame to
      // frame, so this is O(n) in practice and beats allocating for Array.sort.
      for (let k = 1; k < this.liveCount; k++) {
        const v = this.live[k];
        const kv = key[v];
        let j = k - 1;
        while (j >= 0 && key[this.live[j]] < kv) { this.live[j + 1] = this.live[j]; j--; }
        this.live[j + 1] = v;
      }
      for (let k = 0; k < this.liveCount; k++) this.livePos[this.live[k]] = k;
    }

    // --- write the instance attributes ------------------------------------
    const off = this.aOffset.array as Float32Array;
    const quad = this.aQuad.array as Float32Array;
    const ramp = this.aRamp.array as Float32Array;
    const tint = this.aTint.array as Float32Array;

    let n = 0;
    for (let k = 0; k < this.liveCount; k++) {
      const i = this.live[k];
      const a = this.age[i] - this.delay[i];
      if (a < 0) continue;                                  // delayed: not yet visible
      const t = a / this.life[i];

      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.pow(t, this.sizeEase[i]);
      let rot = this.rot[i];
      if ((this.flags[i] & FLAG_ALIGN_VEL) !== 0) {
        // Project the world velocity onto the screen axes so a spark streak
        // always points where it is actually going.
        const sx = this.vx[i] * rx + this.vy[i] * ry + this.vz[i] * rz;
        const sy = this.vx[i] * ux + this.vy[i] * uy + this.vz[i] * uz;
        // ATLAS CONVENTION: every directional tile (streak, spark, kite, star)
        // has its HEAD at v=0, which is the quad's local −Y. Rotating by `rot`
        // sends local (0,−1) to (sin rot, −cos rot); setting that equal to the
        // screen velocity gives atan2(sx, −sy). Getting this backwards points
        // every tracer tail-first, so it is spelled out.
        rot = Math.atan2(sx, -sy);
      }

      let inten = this.i0[i] + (this.i1[i] - this.i0[i]) * t;
      const hz = this.flicker[i];
      if (hz > 0) {
        const p = this.clockMs * 0.001 * hz * Math.PI * 2 + this.seed[i] * 6.2831853;
        inten *= 0.62 + 0.38 * (Math.sin(p) * 0.5 + 0.5);
      }

      const o3 = n * 3;
      const o4 = n * 4;
      off[o3] = this.px[i]; off[o3 + 1] = this.py[i]; off[o3 + 2] = this.pz[i];
      quad[o4] = size; quad[o4 + 1] = size * this.aspect[i];
      quad[o4 + 2] = rot; quad[o4 + 3] = this.packedTile[i];
      ramp[o4] = this.rampRow[i];
      // A life-driven ramp resolves on the CPU; a radial one hands both ends
      // to the shader and lets it interpolate across the sprite.
      ramp[o4 + 1] = this.radial[i] !== 0 ? this.tA[i] : this.tA[i] + (this.tB[i] - this.tA[i]) * t;
      ramp[o4 + 2] = this.tB[i];
      ramp[o4 + 3] = this.radial[i];
      tint[o3] = inten; tint[o3 + 1] = this.alpha[i]; tint[o3 + 2] = 0;
      n++;
    }

    this.geometry.instanceCount = n;
    // `instanceCount = 0` does NOT stop three submitting the mesh: it survives
    // projectObject, gets sorted into the transparent list, has its program
    // bound and issues a zero-instance draw — in BOTH the colour pass and the
    // GTAO normal prepass. A battlefield with no live sprites is the common
    // case, so gate on visibility as well. Cheap, and worth ~4 calls a frame
    // across the two sprite layers plus debris.
    this.mesh.visible = n > 0;
    if (n > 0) {
      markRange(this.aOffset, n * 3);
      markRange(this.aQuad, n * 4);
      markRange(this.aRamp, n * 4);
      markRange(this.aTint, n * 3);
    }
  }

  /** Drop every live particle. Between matches. */
  clear(): void {
    while (this.liveCount > 0) this.kill(this.live[this.liveCount - 1]);
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.geometry.dispose();
  }
}

/** Upload only the used prefix of a dynamic attribute. */
function markRange(attr: THREE.InstancedBufferAttribute, count: number): void {
  const a = attr as unknown as {
    clearUpdateRanges?: () => void;
    addUpdateRange?: (start: number, count: number) => void;
  };
  if (typeof a.clearUpdateRanges === 'function' && typeof a.addUpdateRange === 'function') {
    a.clearUpdateRanges();
    a.addUpdateRange(0, count);
  }
  attr.needsUpdate = true;
}

/* ==========================================================================
 * 6. DEBRIS LAYER — opaque tumbling chunks
 *
 * Bible §8.2 specifies "opaque mesh, 55° cone, 5–9 TL/s, gravity 22 TL/s²,
 * tumble 720°/s". A sprite cannot sell that; a real lit mesh can, and one
 * InstancedMesh of a 20-triangle chunk costs a single draw call.
 * ========================================================================== */

export class DebrisLayer {
  readonly capacity: number;
  readonly mesh: THREE.InstancedMesh;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly spinX: Float32Array;
  private readonly spinY: Float32Array;
  private readonly spinZ: Float32Array;
  private readonly rotX: Float32Array;
  private readonly rotY: Float32Array;
  private readonly rotZ: Float32Array;
  private readonly floorY: Float32Array;

  private readonly free: Int32Array;
  private freeCount: number;
  private readonly live: Int32Array;
  private liveCount = 0;
  private readonly livePos: Int32Array;

  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();

  dropped = 0;

  constructor(capacity: number, material: THREE.Material) {
    this.capacity = capacity;

    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f();
    this.spinX = f(); this.spinY = f(); this.spinZ = f();
    this.rotX = f(); this.rotY = f(); this.rotZ = f();
    this.floorY = f();

    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeCount = capacity;
    this.live = new Int32Array(capacity);
    this.livePos = new Int32Array(capacity).fill(-1);

    // A chamfered wedge, not a box: an angular silhouette reads as torn plate.
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    geo.scale(1.0, 0.62, 1.35);
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.name = 'VfxDebris';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.matrixAutoUpdate = false;
  }

  get count(): number { return this.liveCount; }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    size: number, lifeMs: number,
    spinX: number, spinY: number, spinZ: number,
    floorY: number,
  ): boolean {
    if (this.freeCount === 0) { this.dropped++; return false; }
    const i = this.free[--this.freeCount];
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = lifeMs;
    this.size[i] = size;
    this.spinX[i] = spinX; this.spinY[i] = spinY; this.spinZ[i] = spinZ;
    this.rotX[i] = 0; this.rotY[i] = 0; this.rotZ[i] = 0;
    this.floorY[i] = floorY;
    this.livePos[i] = this.liveCount;
    this.live[this.liveCount++] = i;
    return true;
  }

  private kill(slot: number): void {
    const pos = this.livePos[slot];
    if (pos < 0) return;
    const last = this.live[--this.liveCount];
    this.live[pos] = last;
    this.livePos[last] = pos;
    this.livePos[slot] = -1;
    this.free[this.freeCount++] = slot;
  }

  step(dtMs: number, gravity: number): void {
    const dt = dtMs * 0.001;
    for (let k = this.liveCount - 1; k >= 0; k--) {
      const i = this.live[k];
      this.age[i] += dtMs;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }

      this.vy[i] -= gravity * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rotX[i] += this.spinX[i] * dt;
      this.rotY[i] += this.spinY[i] * dt;
      this.rotZ[i] += this.spinZ[i] * dt;

      if (this.py[i] <= this.floorY[i]) {
        this.py[i] = this.floorY[i];
        // One low bounce, then it settles and the shrink-out takes over.
        this.vy[i] = this.vy[i] < -1.2 ? -this.vy[i] * 0.28 : 0;
        this.vx[i] *= 0.55; this.vz[i] *= 0.55;
        this.spinX[i] *= 0.5; this.spinY[i] *= 0.5; this.spinZ[i] *= 0.5;
      }
    }

    for (let k = 0; k < this.liveCount; k++) {
      const i = this.live[k];
      const t = this.age[i] / this.life[i];
      // Shrink out over the last 25% instead of popping.
      const s = this.size[i] * (t > 0.75 ? 1 - (t - 0.75) * 4 : 1);
      this._e.set(this.rotX[i], this.rotY[i], this.rotZ[i]);
      this._q.setFromEuler(this._e);
      this._p.set(this.px[i], this.py[i], this.pz[i]);
      this._s.setScalar(s > 0 ? s : 0);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(k, this._m);
    }
    this.mesh.count = this.liveCount;
    // count = 0 still costs a colour draw AND a shadow draw; see SpriteLayer.
    this.mesh.visible = this.liveCount > 0;
    if (this.liveCount > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    while (this.liveCount > 0) this.kill(this.live[this.liveCount - 1]);
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/* ==========================================================================
 * 7. THE PARTICLE SYSTEM — the object everything else talks to
 * ========================================================================== */

export class ParticleSystem {
  readonly root = new THREE.Group();
  readonly atlas: THREE.DataTexture;
  readonly ramps: THREE.DataTexture;

  readonly additive: SpriteLayer;
  readonly lit: SpriteLayer;
  readonly debris: DebrisLayer;

  private readonly additiveMat: THREE.ShaderMaterial;
  private readonly litMat: THREE.ShaderMaterial;
  private readonly debrisMat: THREE.MeshStandardMaterial;

  /* -- scratch, allocated once ------------------------------------------- */
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();

  constructor() {
    this.root.name = 'VfxParticles';
    this.root.frustumCulled = false;
    this.atlas = buildSpriteAtlas();
    this.ramps = buildRampTexture();
    const rowStep = VFX_ROW_STEP;

    const commonUniforms = () => ({
      uAtlas: { value: this.atlas },
      uRamp: { value: this.ramps },
      uRowStep: { value: rowStep },
      uCols: { value: VFX_ATLAS_COLS },
    });

    this.additiveMat = new THREE.ShaderMaterial({
      uniforms: commonUniforms(),
      vertexShader: SPRITE_VERT,
      fragmentShader: ADDITIVE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied additive: the fragment already multiplied by alpha, so
      // SRC must be ONE. Three's AdditiveBlending uses SRC_ALPHA and would
      // square the alpha, dimming every core exactly where it must clip.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.additiveMat.name = 'VfxAdditive';

    // Fourteen defaults, from the table both material sets read.
    const lit = litSmokeDefaults();
    this.litMat = new THREE.ShaderMaterial({
      uniforms: {
        ...commonUniforms(),
        uSunDirView: { value: lit.uSunDirView },
        uSunColor: { value: lit.uSunColor },
        uUpView: { value: lit.uUpView },
        uHemiSky: { value: lit.uHemiSky },
        uHemiGround: { value: lit.uHemiGround },
        uShadeDark: { value: lit.uShadeDark },
        uShadeLit: { value: lit.uShadeLit },
        uRimLit: { value: lit.uRimLit },
        uTintGain: { value: lit.uTintGain },
        uShadeGain: { value: lit.uShadeGain },
        uRimGain: { value: lit.uRimGain },
        uFxPosView: { value: lit.uFxPosView },
        uFxColor: { value: lit.uFxColor },
        uFxRange: { value: lit.uFxRange },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: LIT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied "normal" blend.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.litMat.name = 'VfxLitSmoke';

    this.debrisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...VFX_DEBRIS.color),
      roughness: VFX_DEBRIS.roughness,
      metalness: VFX_DEBRIS.metalness,
      flatShading: VFX_DEBRIS.flatShading,
    });
    this.debrisMat.name = 'VfxDebris';

    this.additive = new SpriteLayer(VFX_MAX_ADDITIVE, this.additiveMat, 'VfxAdditive', false);
    this.lit = new SpriteLayer(VFX_MAX_LIT, this.litMat, 'VfxLitSmoke', true);
    this.debris = new DebrisLayer(VFX_MAX_DEBRIS, this.debrisMat);

    // The transparency sort order is one decision in one place (render/scene.ts).
    // Without these the layers sit at renderOrder 0 and draw BEFORE the water
    // plane at 300, so a splash column would be composited under the sea it
    // came out of. Debris is opaque and belongs in the normal opaque pass.
    this.lit.mesh.renderOrder = RENDER_ORDER.PARTICLES;
    // Additive last within the band: the emissive cores must sit on top of the
    // smoke they are lighting, not be blended under it.
    this.additive.mesh.renderOrder = RENDER_ORDER.PARTICLES + 10;
    this.debris.mesh.renderOrder = RENDER_ORDER.OPAQUE;

    this.root.add(this.additive.mesh);
    this.root.add(this.lit.mesh);
    this.root.add(this.debris.mesh);
  }

  attach(scene: THREE.Scene): void {
    scene.add(this.root);
  }

  /** Total live sprites + chunks, for the debug overlay. */
  get liveCount(): number {
    return this.additive.count + this.lit.count + this.debris.count;
  }

  /**
   * Push the sun and sky into the lit-smoke shader. Called whenever the
   * lighting rig changes, and once per frame for the view-space transform.
   */
  syncLighting(
    camera: THREE.Camera,
    sunDirWorld: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number,
    hemiSky: THREE.Color, hemiGround: THREE.Color, hemiIntensity: number,
  ): void {
    const u = this.litMat.uniforms;
    // World -> view for the sun and for world-up. `transformDirection` uses
    // only the rotation, which is what a direction needs.
    this._v.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
    (u.uSunDirView.value as THREE.Vector3).copy(this._v).normalize();
    this._v.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    (u.uUpView.value as THREE.Vector3).copy(this._v).normalize();
    (u.uSunColor.value as THREE.Vector3).set(
      sunColor.r * sunIntensity * 0.32,
      sunColor.g * sunIntensity * 0.32,
      sunColor.b * sunIntensity * 0.32,
    );
    (u.uHemiSky.value as THREE.Vector3).set(
      hemiSky.r * hemiIntensity, hemiSky.g * hemiIntensity, hemiSky.b * hemiIntensity,
    );
    (u.uHemiGround.value as THREE.Vector3).set(
      hemiGround.r * hemiIntensity, hemiGround.g * hemiIntensity, hemiGround.b * hemiIntensity,
    );
  }

  /**
   * Feed the strongest live VFX point light into the smoke shader, so the
   * underside of a plume genuinely takes the fireball's orange (bible §8.7's
   * `#926339` lit underside) rather than staying neutral.
   */
  setDominantLight(
    camera: THREE.Camera,
    x: number, y: number, z: number,
    r: number, g: number, b: number, range: number,
  ): void {
    const u = this.litMat.uniforms;
    this._v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    (u.uFxPosView.value as THREE.Vector3).copy(this._v);
    (u.uFxColor.value as THREE.Vector3).set(r, g, b);
    u.uFxRange.value = range;
  }

  /** Integrate and upload. Once per rendered frame. */
  step(dtMs: number, camera: THREE.Camera, debrisGravity: number): void {
    const m = camera.matrixWorld.elements;
    this._right.set(m[0], m[1], m[2]).normalize();
    this._up.set(m[4], m[5], m[6]).normalize();
    // Column 2 of a view matrix points BEHIND the camera; negate for forward.
    this._fwd.set(-m[8], -m[9], -m[10]).normalize();
    const cx = m[12], cy = m[13], cz = m[14];

    this.additive.step(
      dtMs,
      this._right.x, this._right.y, this._right.z,
      this._up.x, this._up.y, this._up.z,
      this._fwd.x, this._fwd.y, this._fwd.z,
      cx, cy, cz,
    );
    this.lit.step(
      dtMs,
      this._right.x, this._right.y, this._right.z,
      this._up.x, this._up.y, this._up.z,
      this._fwd.x, this._fwd.y, this._fwd.z,
      cx, cy, cz,
    );
    this.debris.step(dtMs, debrisGravity);
  }

  clear(): void {
    this.additive.clear();
    this.lit.clear();
    this.debris.clear();
  }

  dispose(): void {
    this.additive.dispose();
    this.lit.dispose();
    this.debris.dispose();
    this.additiveMat.dispose();
    this.litMat.dispose();
    this.debrisMat.dispose();
    this.atlas.dispose();
    this.ramps.dispose();
    this.root.removeFromParent();
  }
}

function linearVec3(hex: string): THREE.Vector3 {
  const out = new Float32Array(3);
  hexToLinearRgb(hex, out);
  return new THREE.Vector3(out[0], out[1], out[2]);
}

/* ==========================================================================
 * 8. MODULE-LEVEL ACCESS
 * ========================================================================== */

let systemInstance: ParticleSystem | null = null;

/** The VFX system sets this in `init()`. */
export function setParticleSystem(next: ParticleSystem | null): void {
  systemInstance = next;
}

/** The live particle system, or null before `init()`. */
export function particles(): ParticleSystem | null {
  return systemInstance;
}

/** Emit into the additive layer. Safe (and silent) before init. */
export function emitAdditive(d: EmitDesc): void {
  systemInstance?.additive.emit(d);
}

/** Emit into the lit (normal-blended, sun-shaded) layer. */
export function emitLit(d: EmitDesc): void {
  systemInstance?.lit.emit(d);
}

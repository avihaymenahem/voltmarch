/**
 * ============================================================================
 * RED ALERT — src/world/TerrainMaterial.ts
 * ============================================================================
 * THE GROUND SHADER. Three quarters of every frame is bare ground, so this
 * file gets more care than any single building.
 *
 * WHY onBeforeCompile AND NOT A RawShaderMaterial
 * -----------------------------------------------
 * Terrain has to receive the CSM shadow, the hemisphere fill, the PMREM
 * environment and the scene fog exactly the way every other surface does, or
 * the ground and the units read as two different renders. Re-implementing
 * three's lighting in a hand-written shader is how that divergence happens.
 * We inject into `MeshStandardMaterial` instead and replace three chunks:
 * `map_fragment` (what colour is this pixel), `roughnessmap_fragment` (how
 * rough is it) and `normal_fragment_begin` (which way is it facing).
 * Everything else is stock.
 *
 * ONE MATERIAL, TWO SHADING MODELS
 * --------------------------------
 * A terrace face is not the flat-ground shader with a different texture — it
 * needs vertical striation, a coping cap, an overhang shadow and a scree
 * skirt, none of which mean anything on a horizontal surface. The obvious
 * implementation is two MATERIALS over two index groups per chunk. Measured,
 * that put terrain alone at 84 draw calls of the game's 130 budget, because
 * every chunk costs two draws in the main pass and two more in the shadow
 * pass. So the two models live in ONE program behind a per-TRIANGLE branch:
 * one draw per chunk, and no runtime cost, because the branch condition is
 * constant across a triangle and therefore perfectly coherent inside every
 * warp that is not straddling a terrace lip.
 *
 * THE SPLAT SCHEME
 * ----------------
 *   uSplat0.rgba -> weights for layers 0..3   (ground, dirt, sand, rock)
 *   uSplat1.rg   -> weights for layers 4..5   (concrete, paving)
 *   uLayers      -> ONE sampler2DArray holding all six albedos.
 *
 * Six layers through one array sampler is the whole reason this fits in a
 * budget: the naive version needs 6 samplers for albedo alone, and a WebGL2
 * fragment shader has 16 total across the entire program.
 *
 * ANTI-TILING, IN THREE LAYERS
 * ----------------------------
 *  1. **Mask warp.** The splat lookup is displaced by +/-0.6 m of fbm before
 *     it is sampled. Bible §6.2(b): perturb the MASK, not the colour. A
 *     straight-line alpha ramp between two ground types is the instant
 *     prototype tell.
 *  2. **Macro breakup.** A 28-38 m noise modulates luminance +/-20% and pulls
 *     the dark end toward a biome tint. This is what kills the visible repeat
 *     of an 8 m tile at 86 m of visible ground.
 *  3. **Per-cell jitter.** A hard-edged hash per 4 m build cell, +/-4.5%, with
 *     7% of cells landing markedly darker. VISUAL_DNA §1.4 layer L3 — this
 *     quantised, deliberately un-smoothed variation is a signature of the
 *     series and reads as "authored tiles" rather than "noise function".
 * ============================================================================
 */

import * as THREE from 'three';
import { packAlbedo, textures, type GenParams } from '../core/assets';
import { fbm2, hexToLinearRgb, simplex2 } from '../core/math';
import { CELL, CLIFF_SLOPE, MAP_SIZE } from '../core/config';
import { SURFACE_COUNT, SurfaceId, type BiomeDef } from './Biomes';

/* ==========================================================================
 * 1. THE UNIFORM BLOCK
 * ========================================================================== */

/**
 * Every uniform the terrain program reads. Held as ONE object of THREE.IUniform
 * so a biome swap mutates values in place — `applyBiome` never allocates a
 * texture or rebuilds a program, which is what keeps a live biome change
 * instant instead of a two-second hitch.
 */
export interface TerrainUniforms {
  /** sampler2DArray, six albedo layers. */
  uLayers: { value: THREE.DataArrayTexture | null };
  /** RGBA weights for layers 0..3. */
  uSplat0: { value: THREE.DataTexture | null };
  /** RG weights for layers 4..5. */
  uSplat1: { value: THREE.DataTexture | null };
  /** Two-channel fbm used to displace the splat lookup. */
  uWarp: { value: THREE.DataTexture | null };
  /** Low-frequency breakup + tint mask. */
  uMacro: { value: THREE.DataTexture | null };

  uInvMapSize: { value: number };
  uLayerScale: { value: number[] };
  uLayerRough: { value: number[] };

  uMacroScale: { value: number };
  uMacroStrength: { value: number };
  uMacroTint: { value: THREE.Vector3 };
  uWarpScale: { value: number };
  uWarpAmp: { value: number };
  uCellSize: { value: number };
  uCellJitter: { value: number };

  /* -- cliff ------------------------------------------------------------- */
  /** Face-normal Y below which the cliff model is selected. */
  uCliffNy: { value: number };
  uCliffBase: { value: THREE.Vector3 };
  uCliffShade: { value: THREE.Vector3 };
  uCliffHi: { value: THREE.Vector3 };
  uCliffCap: { value: THREE.Vector3 };
  uCliffCapM: { value: number };
  uCliffSkirtM: { value: number };
  uStriationM: { value: number };
  uCourseM: { value: number };
  uCourseOn: { value: number };
  uCliffRelief: { value: number };
  uCliffRough: { value: number };
  uCliffGrainMean: { value: number };
  uStepHeight: { value: number };
  /** 0..1 blend from the smooth vertex normal to the true face normal. */
  uFaceMix: { value: number };

  [key: string]: THREE.IUniform;
}

function createUniforms(): TerrainUniforms {
  return {
    uLayers: { value: null },
    uSplat0: { value: null },
    uSplat1: { value: null },
    uWarp: { value: null },
    uMacro: { value: null },

    uInvMapSize: { value: 1 / MAP_SIZE },
    uLayerScale: { value: [8, 5.5, 6.5, 7, 4.8, 3.2] },
    uLayerRough: { value: [0.95, 0.92, 0.9, 0.85, 0.7, 0.68] },

    uMacroScale: { value: 34 },
    uMacroStrength: { value: 0.2 },
    uMacroTint: { value: new THREE.Vector3(0.06, 0.06, 0.02) },
    uWarpScale: { value: 7.5 },
    uWarpAmp: { value: 0.62 },
    uCellSize: { value: CELL },
    uCellJitter: { value: 0.045 },

    uCliffNy: { value: Math.cos(CLIFF_SLOPE) },
    uCliffBase: { value: new THREE.Vector3(0.19, 0.17, 0.1) },
    uCliffShade: { value: new THREE.Vector3(0.06, 0.05, 0.03) },
    uCliffHi: { value: new THREE.Vector3(0.32, 0.29, 0.18) },
    uCliffCap: { value: new THREE.Vector3(0.1, 0.12, 0.01) },
    uCliffCapM: { value: 0.75 },
    uCliffSkirtM: { value: 1.3 },
    uStriationM: { value: 0.46 },
    uCourseM: { value: 0.22 },
    uCourseOn: { value: 0 },
    uCliffRelief: { value: 0.55 },
    uCliffRough: { value: 0.85 },
    uCliffGrainMean: { value: 0.17 },
    uStepHeight: { value: 6 },
    uFaceMix: { value: 0.78 },
  };
}

/* ==========================================================================
 * 2. GLSL
 * ========================================================================== */

/**
 * Injected into `<common>` in the vertex shader.
 *
 * `aUp` and `aTop` are the vertex's metres above the foot and below the lip of
 * its local terrace face, over the step height. The cliff model needs both to
 * place the scree skirt and the coping cap, and neither can be recovered from
 * world position after the fact.
 */
const VERT_COMMON = /* glsl */ `
attribute float aUp;
attribute float aTop;
varying vec3 vRaWorld;
varying vec3 vRaWorldN;
varying float vRaUp;
varying float vRaTop;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
vec4 raWorld4 = modelMatrix * vec4( transformed, 1.0 );
vRaWorld = raWorld4.xyz;
vRaWorldN = normalize( mat3( modelMatrix ) * objectNormal );
vRaUp = aUp;
vRaTop = aTop;
`;

/** Injected into `<common>` in the fragment shader. */
const FRAG_COMMON = /* glsl */ `
uniform sampler2DArray uLayers;
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uWarp;
uniform sampler2D uMacro;
uniform float uLayerScale[ 6 ];
uniform float uLayerRough[ 6 ];
uniform float uInvMapSize;
uniform float uMacroScale;
uniform float uMacroStrength;
uniform vec3  uMacroTint;
uniform float uWarpScale;
uniform float uWarpAmp;
uniform float uCellSize;
uniform float uCellJitter;

uniform float uCliffNy;
uniform float uFaceMix;
uniform vec3  uCliffBase;
uniform vec3  uCliffShade;
uniform vec3  uCliffHi;
uniform vec3  uCliffCap;
uniform float uCliffCapM;
uniform float uCliffSkirtM;
uniform float uStriationM;
uniform float uCourseM;
uniform float uCourseOn;
uniform float uCliffRelief;
uniform float uCliffRough;
uniform float uCliffGrainMean;
uniform float uStepHeight;

varying vec3 vRaWorld;
varying vec3 vRaWorldN;
varying float vRaUp;
varying float vRaTop;

// Hash / value noise. Terrain detail that costs a texture fetch is terrain
// detail we cannot afford six times over, so the cheap stuff lives in ALU.
float raHash21( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float raValue2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = raHash21( i );
  float b = raHash21( i + vec2( 1.0, 0.0 ) );
  float c = raHash21( i + vec2( 0.0, 1.0 ) );
  float d = raHash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// The 28-38 m regional layer. Shared by ground AND cliff so a rock face and
// the dirt at its foot never disagree about which part of the map they are in.
vec3 raMacro( vec3 col, vec2 wxz ) {
  vec3 m = texture2D( uMacro, wxz / uMacroScale ).rgb;
  col *= 1.0 + ( m.r - 0.5 ) * 2.0 * uMacroStrength;
  col = mix( col, uMacroTint, clamp( ( 0.55 - m.g ) * uMacroStrength * 1.5, 0.0, 1.0 ) );
  return col;
}
`;

/**
 * The whole surface, as one `<map_fragment>` replacement.
 *
 * The branch condition comes from the TRUE face normal, rebuilt from
 * screen-space derivatives, against the same CLIFF_SLOPE threshold the nav
 * grid uses — so a face a unit cannot climb is exactly a face that renders as
 * rock. The derivatives are taken BEFORE the branch: `dFdx` inside non-uniform
 * control flow is undefined in GLSL and in practice returns garbage mips.
 */
const FRAG_SURFACE = /* glsl */ `
vec2 raXZ = vRaWorld.xz;
vec3 raSmoothN = normalize( vRaWorldN );

// The face normal, rebuilt from screen-space derivatives — and GUARDED.
//
// On a large flat plain seen at a grazing angle the two derivatives grow long
// and nearly parallel, so their cross product collapses toward zero and
// normalize() returns numerical noise. The cliff test downstream then flips
// at random over WHOLE REGIONS: ?shot=naval rendered about a third of its
// frame as a black rock plate with bright cliff-cap slabs across dead-flat
// ground, while the same terrain at the same seed rendered correctly from the
// terrain-showcase camera. It is a camera-angle-dependent artefact, which is
// why it never showed up in the module's own isolated renders.
//
// Two independent guards, because either alone leaves a hole:
//   1. a degenerate cross product falls back to the interpolated vertex normal,
//      which is always defined;
//   2. the cliff branch additionally requires the VERTEX normal to be steep.
//      A plateau's vertex normal is ~+Y and a wall's is ~horizontal, so this
//      rejects nothing real while making a derivative glitch unable to paint
//      flat ground as rock on its own.
vec3 raDx = dFdx( vRaWorld );
vec3 raDy = dFdy( vRaWorld );
vec3 raCross = cross( raDx, raDy );
float raCrossLen = length( raCross );
vec3 raFace = raCrossLen > 1e-7 ? raCross / raCrossLen : raSmoothN;
if ( dot( raFace, raSmoothN ) < 0.0 ) raFace = - raFace;
bool raIsCliff = raFace.y < uCliffNy && raSmoothN.y < uCliffNy + 0.18;

vec3 raCol = vec3( 0.5 );
float raRough = 0.9;
vec3 raShadeN = raSmoothN;

if ( raIsCliff ) {

  vec3 raP = vRaWorld;

  // TRUE two-plane triplanar. The obvious shortcut — blend the COORDINATE and
  // sample once — destroys the texture's screen-space derivatives wherever the
  // blend weights cross, and the GPU answers with a near-infinite mip level
  // and a face full of diagonal mush. Sample both planes, blend the RESULT.
  float raWx = abs( raFace.x );
  float raWz = abs( raFace.z );
  float raWs = max( raWx + raWz, 1e-4 );
  raWx /= raWs;
  raWz /= raWs;

  // 1.8x the flat-ground tiling. A terrace face is seen at a grazing angle
  // from a 39 degree camera, so its vertical texel density is several times
  // the ground's; sampling it at the ground's scale is a guaranteed moire.
  float raCliffScale = uLayerScale[ 3 ] * 1.8;
  vec3 raGrainC =
    texture( uLayers, vec3( vec2( raP.z, - raP.y ) / raCliffScale, 3.0 ) ).rgb * raWx +
    texture( uLayers, vec3( vec2( raP.x, - raP.y ) / raCliffScale, 3.0 ) ).rgb * raWz;

  // Sharpen the weights so one axis dominates everywhere except a narrow band
  // around the 45 degree faces — that keeps the ANALYTIC striation below at a
  // true 0.46 m wavelength instead of stretching it by up to sqrt(2).
  float raSx = raWx * raWx * raWx;
  float raSz = raWz * raWz * raWz;
  float raHoriz = ( raP.z * raSx + raP.x * raSz ) / max( raSx + raSz, 1e-4 );

  // Vertical striation: one random tone per stria plus a soft groove.
  float raStria = raHoriz / uStriationM;
  float raBand = raHash21( vec2( floor( raStria ), 3.7 ) );
  float raSub = fract( raStria );
  float raGroove = 1.0 - abs( raSub * 2.0 - 1.0 );
  float raErode = raValue2( vec2( raHoriz * 1.35, raP.y * 0.8 ) );

  vec3 raRock = mix( uCliffShade, uCliffBase, clamp( raBand * 0.66 + raErode * 0.44, 0.0, 1.0 ) );
  raRock = mix( raRock, uCliffHi, smoothstep( 0.62, 1.0, raGroove ) * ( 0.14 + raBand * 0.24 ) );

  // Fine grain as a LUMINANCE modulation, normalised by the biome's own rock
  // luminance so the authored cliff colour survives the multiply.
  float raGrainL = dot( raGrainC, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( uCliffGrainMean, 1e-4 );
  raRock *= mix( 1.0, clamp( raGrainL, 0.55, 1.45 ), 0.38 );

  // Retaining-wall mode: horizontal mortar courses + running-bond brick jitter.
  float raCourseF = raP.y / max( uCourseM, 0.001 );
  float raCoursePhase = fract( raCourseF );
  float raJoint = smoothstep( 0.12, 0.0, min( raCoursePhase, 1.0 - raCoursePhase ) );
  float raRow = floor( raCourseF );
  float raBrick = raHash21( vec2(
    floor( raHoriz / ( uStriationM * 2.0 ) + mod( raRow, 2.0 ) * 0.5 ), raRow ) );
  raRock *= mix( 1.0, ( 1.0 - raJoint * 0.42 ) * ( 0.88 + raBrick * 0.24 ), uCourseOn );

  // The cap. On natural rock this is the overhung soil/grass lip; on a
  // retaining wall it is the grey concrete coping. Either way it is THE detail
  // that stops the top edge reading as a cut polygon (bible 6.4).
  //
  // vRaTop is metres below the LOCAL top of this face over the step height:
  // measured from the geometry, not inferred from height modulo a tier,
  // because the +/-0.6 m swell makes a modulo wrap unpredictably and the cap
  // then breaks into disconnected slabs instead of a continuous band.
  float raBelowTop = vRaTop * uStepHeight;
  float raCap = 1.0 - smoothstep( 0.0, uCliffCapM, raBelowTop );
  raRock = mix( raRock, uCliffCap, raCap * 0.92 );
  // Contact shadow in the overhang directly under that lip.
  raRock *= mix( 0.62, 1.0, smoothstep( uCliffCapM, uCliffCapM * 2.4, raBelowTop ) );

  // Boulder skirt at the foot of the face.
  float raAboveBase = vRaUp * uStepHeight;
  raRock = mix( raRock, uCliffShade * 1.3,
    ( 1.0 - smoothstep( 0.0, uCliffSkirtM, raAboveBase ) ) * 0.45 );

  raCol = raMacro( raRock, raP.xz );
  raRough = uCliffRough;

  // Hard faceting plus a striation tilt standing in for the +/-0.25 m of real
  // relief the bible specifies. The interpolated vertex normal is correct for
  // the plateaus and wrong for an 80 degree wall, where it reads as a mound.
  vec3 raTan = normalize( cross( vec3( 0.0, 1.0, 0.0 ), raFace ) + vec3( 1e-5 ) );
  raShadeN = normalize( raFace
    + raTan * ( raSub * 2.0 - 1.0 ) * uCliffRelief * ( 0.3 + raBand * 0.7 ) );

} else {

  // 1. Warp the MASK, not the colour (bible 6.2b). +/-0.6 m of boundary noise.
  vec2 raWarp = ( texture2D( uWarp, raXZ / uWarpScale ).rg - 0.5 ) * uWarpAmp;
  vec2 raSuv = ( raXZ + raWarp ) * uInvMapSize;

  vec4 raS0 = texture2D( uSplat0, raSuv );
  vec4 raS1 = texture2D( uSplat1, raSuv );

  float raW[ 6 ];
  raW[ 0 ] = raS0.r; raW[ 1 ] = raS0.g; raW[ 2 ] = raS0.b; raW[ 3 ] = raS0.a;
  raW[ 4 ] = raS1.r; raW[ 5 ] = raS1.g;
  float raSum = raW[0] + raW[1] + raW[2] + raW[3] + raW[4] + raW[5];
  float raNorm = 1.0 / max( raSum, 1e-3 );

  vec3 raAlbedo = vec3( 0.0 );
  float raR = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    float w = raW[ i ] * raNorm;
    raAlbedo += texture( uLayers, vec3( raXZ / uLayerScale[ i ], float( i ) ) ).rgb * w;
    raR += uLayerRough[ i ] * w;
  }

  // 2. Regional breakup.
  raAlbedo = raMacro( raAlbedo, raXZ );

  // 3. Per-build-cell jitter, hard edged and un-smoothed on purpose, with a 7%
  //    tail of markedly darker cells (VISUAL_DNA L3).
  float raCell = raHash21( floor( raXZ / uCellSize ) + 0.5 );
  raAlbedo *= 1.0 + ( raCell - 0.5 ) * 2.0 * uCellJitter - step( 0.93, raCell ) * uCellJitter * 2.2;

  raCol = raAlbedo;
  raRough = raR;

}

diffuseColor.rgb *= max( raCol, vec3( 0.0 ) );
`;

/** Swap in the cliff's face normal after three has built the shading normal. */
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
if ( raIsCliff ) {
  normal = normalize( mix( normal,
    normalize( ( viewMatrix * vec4( raShadeN, 0.0 ) ).xyz ), uFaceMix ) );
}
`;

/* ==========================================================================
 * 3. PROCEDURAL SUPPORT TEXTURES
 * ========================================================================== */

/**
 * Two independent fbm channels in R and G, used to displace the splat lookup.
 * They must be INDEPENDENT: a warp built from one channel and its inverse
 * pushes every boundary along a single diagonal and reads as a shear.
 */
function buildWarpTexture(seed: number): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const f = 6 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 3, 2, 0.55, seed);
      const b = fbm2(x * f + 11.3, y * f + 7.9, 3, 2, 0.55, seed + 977);
      data[o] = Math.max(0, Math.min(255, Math.round((a * 0.5 + 0.5) * 255)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round((b * 0.5 + 0.5) * 255)));
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'terrain.warp';
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * R = regional luminance swell, G = an independent mask driving the tint pull,
 * B = a coarse blotch. Sampled at 28-38 m per repeat, this is the layer that
 * makes an 8 m grass tile invisible.
 */
function buildMacroTexture(seed: number): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const f = 3.5 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 4, 2, 0.52, seed) * 0.5 + 0.5;
      const b = fbm2(x * f * 1.7 + 3.1, y * f * 1.7 - 5.4, 3, 2, 0.5, seed + 421) * 0.5 + 0.5;
      const c = simplex2(x * f * 0.6, y * f * 0.6, seed + 88) * 0.5 + 0.5;
      data[o] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      data[o + 1] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      data[o + 2] = Math.round(Math.max(0, Math.min(1, c)) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'terrain.macro';
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Pack all six biome layers into one `sampler2DArray`.
 *
 * `TextureFactory.surface()` caches the generated float Surface, so switching
 * biome back and forth only pays the generator cost once per (biome, layer).
 * Setting `colorSpace = SRGBColorSpace` gets the GPU's own SRGB8_ALPHA8 decode
 * for free — doing the pow(2.2) in the shader instead would cost six of them
 * per fragment.
 */
export function buildLayerArrayTexture(biome: BiomeDef, size: number): THREE.DataArrayTexture {
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * SURFACE_COUNT);

  for (let i = 0; i < SURFACE_COUNT; i++) {
    const L = biome.layers[i];
    const params: Required<GenParams> = {
      size,
      seed: L.seed,
      colorA: L.albedo,
      colorB: L.shade,
      colorC: L.accent,
      scale: L.genScale,
      amount: 1,
      roughness: L.roughness,
      metalness: 0,
      relief: 2,
    };
    const surface = textures.surface(L.gen, params);
    data.set(packAlbedo(surface), layerBytes * i);
  }

  const tex = new THREE.DataArrayTexture(data, size, size, SURFACE_COUNT);
  tex.name = `terrain.layers.${biome.key}`;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 4. THE MATERIAL
 * ========================================================================== */

export interface TerrainMaterialSet {
  /** The one terrain program. Ground and cliff both live in here. */
  readonly material: THREE.MeshStandardMaterial;
  /** Live uniform block; mutate values, never replace the object. */
  readonly uniforms: TerrainUniforms;
  /** Point the splat samplers at the terrain's control textures. */
  setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void;
  /** Re-tint for a biome. Uniforms + the layer array only; no recompile. */
  applyBiome(biome: BiomeDef): void;
  /** Anisotropy is a renderer capability, so it is pushed in from outside. */
  setAnisotropy(a: number): void;
  dispose(): void;
}

export interface CreateTerrainMaterialOptions {
  biome: BiomeDef;
  /** Edge length of each generated layer albedo. 256 is ample at 3-10 m tiling. */
  layerTextureSize: number;
  /** Deterministic seed for the warp/macro support textures. */
  seed: number;
}

const SCRATCH_RGB = new Float32Array(3);

function setLinear(v: THREE.Vector3, hex: string): void {
  hexToLinearRgb(hex, SCRATCH_RGB);
  v.set(SCRATCH_RGB[0], SCRATCH_RGB[1], SCRATCH_RGB[2]);
}

/** Relative luminance of a hex colour in LINEAR space. */
function linearLuma(hex: string): number {
  hexToLinearRgb(hex, SCRATCH_RGB);
  return SCRATCH_RGB[0] * 0.2126 + SCRATCH_RGB[1] * 0.7152 + SCRATCH_RGB[2] * 0.0722;
}

export function createTerrainMaterials(options: CreateTerrainMaterialOptions): TerrainMaterialSet {
  const uniforms = createUniforms();

  const warp = buildWarpTexture(options.seed ^ 0x51ab);
  const macro = buildMacroTexture(options.seed ^ 0x9d31);
  uniforms.uWarp.value = warp;
  uniforms.uMacro.value = macro;

  let layers: THREE.DataArrayTexture | null = null;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    // The splat supplies roughness per layer; this is only the fallback before
    // `roughnessmap_fragment` is replaced.
    roughness: 0.92,
    metalness: 0.0,
    dithering: true,
  });
  material.name = 'Terrain';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_COMMON}`)
      .replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_COMMON}`)
      .replace('#include <map_fragment>', FRAG_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = raRough;')
      .replace('#include <normal_fragment_begin>', FRAG_NORMAL);
  };
  material.customProgramCacheKey = () => 'ra-terrain-v2';

  function applyBiome(biome: BiomeDef): void {
    const scale = uniforms.uLayerScale.value;
    const rough = uniforms.uLayerRough.value;
    for (let i = 0; i < SURFACE_COUNT; i++) {
      scale[i] = biome.layers[i].tileMetres;
      rough[i] = biome.layers[i].roughness;
    }

    uniforms.uMacroScale.value = biome.macroMetres;
    uniforms.uMacroStrength.value = biome.macroStrength;
    setLinear(uniforms.uMacroTint.value, biome.macroTint);
    uniforms.uWarpScale.value = biome.warpMetres;
    uniforms.uWarpAmp.value = biome.warpAmplitude;
    uniforms.uCellJitter.value = biome.cellJitter;

    const c = biome.cliff;
    setLinear(uniforms.uCliffBase.value, c.base);
    setLinear(uniforms.uCliffShade.value, c.shade);
    setLinear(uniforms.uCliffHi.value, c.highlight);
    setLinear(uniforms.uCliffCap.value, c.capColor);
    uniforms.uCliffCapM.value = c.capMetres;
    uniforms.uCliffSkirtM.value = c.skirtMetres;
    uniforms.uStriationM.value = c.striationMetres;
    uniforms.uCourseM.value = c.courseMetres > 0 ? c.courseMetres : 0.22;
    uniforms.uCourseOn.value = c.courseMetres > 0 ? 1 : 0;
    uniforms.uCliffRelief.value = c.relief;
    uniforms.uCliffRough.value = c.roughness;
    uniforms.uCliffGrainMean.value = Math.max(1e-3, linearLuma(biome.layers[SurfaceId.Rock].albedo));
    uniforms.uStepHeight.value = biome.stepHeight;

    // The layer array is the only thing a biome swap must actually rebuild.
    const next = buildLayerArrayTexture(biome, options.layerTextureSize);
    const prev = layers;
    layers = next;
    uniforms.uLayers.value = next;
    prev?.dispose();
  }

  applyBiome(options.biome);

  return {
    material,
    uniforms,

    setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void {
      uniforms.uSplat0.value = a;
      uniforms.uSplat1.value = b;
    },

    applyBiome,

    setAnisotropy(a: number): void {
      if (layers) {
        layers.anisotropy = a;
        layers.needsUpdate = true;
      }
    },

    dispose(): void {
      material.dispose();
      warp.dispose();
      macro.dispose();
      layers?.dispose();
      layers = null;
    },
  };
}

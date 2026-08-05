/**
 * ============================================================================
 * VOLTMARCH — src/world/TerrainMaterial.ts
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
 *  3. **Per-cell jitter.** A hard-edged hash per 4 m build cell, +/-3.8%, with
 *     3.5% of cells landing modestly darker. VISUAL_DNA §1.4 layer L3 — this
 *     quantised, deliberately un-smoothed variation is a signature of the
 *     series and reads as "authored tiles" rather than "noise function".
 *
 * THE NOISE PURGE (and why the layer tiles are now nearly flat)
 * ------------------------------------------------------------
 * These six tiles used to come out of `assets.ts` `genGround`: five octaves of
 * fbm, plus a second fbm at 7x frequency, plus a 9x worley clump field, all of
 * it into albedo AND into height. A layer tiles at 5-10 m across 256 texels,
 * so one texel is 2-4 cm; the camera at RTS distance also resolves 3-4 cm per
 * screen pixel. Those last octaves were therefore PER-PIXEL noise, which the
 * look bible's one rule forbids outright.
 *
 * Every layer is now either
 *   - a `field`: one flat colour, two band-limited drifts whose shortest
 *     wavelength is 48 texels (1.5 m of ground, ~40 screen px at 1440p), and
 *     the mesoscale colour axis described in section 3B-bis, or
 *   - `slab` / `cobble`: `assets.ts`'s clean `paving` / `cobblestone`
 *     generators, which are flat faces separated by crisp drawn joints and get
 *     NONE of the mesoscale treatment — mottling concrete is how you get back
 *     to static.
 *
 * Height is written EXACTLY 0.5 on every field tile. Nothing reads it — the
 * terrain material has no normalMap, the cliff normal is analytic — but a flat
 * height field is the guarantee that no future packer can resurrect the
 * sandpaper specular from these tiles.
 *
 * THE PURGE LEFT A HOLE, AND 3B-bis FILLS IT
 * ------------------------------------------
 * Between the 4 cm texel floor and that 1.5 m drift there was nothing at all,
 * and the macro (28-38 m), the cell jitter (4 m) and the mask warp (0.6 m) all
 * sit above it. That empty 4 cm - 1.5 m band is exactly what the eye reads as
 * surface material, which is why a lawn at minimum zoom looked like a painted
 * slab. Section 3B-bis adds 0.32-1.25 m of HUE AND CHROMA variation into it,
 * baked into the tile at generation time, with the screen-pixel floor written
 * down as a number and re-derived from the live camera config by
 * `tests/terrain-frequency.spec.ts`.
 *
 * BOUNDARIES, NOT BLENDS
 * ----------------------
 * RA3's ground types meet at a KERB or a hard edge, never over a four-metre
 * dissolve. The splat control texture is one texel per 4 m build cell, so a
 * raw linear fetch dissolves over a full cell. `uSplatSharpen` raises the
 * weights to a power before normalising, which narrows the transition to
 * roughly `1/sharpen` of a cell while leaving the winning layer unchanged.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  NOISE_BUDGET, budgetedNoise, createSurface, packAlbedo, textures, type Surface,
} from '../core/assets';
import { clamp01, fbm2, hexToLinearRgb, lerp, simplex2, smoothstep } from '../core/math';
import { CELL, CLIFF_SLOPE, MAP_SIZE } from '../core/config';
import { SURFACE_COUNT, SurfaceId, type BiomeDef, type SurfaceLayerDef } from './Biomes';

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
  /**
   * Exponent applied to every splat weight before renormalising. 1 = the raw
   * linear dissolve; higher narrows the transition band. 2.8 turns a 4 m mush
   * into roughly a 1.4 m edge, which is what a mown lawn meeting a gravel
   * apron actually looks like.
   */
  uSplatSharpen: { value: number };

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

/**
 * Splat-weight exponent. Not per-biome: the control texture's resolution is a
 * property of the terrain grid, not of the art, so the correct sharpening is
 * the same everywhere. Above ~4 the boundary starts to show the control
 * texture's own 4 m stair-stepping through the warp.
 */
const SPLAT_SHARPEN = 2.8;

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
    uMacroStrength: { value: 0.13 },
    uMacroTint: { value: new THREE.Vector3(0.088, 0.068, 0.019) },
    uWarpScale: { value: 11 },
    uWarpAmp: { value: 0.55 },
    uCellSize: { value: CELL },
    uCellJitter: { value: 0.038 },
    uSplatSharpen: { value: SPLAT_SHARPEN },

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
uniform float uSplatSharpen;

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

  // 1b. SHARPEN the blend. The control texture carries one texel per 4 m build
  //     cell, so a raw bilinear fetch dissolves grass into gravel over a whole
  //     cell and every surface boundary reads as mush. Raising each weight to
  //     a power and renormalising is monotone — the layer that was winning
  //     still wins — but it collapses the transition band to about 1/N of a
  //     cell, which is the crisp edge RA3 actually has.
  for ( int i = 0; i < 6; i ++ ) raW[ i ] = pow( max( raW[ i ], 0.0 ), uSplatSharpen );

  float raSum = raW[0] + raW[1] + raW[2] + raW[3] + raW[4] + raW[5];
  float raNorm = 1.0 / max( raSum, 1e-6 );

  vec3 raAlbedo = vec3( 0.0 );
  float raR = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    float w = raW[ i ] * raNorm;
    raAlbedo += texture( uLayers, vec3( raXZ / uLayerScale[ i ], float( i ) ) ).rgb * w;
    raR += uLayerRough[ i ] * w;
  }

  // 2. Regional breakup.
  raAlbedo = raMacro( raAlbedo, raXZ );

  // 3. Per-build-cell jitter, hard edged and un-smoothed on purpose, with a
  //    3.5% tail of modestly darker cells (VISUAL_DNA L3).
  //
  //    The tail used to be 7% of cells at 2.2x the jitter, i.e. cells up to
  //    14% dark. On grass that produced texels dark enough that the blue-grey
  //    fog lerp dragged them into the emerald hue window — the same failure
  //    the layer palettes were retuned for. Shallower tail, same signature.
  float raCell = raHash21( floor( raXZ / uCellSize ) + 0.5 );
  raAlbedo *= 1.0 + ( raCell - 0.5 ) * 2.0 * uCellJitter - step( 0.965, raCell ) * uCellJitter * 1.1;

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
 *
 * TWO octaves, not three, and at 2/3 the base frequency. The point of the warp
 * is to stop a surface boundary being a straight line — it is not a source of
 * detail. The third octave landed at ~5 texels of a 128-texel tile spread over
 * 11 m, i.e. a 40 cm wobble, which turned every grass/dirt edge into a fringe
 * of noise instead of a shape. Mipmaps are on for the same reason: a warp that
 * aliases at distance is a boundary that crawls when the camera pans.
 */
function buildWarpTexture(seed: number): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const f = 4 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 2, 2, 0.5, seed);
      const b = fbm2(x * f + 11.3, y * f + 7.9, 2, 2, 0.5, seed + 977);
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
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * R = regional luminance swell, G = an independent mask driving the tint pull,
 * B = a coarse blotch. Sampled at 28-38 m per repeat, this is the layer that
 * makes an 8 m grass tile invisible.
 *
 * TWO octaves everywhere. At four octaves and a base of 3.5 cycles per 256
 * texels, the finest octave was ~9 texels of a tile covering 34 m — a 1.2 m
 * blotch, which at RTS distance reads as dirt smeared on the lawn rather than
 * as regional variation. Two octaves puts the finest feature at ~6.5 m, so the
 * layer does exactly one job: hide the repeat of an 8 m tile.
 */
function buildMacroTexture(seed: number): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const f = 2.6 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 2, 2, 0.5, seed) * 0.5 + 0.5;
      const b = fbm2(x * f * 1.4 + 3.1, y * f * 1.4 - 5.4, 2, 2, 0.5, seed + 421) * 0.5 + 0.5;
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

/* --------------------------------------------------------------------------
 * 3B. THE CLEAN LAYER TILES
 * ------------------------------------------------------------------------ */

/**
 * Hard ceiling on a field layer's broad value drift. 6% peak-to-mean is what
 * "you can tell it is not a solid fill" costs; anything past that starts to
 * read as staining rather than as ground.
 */
export const FIELD_DRIFT_CAP = 0.06;

/** Hard ceiling on how far a patch can pull toward `shade` / `accent`. */
export const FIELD_PATCH_CAP = 0.45;

/**
 * Shortest wavelength any field drift may use, in texels — twice the
 * `assets.ts` floor. A layer tiles at 5-10 m over 256 texels, so 48 texels is
 * 1-2 m of ground and roughly 40 screen pixels at 1440p. That is the boundary
 * between "broad soft variation" and "grain".
 */
export const FIELD_MIN_WAVELENGTH = NOISE_BUDGET.MIN_FEATURE_TEXELS * 2;

/* --------------------------------------------------------------------------
 * 3B-bis. THE MESOSCALE BAND — the hole the purge left behind
 * ------------------------------------------------------------------------ */

/**
 * ============================================================================
 * WHY THIS EXISTS, GIVEN THAT "NO NOISE" IS THE ONE RULE
 * ============================================================================
 * Both things are true at once:
 *
 *   - The purge above was right. `genGround` wrote five octaves of fbm plus a
 *     7x fbm plus a 9x worley field at 2-4 cm per texel, while the camera
 *     resolves ~1-4 cm per screen pixel. That is per-PIXEL noise, it aliases,
 *     and roads looked like TV static.
 *   - And the ground had a HOLE in it. Count what the terrain actually varies
 *     at today: 28-38 m macro, 4 m per-cell hash, +/-0.6 m mask warp, and
 *     nothing inside a field tile shorter than 48 texels ~ 1.5 m. Below 4 cm
 *     is banned and above 1.5 m is covered, so the whole 4 cm - 1.5 m band is
 *     empty — and that band is precisely what the eye reads as SURFACE
 *     MATERIAL. Soil mottling, grass clumping, patchiness, wear. Its absence
 *     is why a lawn at minimum zoom is a flat olive slab.
 *
 * So the rule is not "no variation". The rule is "nothing at or below the
 * screen-pixel scale", and the fix is to say that in a number.
 *
 * ----------------------------------------------------------------------------
 * THE FLOOR, DERIVED FROM THE ACTUAL CAMERA
 * ----------------------------------------------------------------------------
 * `tests/terrain-frequency.spec.ts` re-derives every line of this from the live
 * `RENDER_CONFIG.camera`, so lowering `minDistance` or flattening the pitch
 * clamp turns the suite red instead of quietly resurrecting the sandpaper.
 * The numbers below are today's:
 *
 *   fov 36 deg vertical over 1440 px  ->  2*tan(18)/1440 = 4.5128e-4
 *                                          metres of view plane per pixel,
 *                                          per metre of slant range
 *   minDistance 30 m, pitchAtMinDistance 46 deg
 *   camera height          h = 30 * sin(46)          = 21.580 m
 *   bottom-of-frame ray at   46 + 36/2 = 64 deg below horizontal
 *   nearest visible ground   D = h / sin(64)         = 24.010 m   <- worst case
 *   ground metres per screen pixel, along the SCREEN-HORIZONTAL axis (which
 *   lies in the ground plane, so it is un-foreshortened and therefore the
 *   FINER of the two axes):
 *                            24.010 * 4.5128e-4      = 0.010835 m  (1.08 cm)
 *
 * A shallower pitch moves that D down, so the pitch clamp is load-bearing and
 * the test asserts against it.
 *
 * At a floor of `MESO_MIN_SCREEN_PX` = 16 screen pixels, the shortest ground
 * wavelength anything here may carry is 16 * 0.010835 = 0.1734 m. We declare
 * 0.24 m, a 38% margin, and the finest component actually used is 0.32 m —
 * about 30 screen pixels at the worst case. Nothing near a pixel.
 * ============================================================================
 */

/**
 * The safety floor, in SCREEN pixels at 1440p, at the closest gameplay zoom.
 *
 * 8 px is the defensible minimum — below it a feature is inside the SMAA
 * kernel and inside the mip transition, which is where the original bug lived.
 * 16 is chosen instead because the derivation has three soft spots (the
 * viewport can be taller than 1440 on an ultrawide, `pitch` is becoming
 * player-adjustable, and a future zoom-in would shrink `minDistance`), and a
 * 2x margin is cheaper than re-deriving this under pressure.
 */
export const MESO_MIN_SCREEN_PX = 16;

/**
 * The declared ground-space floor in metres. Must be >= the value the camera
 * derivation above produces; the test computes that value and compares.
 */
export const MESO_MIN_METRES = 0.24;

/**
 * A texel floor as well as a metre floor, and the tile takes whichever is
 * COARSER.
 *
 * The metre floor answers "does this alias on screen". The texel floor answers
 * a different question: "does this survive mipping and does it trip
 * `checkNoiseBudget`". A 10-texel feature is still 5 texels at mip 1 and 2.5 at
 * mip 2, so it fades out with distance rather than sparkling — and its steepest
 * one-texel step is `amp * (1 - cos(2*pi/10))` = 0.19 * amp, two orders below
 * the speckle gate at the amplitudes used here.
 *
 * Half of `NOISE_BUDGET.MIN_FEATURE_TEXELS`, and deliberately NOT a change to
 * that constant: every other generator in the game keeps the 24-texel floor.
 * This is the one place with a measured screen-pixel argument for going below
 * it, so this is the only place that does.
 */
export const MESO_MIN_TEXELS = 10;

/** Fine octave, in METRES of ground. Linear, so its harmonic order is 1. */
export const MESO_FINE_METRES = 0.32;

/**
 * Wide octave, in METRES of ground. Shaped by `mesoShape` below, which is a
 * CUBIC, so it carries energy up to 3x its fundamental: its effective shortest
 * wavelength is 1.25 / 3 = 0.417 m.
 *
 * This is the trap that produced the original bug in a different costume. fbm
 * has energy all the way to Nyquist by definition; a NONLINEARITY applied to a
 * band-limited field does the same thing more quietly. `smoothstep` is a cubic
 * and multiplies the bandwidth by 3, `abs()`/`max(0,x)` rectification has
 * harmonics that never terminate at all. So: the wide octave gets a cubic and
 * pays 3x for it, the fine octave gets nothing, and the result is applied
 * ADDITIVELY rather than through a `lerp` — because `lerp(v, c, t)` multiplies
 * two fields together and a product's bandwidth is the SUM of theirs.
 */
export const MESO_WIDE_METRES = 1.25;

/** Bandwidth multiplier of `mesoShape`. A cubic polynomial: exactly 3. */
export const MESO_WIDE_ORDER = 3;

/**
 * Clump shaper for the wide octave. `0.35*t + 0.65*t^3` on t in [-1,1]:
 * odd (so it adds no DC), bounded by 1, and flat near zero — which is what
 * turns a sine field into "mostly ordinary ground with occasional patches"
 * rather than a rolling swell. Degree 3, and nothing here may raise that
 * without raising `MESO_WIDE_METRES` to match.
 */
function mesoShape(t: number): number {
  return 0.35 * t + 0.65 * t * t * t;
}

/** Relative weight of the two octaves. Sums to exactly 1, so |meso| <= 1. */
export const MESO_FINE_WEIGHT = 0.45;
export const MESO_WIDE_WEIGHT = 0.55;

/**
 * How far a texel may travel along the bare<->lush axis, per unit of `L.patch`.
 * `patch` already means "how blotchy is this ground" per layer, so reusing it
 * keeps sand and snow flat (0.22 / 0.18) and lets dirt mottle (0.38) without
 * inventing a def field.
 */
export const MESO_PULL_GAIN = 2.6;

/** Absolute ceiling on that pull, whatever `patch` says. */
export const MESO_PULL_MAX = 0.95;

/**
 * THE AXIS ITSELF — and why it is a colour axis and not a brightness one.
 *
 * Uniform luminance jitter is the thing that reads as dirt on the lens; it is
 * also exactly what the banned full-screen film grain was already doing. Real
 * ground varies in HUE and CHROMA: a dense clump of grass is more saturated and
 * slightly DARKER (the blades shadow each other), a thin patch is less
 * saturated, slightly lighter and warmer because soil is showing through.
 *
 * So the axis is built as two derived endpoints and applied as a signed
 * displacement about the layer's own colour:
 *
 *   lush = chroma x 1.56, luma x 0.925
 *   bare = chroma x 0.36, luma x 1.075, warmed
 *
 * Those look violent written down and are not, because the field they multiply
 * has an RMS of 0.11 and a measured peak of 0.49 — a twelve-harmonic sum with
 * random phases is nowhere near its bound. Measured on the temperate grass tile
 * at 256: saturation 0.817 +/- 0.037, value 0.431 +/- 0.007. That is 4.6% of
 * chroma against 1.6% of brightness, which is the ratio the whole design is
 * for, and `tests/terrain-frequency.spec.ts` asserts it stays above 1.5.
 *
 * Three properties make this safe by construction, which matters because the
 * emerald window (scorecard #9, weight 3, automatic fail) is one bad green
 * away:
 *
 *   1. Chroma scaling is `v -> L + (v - L)*k` about the texel's own luminance
 *      with k > 0. That is monotone in v, so it CANNOT reorder the channels:
 *      a layer authored with r >= g still has r >= g afterwards, at any k.
 *   2. It is also luminance-NEUTRAL under the same weights `checkNoiseBudget`
 *      uses, so the chroma half of this contributes exactly zero to the speckle
 *      metric and zero to the tile's contrast ratio.
 *   3. The warm tilt raises r and lowers b, which moves AWAY from hue 100-120,
 *      and it is gated off entirely on cool surfaces (`r < b`) so that snow ice
 *      does not turn brown.
 */
const MESO_LUSH_CHROMA = 1.56;
const MESO_LUSH_LUMA = 0.925;
const MESO_BARE_CHROMA = 0.36;
const MESO_BARE_LUMA = 1.075;
/** Per-channel tilt of the bare end, before luma is renormalised. */
const MESO_WARM = [1.14, 0.93, 0.82] as const;

const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;

/* -- the band-limited field ------------------------------------------------ */

/**
 * A sum of plane waves at INTEGER frequencies, same construction as
 * `assets.ts` `budgetedNoise` and for the same three reasons: exactly periodic
 * (so the tile is seamless), band-limited by construction (so the floor is a
 * guarantee rather than a hope), and bounded in amplitude.
 *
 * It is a separate implementation rather than a parameter on `budgetedNoise`
 * because `budgetedNoise`'s 24-texel floor is a promise made to every other
 * generator in the game, and the correct way to take a lower floor is to bring
 * your own screen-pixel argument — not to weaken theirs.
 *
 * Two differences from `budgetedNoise`, both tightening:
 *   - `cycles` is FLOORED, not rounded, so the realised wavelength is always
 *     >= the requested one rather than within half a texel of it;
 *   - every harmonic is clamped so `|n| <= cycles` AFTER rounding. Rounding the
 *     two axes independently can otherwise push a diagonal harmonic past the
 *     base frequency by up to 0.71 cycles.
 */

/**
 * TWELVE harmonics, STRATIFIED, over a band running down to 0.30 of the base
 * frequency. All three of those were bought with a visible artefact.
 *
 *  - Five harmonics inside 0.62-1.0 of one frequency is not a noise field, it
 *    is a moire lattice, and at the amplitude this ships at you can see the
 *    grid: a regular diagonal cross-hatch over the whole lawn.
 *  - Widening the band to 0.30-1.0 costs nothing, because the wavelength floor
 *    constrains only the TOP of the band. Everything below is free.
 *  - Twelve UNIFORMLY RANDOM directions still clump, and a clump of parallel
 *    waves is a streak: the grass tile came out combed diagonally. Jittered
 *    stratification (see `mesoWaveSet`) fixed it.
 *
 * Amplitudes are FLAT rather than rolled off, for the same reason: any
 * roll-off puts most of the energy in the first two or three harmonics and the
 * lattice comes straight back.
 */
const MESO_HARMONICS = 12;
/** Lowest fraction of the base frequency a harmonic may take. */
const MESO_BAND_LOW = 0.30;
const TAU = Math.PI * 2;

interface MesoWaves {
  nx: Int32Array; ny: Int32Array; phase: Int32Array; amp: Float32Array;
}

const mesoCache = new Map<string, MesoWaves>();

/**
 * `sin(TAU * j / size)` for integer j. Every harmonic's argument here is
 * `TAU * (nx*x + ny*y + phase) / size` with all four terms INTEGER, so the sine
 * only ever takes `size` distinct values and a table is EXACT rather than an
 * approximation. (Phase is quantised to whole texels to make it so, which costs
 * nothing — the phase was an arbitrary random offset to begin with.)
 *
 * Worth doing because this is 24 harmonic evaluations per texel across four
 * 256x256 layers per biome. Table plus the row recurrence in `mesoOctaveRow`
 * took the whole mesoscale field from 51 ms per layer to 2.2 ms.
 */
const mesoSinTables = new Map<number, Float64Array>();

function mesoSinTable(size: number): Float64Array {
  const hit = mesoSinTables.get(size);
  if (hit !== undefined) return hit;
  const t = new Float64Array(size);
  for (let j = 0; j < size; j++) t[j] = Math.sin((TAU * j) / size);
  if (mesoSinTables.size > 8) mesoSinTables.clear();
  mesoSinTables.set(size, t);
  return t;
}

/** Deterministic integer hash -> [0,1). No `Math.random`, ever. */
function mesoHash(i: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build (or fetch) the harmonic set whose highest spatial frequency is exactly
 * `cycles` per tile. Exported so the test can assert that bound directly rather
 * than trusting this comment.
 */
export function mesoWaveSet(cycles: number, seed: number, size: number): MesoWaves {
  const key = `${cycles}:${seed}:${size}`;
  const hit = mesoCache.get(key);
  if (hit !== undefined) return hit;

  const nx = new Int32Array(MESO_HARMONICS), ny = new Int32Array(MESO_HARMONICS);
  const phase = new Int32Array(MESO_HARMONICS), amp = new Float32Array(MESO_HARMONICS);
  let norm = 0;
  for (let k = 0; k < MESO_HARMONICS; k++) {
    // STRATIFIED, not random, in both angle and radius.
    //
    // Twelve independently-random directions are not twelve evenly-spread
    // directions — they clump, and a clump of parallel waves is a visible
    // streak. The grass tile came out combed diagonally at this amplitude with
    // uniform-random angles. Jittered stratification keeps every draw distinct
    // while guaranteeing the directions actually cover the circle.
    //
    // The angle strata span [0, PI), not [0, 2*PI): for a real-valued field a
    // wave at theta and one at theta+PI are the same wave with a sign flip, so
    // spreading over the full circle wastes half the strata on duplicates.
    const a = ((k + mesoHash(k * 5 + 1, seed)) / MESO_HARMONICS) * Math.PI;
    // Radius strata are visited in a permuted order — 5 is coprime with 12, so
    // `5k mod 12` hits every stratum exactly once — which stops the low
    // frequencies all landing on neighbouring directions.
    const rk = (k * 5) % MESO_HARMONICS;
    // MESO_BAND_LOW..1.0 of the base frequency. Never above it.
    const r = MESO_BAND_LOW
      + ((rk + mesoHash(k * 5 + 2, seed)) / MESO_HARMONICS) * (1 - MESO_BAND_LOW);
    let ix = Math.round(Math.cos(a) * cycles * r);
    let iy = Math.round(Math.sin(a) * cycles * r);
    if (ix === 0 && iy === 0) ix = 1;
    // Hard clamp: independent rounding can push |n| past `cycles`.
    const mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > cycles) {
      const s = cycles / mag;
      ix = Math.trunc(ix * s);
      iy = Math.trunc(iy * s);
      if (ix === 0 && iy === 0) ix = Math.max(1, Math.floor(cycles));
    }
    nx[k] = ix;
    ny[k] = iy;
    phase[k] = Math.floor(mesoHash(k * 5 + 3, seed) * size) % size;
    // FLAT. With twelve harmonics any roll-off puts most of the energy in the
    // first few and the lattice comes straight back; equal weights are what
    // makes the sum read as mottling.
    amp[k] = 1;
    norm += amp[k];
  }
  // Normalised so the sum is bounded by exactly 1.
  for (let k = 0; k < MESO_HARMONICS; k++) amp[k] /= norm;

  const ws: MesoWaves = { nx, ny, phase, amp };
  if (mesoCache.size > 256) mesoCache.clear();
  mesoCache.set(key, ws);
  return ws;
}

/**
 * Cycles per tile for a requested ground wavelength, honouring BOTH floors.
 * Exported: this is the number the frequency test reasons about.
 */
export function mesoCycles(size: number, tileMetres: number, wantMetres: number): number {
  const texelsPerMetre = size / tileMetres;
  const wlTexels = Math.max(MESO_MIN_TEXELS, wantMetres * texelsPerMetre);
  return Math.max(1, Math.floor(size / wlTexels));
}

/** The realised ground wavelength of a component, after both floors. */
export function mesoWavelengthMetres(
  size: number, tileMetres: number, wantMetres: number,
): number {
  return tileMetres / mesoCycles(size, tileMetres, wantMetres);
}

/**
 * One band-limited octave across a whole SCANLINE, into `out[0..size)`.
 *
 * Row-incremental on purpose. The sine index is
 * `(nx*x + ny*y + phase) mod size` with every term an integer, so along a row
 * it advances by exactly `nx` per texel — no multiply, no modulo, one compare.
 * Twenty-four table reads per texel is the single most expensive thing in tile
 * generation (it measured 51 of the 116 ms a 256x256 field layer costs, i.e.
 * +203 ms on every biome build), and this is the version that gives that back
 * without changing a single output value.
 *
 * `step` is reduced into [0, size) and `j` starts there, so `j + step < 2*size`
 * and one conditional subtraction is a complete wrap.
 */
function mesoOctaveRow(
  out: Float64Array, y: number, size: number, cycles: number, seed: number,
): void {
  const w = mesoWaveSet(cycles, seed, size);
  const sin = mesoSinTable(size);
  out.fill(0, 0, size);
  for (let k = 0; k < MESO_HARMONICS; k++) {
    let j = (((w.ny[k] * y + w.phase[k]) % size) + size) % size;
    const step = ((w.nx[k] % size) + size) % size;
    const a = w.amp[k];
    for (let x = 0; x < size; x++) {
      out[x] += a * sin[j];
      j += step;
      if (j >= size) j -= size;
    }
  }
}

/** Scratch rows, grown on demand. Tile generation is single-threaded. */
let mesoRowFine = new Float64Array(0);
let mesoRowWide = new Float64Array(0);

/**
 * The mesoscale clump field for one layer across a scanline, each value in
 * [-1, 1]. Negative is bare / thin / dry, positive is dense / lush.
 */
export function mesoFieldRow(
  out: Float64Array, y: number, size: number, tileMetres: number, seed: number,
): void {
  if (mesoRowFine.length < size) {
    mesoRowFine = new Float64Array(size);
    mesoRowWide = new Float64Array(size);
  }
  mesoOctaveRow(mesoRowFine, y, size, mesoCycles(size, tileMetres, MESO_FINE_METRES), seed + 131);
  mesoOctaveRow(mesoRowWide, y, size, mesoCycles(size, tileMetres, MESO_WIDE_METRES), seed + 197);
  for (let x = 0; x < size; x++) {
    out[x] = MESO_FINE_WEIGHT * mesoRowFine[x] + MESO_WIDE_WEIGHT * mesoShape(mesoRowWide[x]);
  }
}

/** Scratch for the single-texel accessor below. */
let mesoRowOne = new Float64Array(0);

/**
 * One texel of the mesoscale field. Defined THROUGH the row version rather
 * than beside it, so there is exactly one implementation and the two cannot
 * drift — the row form is the one that ships and this is the one the tests
 * read, and a second copy of the index arithmetic is how they would disagree.
 *
 * Exported so `tests/terrain-frequency.spec.ts` can run a real DFT over the
 * field and assert there is no energy above the declared cutoff — the
 * empirical half of the safety argument, as opposed to the structural half.
 */
export function mesoField(
  x: number, y: number, size: number, tileMetres: number, seed: number,
): number {
  if (mesoRowOne.length < size) mesoRowOne = new Float64Array(size);
  mesoFieldRow(mesoRowOne, y, size, tileMetres, seed);
  return mesoRowOne[x];
}

/* -- the colour axis ------------------------------------------------------- */

/**
 * One end of the bare<->lush axis. `warm` is 0 or 1 and is applied BEFORE the
 * luma renormalisation, so the tilt changes hue without changing brightness.
 */
function mesoEnd(
  base: Float32Array, chroma: number, luma: number, warm: number, out: Float32Array,
): void {
  let r = base[0] * (1 + (MESO_WARM[0] - 1) * warm);
  let g = base[1] * (1 + (MESO_WARM[1] - 1) * warm);
  let b = base[2] * (1 + (MESO_WARM[2] - 1) * warm);

  const l0 = base[0] * LUMA_R + base[1] * LUMA_G + base[2] * LUMA_B;
  const l1 = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const target = l0 * luma;
  const k = target / Math.max(l1, 1e-5);
  r *= k; g *= k; b *= k;

  // Chroma about the (now exact) target luminance: monotone in each channel, so
  // it cannot reorder r/g/b, and luminance-neutral under the same weights.
  out[0] = target + (r - target) * chroma;
  out[1] = target + (g - target) * chroma;
  out[2] = target + (b - target) * chroma;
}

const MESO_LUSH = new Float32Array(3);
const MESO_BARE = new Float32Array(3);

/**
 * Fraction of a layer's own `r - g` margin the hue tilt is allowed to spend.
 *
 * `r >= g` on every natural ground layer is the property that survives the
 * lighting — see the header of `Biomes.ts`. The blue hemisphere fill multiplies
 * green 1.7x harder than red and the blue-grey fog lerp then lifts blue, so a
 * `g > r` albedo lands at hue ~104 no matter how it was authored. Chroma and
 * luma scaling are monotone per channel and cannot break it. The WARM TILT can,
 * and on `snow/rock` (`#6B6A60`, r over g by exactly one 8-bit step) it did:
 * 9035 texels of 65536 came out green-dominant before this budget existed.
 *
 * Half, not all, because the drift and the shade/accent lerps upstream also
 * shrink the margin slightly before the meso term ever sees it.
 */
const MESO_ORDER_KEEP = 0.5;

/**
 * Half the difference between the two endpoints, i.e. the displacement applied
 * per unit of the (signed) clump field. Writes into `out`.
 *
 * The warm tilt is scaled down — to zero if necessary — until the axis provably
 * cannot reorder red and green anywhere on the tile. A near-neutral grey has no
 * hue headroom to spend and correctly gets no hue drift; grass, with six 8-bit
 * steps between r and g, gets all of it.
 */
function mesoAxis(
  base: Float32Array, shade: Float32Array, accent: Float32Array,
  pull: number, out: Float32Array,
): void {
  // Warm is meaningful only where soil could plausibly show through. On a
  // cool-hued layer (snow ice, `b > r`) it would rotate cyan to orange.
  const coolGate = base[0] >= base[2] ? 1 : 0;

  // Everything upstream of the meso term is either a uniform scale (the drift)
  // or a lerp between these three authored tones, and both preserve `r >= g`.
  // So the smallest of their margins bounds what the meso term may eat.
  const margin = Math.min(base[0] - base[1], shade[0] - shade[1], accent[0] - accent[1]);
  const budget = Math.max(0, margin) * MESO_ORDER_KEEP / Math.max(pull, 1e-4);

  mesoEnd(base, MESO_LUSH_CHROMA, MESO_LUSH_LUMA, 0, MESO_LUSH);

  // `|axis_r - axis_g|` is monotone in `warm`, so bisect. Once per layer, and
  // the layer surfaces are cached, so the cost is not on any hot path.
  let lo = 0, hi = coolGate;
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) * 0.5;
    mesoEnd(base, MESO_BARE_CHROMA, MESO_BARE_LUMA, mid, MESO_BARE);
    const skew = Math.abs((MESO_LUSH[0] - MESO_BARE[0]) - (MESO_LUSH[1] - MESO_BARE[1])) * 0.5;
    if (skew <= budget) lo = mid; else hi = mid;
  }
  mesoEnd(base, MESO_BARE_CHROMA, MESO_BARE_LUMA, lo, MESO_BARE);

  for (let c = 0; c < 3; c++) out[c] = (MESO_LUSH[c] - MESO_BARE[c]) * 0.5;
}

/** How far this layer travels along that axis. */
export function mesoPull(L: SurfaceLayerDef): number {
  return Math.min(MESO_PULL_MAX, clamp01(L.patch ?? 0.3) * MESO_PULL_GAIN);
}

/** Parse '#RRGGBB' to sRGB 0..1, which is the space `Surface.albedo` is in. */
function hexTriple(hex: string, out: Float32Array): Float32Array {
  const v = parseInt(hex.replace('#', ''), 16) | 0;
  out[0] = ((v >> 16) & 0xff) / 255;
  out[1] = ((v >> 8) & 0xff) / 255;
  out[2] = (v & 0xff) / 255;
  return out;
}

const FIELD_BASE = new Float32Array(3);
const FIELD_SHADE = new Float32Array(3);
const FIELD_ACCENT = new Float32Array(3);
const FIELD_MESO_AXIS = new Float32Array(3);

/** Field surfaces are generated here, so they need their own cache. */
const fieldCache = new Map<string, Surface>();

/**
 * A broad, soft, near-flat natural ground tile.
 *
 * FOUR band-limited layers and nothing else:
 *   - two out-of-phase value drifts at 1/5 and 1/2.2 of the tile,
 *   - one very low frequency mask that pulls toward `shade` on its low side
 *     and `accent` on its high side, giving damp/dry blotches several metres
 *     across,
 *   - and the MESOSCALE colour axis, 0.32-1.25 m, which is the band section
 *     3B-bis exists to fill. It is a hue/chroma displacement, not a brightness
 *     one, and it is ADDED rather than lerped so that it introduces no
 *     frequency-mixing product with the three above.
 *
 * The first three go through `budgetedNoise` and the fourth through
 * `mesoFieldRow`; both are sums of plane waves at integer frequencies, so they
 * are exactly periodic (the tile is seamless), band-limited by construction
 * (the wavelength floor is a guarantee and not a hope), and amplitude-clamped.
 * There is deliberately no way to ask either of them for contrast.
 */
export function buildFieldSurface(L: SurfaceLayerDef, size: number): Surface {
  const s = createSurface(size);
  const base = hexTriple(L.albedo, FIELD_BASE);
  const shade = hexTriple(L.shade, FIELD_SHADE);
  const accent = hexTriple(L.accent, FIELD_ACCENT);

  const amp = Math.min(Math.abs(L.variation ?? 0.045), FIELD_DRIFT_CAP);
  const patch = clamp01(L.patch ?? 0.3) * FIELD_PATCH_CAP;
  const seed = L.seed | 0;

  const wlFine = Math.max(FIELD_MIN_WAVELENGTH, size / 5);
  const wlWide = Math.max(FIELD_MIN_WAVELENGTH, size / 2.2);
  const wlPatch = Math.max(FIELD_MIN_WAVELENGTH, size / 1.6);

  // Mesoscale: one constant colour direction, one signed field, one gain.
  const pull = mesoPull(L);
  const axis = FIELD_MESO_AXIS;
  mesoAxis(base, shade, accent, pull, axis);
  const mesoRow = new Float64Array(size);

  for (let y = 0; y < size; y++) {
    mesoFieldRow(mesoRow, y, size, L.tileMetres, seed);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const drift =
        budgetedNoise(x, y, size, wlFine, amp * 0.55, seed + 11, FIELD_DRIFT_CAP) +
        budgetedNoise(x, y, size, wlWide, amp * 0.45, seed + 29, FIELD_DRIFT_CAP);

      // One mask, two mutually exclusive pulls: below 0.5 toward shade, above
      // toward accent. One mask rather than two because two independent masks
      // can overlap and cancel, and the result is a flat average instead of
      // legible patches.
      const m = 0.5 + budgetedNoise(x, y, size, wlPatch, 0.5, seed + 53, 0.5);
      const toAccent = smoothstep(0.50, 0.72, m) * patch;
      const toShade = smoothstep(0.50, 0.28, m) * patch;

      const meso = mesoRow[x] * pull;

      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        let v = base[c] * (1 + drift);
        v = lerp(v, accent[c], toAccent);
        v = lerp(v, shade[c], toShade);
        // Additive, not lerped: a lerp would multiply this field by the three
        // above and a product's bandwidth is the SUM of its factors'.
        v += axis[c] * meso;
        s.albedo[o + c] = clamp01(v);
      }

      // Exactly flat. Nothing on natural ground is geometry at this scale, and
      // a constant height field is the guarantee that no packer can turn this
      // tile back into a sandpaper normal map.
      s.height[i] = 0.5;
      s.roughness[i] = clamp01(L.roughness);
      s.metalness[i] = 0;
      s.ao[i] = 1;
      s.teamMask[i] = 0;
    }
  }
  return s;
}

/**
 * How many slabs / setts fit across one tile.
 *
 * Restricted to powers of two that divide `size`, because `paving` and
 * `cobblestone` only tile seamlessly when the cell grid divides the texture
 * exactly — a 4.8 m tile with 1.2 m slabs wants 4 across, and asking for a
 * non-divisor silently produces a sheared row at the wrap.
 */
function snapCells(tileMetres: number, featureMetres: number, size: number): number {
  const want = Math.max(1, tileMetres / Math.max(0.05, featureMetres));
  let best = 1;
  for (const c of [1, 2, 4, 8, 16, 32, 64]) {
    if (size % c !== 0) continue;
    if (Math.abs(Math.log(c / want)) < Math.abs(Math.log(best / want))) best = c;
  }
  return best;
}

/** Build (or fetch) one layer's albedo Surface. */
export function buildLayerSurface(L: SurfaceLayerDef, size: number): Surface {
  if (L.surface === 'field') {
    const key = [
      size, L.seed, L.albedo, L.shade, L.accent, L.roughness, L.variation, L.patch,
    ].join('|');
    const hit = fieldCache.get(key);
    if (hit !== undefined) return hit;
    const s = buildFieldSurface(L, size);
    if (fieldCache.size > 64) fieldCache.clear();
    fieldCache.set(key, s);
    return s;
  }

  const cells = snapCells(L.tileMetres, L.featureMetres ?? 1.2, size);
  const cellTexels = size / cells;
  // Joints are drawn at ~4.5 cm of world width, clamped so they never fall
  // below the ~1.6 texels a crisp anti-aliased line needs, nor grow into a
  // band wide enough to darken the surface average.
  const jointWidth = Math.min(3.0, Math.max(1.6, (size / L.tileMetres) * 0.045));

  if (L.surface === 'cobble') {
    return textures.surface('cobblestone', {
      size, seed: L.seed,
      colour: L.albedo, jointColour: L.joint ?? L.shade,
      stoneSize: cellTexels, jointWidth,
      // 0.42 rather than the generator's 0.35 default: RA3's plaza setts are
      // visibly irregular in outline, and at 0.35 the grid still reads.
      variation: L.variation ?? 0.04, jitter: 0.42,
      wear: 0.3, roughness: L.roughness,
    });
  }

  return textures.surface('paving', {
    size, seed: L.seed,
    colour: L.albedo, jointColour: L.joint ?? L.shade,
    slabW: cellTexels, slabH: cellTexels, jointWidth,
    variation: L.variation ?? 0.03, bond: 0,
    wear: 0.3, roughness: L.roughness,
  });
}

/**
 * Pack all six biome layers into one `sampler2DArray`.
 *
 * Both the field cache above and `TextureFactory.surface()` memoise the
 * generated float Surface, so switching biome back and forth only pays the
 * generator cost once per (biome, layer). Setting
 * `colorSpace = SRGBColorSpace` gets the GPU's own SRGB8_ALPHA8 decode for
 * free — doing the pow(2.2) in the shader instead would cost six of them per
 * fragment.
 */
export function buildLayerArrayTexture(biome: BiomeDef, size: number): THREE.DataArrayTexture {
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * SURFACE_COUNT);

  for (let i = 0; i < SURFACE_COUNT; i++) {
    data.set(packAlbedo(buildLayerSurface(biome.layers[i], size)), layerBytes * i);
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
  // Bumped with every change to the injected GLSL above. three caches compiled
  // programs by this string, so leaving it stale after editing a chunk hands
  // you the OLD shader in any session that already compiled one.
  material.customProgramCacheKey = () => 'ra-terrain-v3';

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

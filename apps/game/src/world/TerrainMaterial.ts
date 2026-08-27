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
 * Field height now carries only the same band-limited 1.5-4 m structure used
 * by the colour drift. A second six-layer array packs its structural normal,
 * roughness delta and cavity; the high-frequency generators remain banned, so
 * this restores soil/turf response without resurrecting sandpaper specular.
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
import { SURFACE_COUNT, type BiomeDef } from './Biomes';
import {
  MACRO_N, WARP_N, buildLayerArrayBytes, buildLayerResponseArrayBytes,
  buildMacroBytes, buildWarpBytes,
  macroSeed, terrainTextureKey, warpSeed, type TerrainTextureData,
} from './terrain-texture-gen';
import {
  SPLAT_SHARPEN, TERRAIN_LAYER_ROUGH_DEFAULT, TERRAIN_LAYER_SCALE_DEFAULT,
  TERRAIN_SCALAR_DEFAULTS, TERRAIN_VEC3_DEFAULTS,
  applyTerrainBiome, type TerrainBiomeSink,
} from './terrain-uniforms';
import {
  TERRAIN_DETAIL_ROUGHNESS, TERRAIN_DETAIL_STRENGTH, TERRAIN_DETAIL_TILE_METRES,
  createTerrainDetailMask,
} from './terrain-detail-mask';

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
  /** sampler2DArray, normal XY / roughness delta / cavity for all six layers. */
  uResponses: { value: THREE.DataArrayTexture | null };
  /** RGBA weights for layers 0..3. */
  uSplat0: { value: THREE.DataTexture | null };
  /** RG weights for layers 4..5. */
  uSplat1: { value: THREE.DataTexture | null };
  /** Two-channel fbm used to displace the splat lookup. */
  uWarp: { value: THREE.DataTexture | null };
  /** Low-frequency breakup + tint mask. */
  uMacro: { value: THREE.DataTexture | null };
  /** Project-owner-supplied tileable detail, restricted to natural splat layers. */
  uTerrainDetail: { value: THREE.Texture };

  uInvMapSize: { value: number };
  uLayerScale: { value: number[] };
  uLayerRough: { value: number[] };

  uMacroScale: { value: number };
  uMacroStrength: { value: number };
  uMacroTint: { value: THREE.Vector3 };
  uTerrainDetailTileM: { value: number };
  uTerrainDetailStrength: { value: number };
  uTerrainDetailRoughness: { value: number };
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
 * THE DEFAULTS AND THE BIOME TABLE ARE IN `./terrain-uniforms.ts` NOW, and they
 * moved because there are two terrain materials. `TerrainNodeMaterial.ts` is
 * the TSL port for the node-material renderer path, it has to mean exactly what
 * this file means by a biome, and two copies of `applyBiome` that agree today
 * is the drift CLAUDE.md catalogues. The values below are unchanged — this is a
 * move, not an edit, and `npm run shots` is what says so.
 */
function createUniforms(terrainDetail: THREE.Texture): TerrainUniforms {
  const S = TERRAIN_SCALAR_DEFAULTS;
  const v3 = (c: readonly number[]): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]);
  return {
    uLayers: { value: null },
    uResponses: { value: null },
    uSplat0: { value: null },
    uSplat1: { value: null },
    uWarp: { value: null },
    uMacro: { value: null },
    uTerrainDetail: { value: terrainDetail },

    uInvMapSize: { value: S.uInvMapSize },
    uLayerScale: { value: TERRAIN_LAYER_SCALE_DEFAULT.slice() },
    uLayerRough: { value: TERRAIN_LAYER_ROUGH_DEFAULT.slice() },

    uMacroScale: { value: S.uMacroScale },
    uMacroStrength: { value: S.uMacroStrength },
    uMacroTint: { value: v3(TERRAIN_VEC3_DEFAULTS.uMacroTint) },
    uTerrainDetailTileM: { value: TERRAIN_DETAIL_TILE_METRES },
    uTerrainDetailStrength: { value: TERRAIN_DETAIL_STRENGTH },
    uTerrainDetailRoughness: { value: TERRAIN_DETAIL_ROUGHNESS },
    uWarpScale: { value: S.uWarpScale },
    uWarpAmp: { value: S.uWarpAmp },
    uCellSize: { value: S.uCellSize },
    uCellJitter: { value: S.uCellJitter },
    uSplatSharpen: { value: S.uSplatSharpen },

    uCliffNy: { value: S.uCliffNy },
    uCliffBase: { value: v3(TERRAIN_VEC3_DEFAULTS.uCliffBase) },
    uCliffShade: { value: v3(TERRAIN_VEC3_DEFAULTS.uCliffShade) },
    uCliffHi: { value: v3(TERRAIN_VEC3_DEFAULTS.uCliffHi) },
    uCliffCap: { value: v3(TERRAIN_VEC3_DEFAULTS.uCliffCap) },
    uCliffCapM: { value: S.uCliffCapM },
    uCliffSkirtM: { value: S.uCliffSkirtM },
    uStriationM: { value: S.uStriationM },
    uCourseM: { value: S.uCourseM },
    uCourseOn: { value: S.uCourseOn },
    uCliffRelief: { value: S.uCliffRelief },
    uCliffRough: { value: S.uCliffRough },
    uCliffGrainMean: { value: S.uCliffGrainMean },
    uStepHeight: { value: S.uStepHeight },
    uFaceMix: { value: S.uFaceMix },
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
uniform sampler2DArray uResponses;
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uWarp;
uniform sampler2D uMacro;
uniform sampler2D uTerrainDetail;
uniform float uLayerScale[ 6 ];
uniform float uLayerRough[ 6 ];
uniform float uInvMapSize;
uniform float uMacroScale;
uniform float uMacroStrength;
uniform vec3  uMacroTint;
uniform float uTerrainDetailTileM;
uniform float uTerrainDetailStrength;
uniform float uTerrainDetailRoughness;
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

// Continuous terrain-space ageing. This is deliberately SHAPE, not a cloud of
// stamps: broad wind-carried dust plus sparse crooked line segments selected
// per 6.5 m cell. Nothing has a radial falloff, so the mask cannot reveal the
// circular decal footprint that the old ground stories did.
//
// x = broad dust/scuff, y = coverage-filtered crack, z = meso-scale grit.
vec3 raGroundAge( vec2 wxz, float pixelM ) {
  float broad = raValue2( wxz / 18.0 + vec2( 13.7, 4.2 ) );
  float meso = raValue2( wxz / 5.5 + vec2( 31.0, 17.0 ) );
  float dust = smoothstep( 0.36, 0.76, broad ) * ( 0.42 + meso * 0.58 );

  // Long, noise-warped wind scuffs. The two oblique axes stop the result
  // reading as world-aligned stripes while keeping it directional.
  float sweepA = abs( fract(
    ( wxz.x + wxz.y * 0.34 ) / 11.0 + ( broad - 0.5 ) * 0.82
  ) - 0.5 );
  float sweepB = abs( fract(
    ( wxz.y - wxz.x * 0.21 ) / 17.0 + ( meso - 0.5 ) * 0.55
  ) - 0.5 );
  float sweep = ( 1.0 - smoothstep( 0.06, 0.38, sweepA ) ) * 0.72
    + ( 1.0 - smoothstep( 0.05, 0.32, sweepB ) ) * 0.28;
  dust = clamp( dust * 0.84 + sweep * ( 0.06 + meso * 0.10 ), 0.0, 1.0 );

  // One crooked crack with an occasional branch in a sparse cell. Segment
  // ends are clipped by their along-distance, never by a round opacity mask.
  const float crackCellM = 4.2;
  vec2 cell = floor( wxz / crackCellM );
  vec2 local = fract( wxz / crackCellM ) - 0.5;
  float h = raHash21( cell + vec2( 7.0, 19.0 ) );
  float a = h * 6.2831853;
  vec2 dir = vec2( cos( a ), sin( a ) );
  vec2 side = vec2( - dir.y, dir.x );
  float along = dot( local, dir );
  float across = dot( local, side ) + sin( along * 17.0 + h * 8.0 ) * 0.025;
  // Coverage AA, not distance-driven opacity. The earlier whole-feature
  // multiplier changed as the camera moved and made the crack field pulse.
  // Widening only the transition by the projected pixel footprint keeps the
  // same terrain-space line anchored under the camera.
  float crackAA = clamp( pixelM / crackCellM * 0.75, 0.0015, 0.045 );
  float mainLine = ( 1.0 - smoothstep(
    0.008 - crackAA, 0.008 + crackAA, abs( across )
  ) ) * ( 1.0 - smoothstep(
    0.17 - crackAA, 0.17 + crackAA, abs( along )
  ) );

  float turn = ( step( 0.5, h ) * 2.0 - 1.0 ) * 0.88;
  vec2 branchDir = vec2( cos( a + turn ), sin( a + turn ) );
  vec2 branchSide = vec2( - branchDir.y, branchDir.x );
  vec2 branchP = local - dir * 0.04;
  float branchAlong = dot( branchP, branchDir );
  float branchAcross = dot( branchP, branchSide );
  float branch = ( 1.0 - smoothstep(
    0.007 - crackAA, 0.007 + crackAA, abs( branchAcross )
  ) ) * ( 1.0 - smoothstep(
    0.115 - crackAA, 0.115 + crackAA, abs( branchAlong )
  ) )
    * step( 0.88, raHash21( cell + vec2( 29.0, 3.0 ) ) );
  float crack = max( mainLine, branch )
    * step( 0.87, raHash21( cell + vec2( 2.0, 41.0 ) ) );

  // Aggregate is deliberately MESO-scale. The former 1.65 m threshold was a
  // sub-pixel stipple field at RTS distance and re-sampled as moving dots.
  float gritFine = raValue2( wxz / 4.8 + vec2( 9.0, 37.0 ) );
  float gritWide = raValue2( vec2( wxz.y, -wxz.x ) / 8.5 + vec2( 23.0, 6.0 ) );
  float grit = smoothstep( 0.40, 0.76, gritFine * 0.68 + gritWide * 0.32 )
    * ( 0.34 + broad * 0.46 );
  return vec3( dust, crack, grit );
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
// World metres covered by one fragment. The crack function uses this to widen
// only its coverage edge; unlike the former opacity gate, it cannot make the
// whole feature pulse as the camera moves.
// Computed before the cliff branch because derivatives in non-uniform control
// flow are undefined.
float raPixelM = max( length( raDx.xz ), length( raDy.xz ) );
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

  // 1b. SHARPEN by material family. Man-made concrete/paving keeps the crisp
  //     kerb/pad ownership it needs. Natural layers use a gentler exponent so
  //     exposing more dirt does not reveal the underlying 4 m control texels
  //     as square camouflage blocks.
  for ( int i = 0; i < 6; i ++ ) {
    float sharpen = i < 4 ? uSplatSharpen * 0.58 : uSplatSharpen;
    raW[ i ] = pow( max( raW[ i ], 0.0 ), sharpen );
  }

  float raSum = raW[0] + raW[1] + raW[2] + raW[3] + raW[4] + raW[5];
  float raNorm = 1.0 / max( raSum, 1e-6 );

  // Material ownership for ageing. Grass/snow remains comparatively clean;
  // bare earth, sand, rock and poured concrete carry most of the history.
  float raDustable = clamp((
    raW[0] * 0.62 + raW[1] + raW[2] * 0.86 +
    raW[3] * 0.38 + raW[4] * 0.24 + raW[5] * 0.10
  ) * raNorm, 0.0, 1.0 );
  float raCrackable = clamp((
    raW[0] * 0.38 + raW[1] + raW[2] * 0.82 + raW[3] * 0.46 +
    raW[4] * 0.52 + raW[5] * 0.18
  ) * raNorm, 0.0, 1.0 );

  vec3 raAlbedo = vec3( 0.0 );
  float raR = 0.0;
  vec2 raNxy = vec2( 0.0 );
  float raCavity = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    float w = raW[ i ] * raNorm;
    raAlbedo += texture( uLayers, vec3( raXZ / uLayerScale[ i ], float( i ) ) ).rgb * w;
    vec4 response = texture( uResponses,
      vec3( raXZ / uLayerScale[ i ], float( i ) ) );
    raNxy += ( response.rg * 2.0 - 1.0 ) * w;
    raR += clamp( uLayerRough[ i ] + ( response.b - 0.5 ) * 0.5,
      0.55, 1.0 ) * w;
    raCavity += response.a * w;
  }

  // The response tiles describe material structure; this broad world-space
  // term stops their specular response revealing the repeat at long range.
  float raRoughMacro = raValue2( raXZ / 14.0 + vec2( 17.0, 43.0 ) );
  raR = clamp( raR + ( raRoughMacro - 0.5 ) * 0.045, 0.55, 1.0 );
  raShadeN = normalize( raSmoothN + vec3( raNxy.x, 0.0, raNxy.y ) * 0.52 );
  raAlbedo *= mix( 0.965, 1.0, raCavity );

  // 2. Regional breakup.
  raAlbedo = raMacro( raAlbedo, raXZ );

  // 2a. Supplied tileable detail, owned by NATURAL splat layers only. Roads,
  // sidewalks and other hard surfaces are layers 4/5, so their normalized
  // contribution converges to exactly zero instead of relying on overdraw.
  float raNatural = clamp(
    ( raW[0] + raW[1] + raW[2] + raW[3] ) * raNorm, 0.0, 1.0 );
  float raTerrainDetail = texture2D(
    uTerrainDetail, raXZ / uTerrainDetailTileM ).r;
  raAlbedo *= 1.0 + ( raTerrainDetail - 0.5 )
    * uTerrainDetailStrength * raNatural;
  raR = clamp( raR + ( 0.5 - raTerrainDetail )
    * uTerrainDetailRoughness * raNatural, 0.55, 1.0 );

  // 2b. Material history. The warm multiply preserves each biome's authored
  // hue while letting dust gather in broad directional sheets. Cracks are
  // sparse line segments with cavity-darkening and a roughness response; no
  // geometry, draw call, sampler or circular decal is added.
  vec3 raAge = raGroundAge( raXZ, raPixelM );
  float raDust = raAge.x * raDustable;
  float raCrack = raAge.y * raCrackable;
  float raGrit = raAge.z * max( raDustable, raCrackable * 0.6 );
  raAlbedo *= 1.0 + ( raAge.x - 0.5 ) * 0.11 * raDustable;
  raAlbedo *= mix( vec3( 1.0 ), vec3( 0.84, 0.72, 0.58 ), raDust * 0.34 );
  raAlbedo *= 1.0 - raCrack * 0.30 - raGrit * 0.11;
  raR = clamp( raR + raDust * 0.040 + raCrack * 0.075 + raGrit * 0.030, 0.55, 1.0 );

  // 3. Build-cell-scale variation, smoothly interpolated. A hard hash here was
  //    invisible while the surface was nearly uniform, then became a literal
  //    checkerboard as soon as dirt coverage increased. Keep the authored 4 m
  //    scale, lose the square boundary.
  float raCell = raValue2( raXZ / uCellSize + vec2( 0.5 ) );
  float raCellTail = smoothstep( 0.88, 0.98, raCell );
  raAlbedo *= 1.0 + ( raCell - 0.5 ) * 2.0 * uCellJitter
    - raCellTail * uCellJitter * 0.45;

  raCol = raAlbedo;
  raRough = raR;

}

diffuseColor.rgb *= max( raCol, vec3( 0.0 ) );
`;

/** Swap in the authored surface normal after three has built the shading normal. */
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
if ( raIsCliff ) {
  normal = normalize( mix( normal,
    normalize( ( viewMatrix * vec4( raShadeN, 0.0 ) ).xyz ), uFaceMix ) );
} else {
  normal = normalize( ( viewMatrix * vec4( raShadeN, 0.0 ) ).xyz );
}
`;

/* ==========================================================================
 * 3. PROCEDURAL SUPPORT TEXTURES — GENERATED ELSEWHERE
 *
 * Every tile this material samples is built by `./terrain-texture-gen.ts`. What
 * is left in this file is the handful of `DataTexture` / `DataArrayTexture`
 * setup lines around each one, because those are the part that needs a renderer
 * and therefore the part a worker cannot do.
 *
 * THEY MOVED BECAUSE THEY WERE THE BOOT. Measured on `08-naval-water`,
 * `createTerrainMaterials` was 350-435 ms of main-thread time and the six layer
 * tiles were essentially all of it — the largest single main-thread cost left in
 * the product once `terrain-gen.ts` had taken the heightfield and the chunk
 * vertices off. See that file's header for the transfer argument.
 *
 * THE RE-EXPORTS ARE NOT TIDINESS. `tests/terrain-frequency.spec.ts` and
 * `tests/terrain-surfaces.spec.ts` import `buildFieldSurface`, `mesoField`,
 * `mesoWaveSet`, the `MESO_*` constants and the `FIELD_*` caps from THIS module,
 * and those two specs are the entire safety argument for the mesoscale band —
 * the DFT that proves there is no energy above the declared cutoff, and the
 * noise budget that proves the tiles are not sandpaper. Keeping the names here
 * means the split was invisible to both, so neither had to be rewritten to
 * accommodate a refactor. A guard rewritten to fit the change it is guarding is
 * a guard that has stopped guarding.
 * ========================================================================== */

export {
  FIELD_DRIFT_CAP, FIELD_PATCH_CAP, FIELD_MIN_WAVELENGTH,
  MESO_MIN_SCREEN_PX, MESO_MIN_METRES, MESO_MIN_TEXELS,
  MESO_FINE_METRES, MESO_WIDE_METRES, MESO_WIDE_ORDER,
  MESO_FINE_WEIGHT, MESO_WIDE_WEIGHT, MESO_PULL_GAIN, MESO_PULL_MAX,
  WARP_N, MACRO_N,
  buildFieldSurface, buildLayerSurface, buildLayerArrayBytes,
  buildLayerResponseArrayBytes,
  buildWarpBytes, buildMacroBytes,
  mesoWaveSet, mesoCycles, mesoWavelengthMetres, mesoFieldRow, mesoField, mesoPull,
  generateTerrainTextures, terrainTextureKey, terrainTextureTransfers,
  warpSeed, macroSeed,
} from './terrain-texture-gen';
export type { TerrainTextureData } from './terrain-texture-gen';

/**
 * Wrap the warp bytes.
 *
 * Mipmaps are on deliberately: a warp that aliases at distance is a boundary
 * that crawls when the camera pans.
 */
function warpTexture(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    data, WARP_N, WARP_N, THREE.RGBAFormat, THREE.UnsignedByteType,
  );
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

/** Wrap the macro bytes. */
function macroTexture(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    data, MACRO_N, MACRO_N, THREE.RGBAFormat, THREE.UnsignedByteType,
  );
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
 * Wrap six packed layers as one `sampler2DArray`.
 *
 * Setting `colorSpace = SRGBColorSpace` gets the GPU's own SRGB8_ALPHA8 decode
 * for free — doing the pow(2.2) in the shader instead would cost six of them
 * per fragment.
 *
 * `data` is used AS-IS with no copy. When it came from a worker the buffer was
 * transferred, so it is ours to own; when it came from `buildLayerArrayBytes`
 * on this thread it was freshly allocated. Neither is shared.
 */
function layerArrayTexture(
  data: Uint8Array, size: number, biomeKey: string,
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, SURFACE_COUNT);
  tex.name = `terrain.layers.${biomeKey}`;
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

/** Linear material-response twin of `layerArrayTexture`. */
function responseArrayTexture(
  data: Uint8Array, size: number, biomeKey: string,
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, SURFACE_COUNT);
  tex.name = `terrain.responses.${biomeKey}`;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Pack all six biome layers into one `sampler2DArray`.
 *
 * Kept as a named export because `tests/terrain-surfaces.spec.ts` builds one
 * directly to assert the layer count and the array dimensions.
 */
export function buildLayerArrayTexture(biome: BiomeDef, size: number): THREE.DataArrayTexture {
  return layerArrayTexture(buildLayerArrayBytes(biome, size), size, biome.key);
}


/* ==========================================================================
 * 4. THE MATERIAL
 * ========================================================================== */

export interface TerrainMaterialSet {
  /** The one terrain program. Ground and cliff both live in here. */
  readonly material: THREE.MeshStandardMaterial;
  /** Live uniform block; mutate values, never replace the object. */
  readonly uniforms: TerrainUniforms;
  /**
   * True when the tiles came from `options.textures` rather than being built
   * here. For the boot log only — nothing branches on it.
   */
  readonly texturesAdopted: boolean;
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
  /**
   * Tiles generated somewhere else — normally by the boot-time worker in
   * `src/core/workers/world-warm.ts`.
   *
   * ADOPTED ONLY ON AN EXACT KEY MATCH, and only for the FIRST `applyBiome`.
   * A later biome swap from the console rebuilds on this thread by design: a
   * prewarm is for the biome this boot was planned around, and a mid-match
   * pop-in three frames after the swap is worse than the hitch the player asked
   * for. A miss is not an error — it falls through to generating here, which is
   * what this function did before the worker existed.
   */
  textures?: TerrainTextureData | null;
}

export function createTerrainMaterials(options: CreateTerrainMaterialOptions): TerrainMaterialSet {
  const terrainDetail = createTerrainDetailMask();
  const uniforms = createUniforms(terrainDetail);

  /*
   * The biome sink. Every field is a live reference into `uniforms`, so
   * `applyTerrainBiome` mutates the same slots the old inline `applyBiome` did
   * — including the two ARRAYS, which are handed over bare because TSL's
   * `uniformArray` keeps its array somewhere else and the shared applier must
   * not care which.
   */
  const biomeSink: TerrainBiomeSink = {
    layerScale: uniforms.uLayerScale.value,
    layerRough: uniforms.uLayerRough.value,
    uMacroScale: uniforms.uMacroScale,
    uMacroStrength: uniforms.uMacroStrength,
    uMacroTint: uniforms.uMacroTint,
    uWarpScale: uniforms.uWarpScale,
    uWarpAmp: uniforms.uWarpAmp,
    uCellJitter: uniforms.uCellJitter,
    uCliffBase: uniforms.uCliffBase,
    uCliffShade: uniforms.uCliffShade,
    uCliffHi: uniforms.uCliffHi,
    uCliffCap: uniforms.uCliffCap,
    uCliffCapM: uniforms.uCliffCapM,
    uCliffSkirtM: uniforms.uCliffSkirtM,
    uStriationM: uniforms.uStriationM,
    uCourseM: uniforms.uCourseM,
    uCourseOn: uniforms.uCourseOn,
    uCliffRelief: uniforms.uCliffRelief,
    uCliffRough: uniforms.uCliffRough,
    uCliffGrainMean: uniforms.uCliffGrainMean,
    uStepHeight: uniforms.uStepHeight,
  };

  /*
   * ADOPT OR GENERATE — and the key comparison is what makes that safe.
   *
   * `terrainTextureKey` is the ONE definition of "these bytes describe this
   * material", and both this call and the worker's use it, so a mismatch cannot
   * be papered over by two comments that agree. The lengths are checked too:
   * a `layers` buffer one byte short is not an exception, it is a
   * `DataArrayTexture` reading past the end of a GPU upload, which renders as a
   * black frame and reports nothing. That specific failure is why this repo has
   * a rule about NaN propagating into a black frame.
   */
  const layerSize = options.layerTextureSize;
  const pre = options.textures ?? null;
  const adopted = pre !== null
    && pre.key === terrainTextureKey(options.biome.key, layerSize, options.seed)
    && pre.layerSize === layerSize
    && pre.layers.length === layerSize * layerSize * 4 * SURFACE_COUNT
    && pre.responses instanceof Uint8Array
    && pre.responses.length === layerSize * layerSize * 4 * SURFACE_COUNT
    && pre.warp.length === WARP_N * WARP_N * 4
    && pre.macro.length === MACRO_N * MACRO_N * 4;

  const warp = warpTexture(
    adopted && pre !== null ? pre.warp : buildWarpBytes(warpSeed(options.seed)),
  );
  const macro = macroTexture(
    adopted && pre !== null ? pre.macro : buildMacroBytes(macroSeed(options.seed)),
  );
  uniforms.uWarp.value = warp;
  uniforms.uMacro.value = macro;

  /*
   * The prewarmed LAYER bytes, held for exactly one `applyBiome` call.
   *
   * `applyBiome` is called once from here with `options.biome` and then again
   * from the console on every `?biome=` swap. Only the first can legitimately
   * use these bytes — they were generated for that biome — so the reference is
   * cleared on the way past rather than re-checked, which also means the buffer
   * is not held alive for the whole match.
   */
  let pendingLayers: Uint8Array | null = adopted && pre !== null ? pre.layers : null;
  let pendingResponses: Uint8Array | null = adopted && pre !== null ? pre.responses : null;

  let layers: THREE.DataArrayTexture | null = null;
  let responses: THREE.DataArrayTexture | null = null;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    // The splat supplies roughness per layer; this is only the fallback before
    // `roughnessmap_fragment` is replaced.
    roughness: 0.92,
    metalness: 0.0,
    /*
     * THERE IS DELIBERATELY NO `envMapIntensity` HERE, AND IT IS NOT AN
     * OVERSIGHT — IT WAS MEASURED. Setting it does nothing on this material.
     *
     * the visual gap plan P0-3 asked for `envMapIntensity: 0.35` (bible, the `TERRAIN` material preset)
     * on the grounds that the unset default of 1.0 was admitting a flat ambient
     * over 60-75% of the frame. The premise is half right and the lever is
     * wrong. Measured on a booted page, whole-frame per-pixel diff, with
     * `needsUpdate` forced so the uniform really was pushed:
     *
     *     material.envMapIntensity  0 -> 8    0 pixels changed, max delta 0
     *     scene.environmentIntensity 0 -> 6   110 525 / 110 526 terrain px, max 254
     *     CONTROL: terrain.color -> green     30.78% of frame, max delta 234
     *
     * So terrain IS strongly environment-lit, and the ONLY live control is
     * `LIGHTING.envIntensity` via `scene.environmentIntensity` (renderer sets it
     * in `scene.ts`), which is global. The per-material multiplier never reaches
     * the pixels — `USE_ENVMAP` is defined and `getIBLIrradiance` is called, so
     * it is not a missing feature; something in this material's custom program
     * path is not taking the uniform.
     *
     * Adding the line anyway would have shipped a dead knob that reads
     * authoritative — the exact defect `SURFACES` in config.ts already is, and
     * the trap RENDER_FINDINGS.md §5 and §7 are both about. If you want the
     * bible's 0.35 for the ground specifically, it has to be scaled inside this
     * file's own injected GLSL (and `customProgramCacheKey` bumped), not
     * declared on the material. See RENDER_FINDINGS.md §6c.
     */
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
  material.customProgramCacheKey = () => 'ra-terrain-v5';

  function applyBiome(biome: BiomeDef): void {
    applyTerrainBiome(biome, biomeSink);

    // The layer array is the only thing a biome swap must actually rebuild.
    // `pendingLayers` is non-null only on the first pass, and only when the
    // prewarm's key named this exact biome.
    const bytes = pendingLayers ?? buildLayerArrayBytes(biome, layerSize);
    const responseBytes = pendingResponses ?? buildLayerResponseArrayBytes(biome, layerSize);
    pendingLayers = null;
    pendingResponses = null;
    const next = layerArrayTexture(bytes, layerSize, biome.key);
    const nextResponses = responseArrayTexture(responseBytes, layerSize, biome.key);
    const prev = layers;
    const prevResponses = responses;
    layers = next;
    responses = nextResponses;
    uniforms.uLayers.value = next;
    uniforms.uResponses.value = nextResponses;
    prev?.dispose();
    prevResponses?.dispose();
  }

  applyBiome(options.biome);

  return {
    material,
    uniforms,
    texturesAdopted: adopted,

    setSplat(a: THREE.DataTexture, b: THREE.DataTexture): void {
      uniforms.uSplat0.value = a;
      uniforms.uSplat1.value = b;
    },

    applyBiome,

    setAnisotropy(a: number): void {
      terrainDetail.anisotropy = a;
      terrainDetail.needsUpdate = true;
      if (layers) {
        layers.anisotropy = a;
        layers.needsUpdate = true;
      }
      if (responses) {
        responses.anisotropy = a;
        responses.needsUpdate = true;
      }
    },

    dispose(): void {
      material.dispose();
      warp.dispose();
      macro.dispose();
      layers?.dispose();
      responses?.dispose();
      layers = null;
      responses = null;
    },
  };
}

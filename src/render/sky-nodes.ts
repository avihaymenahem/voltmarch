/**
 * ============================================================================
 * VOLTMARCH — src/render/sky-nodes.ts
 * ============================================================================
 * THE SKY DOME, AS A TSL NODE GRAPH. Stage F of
 * `docs/WEBGPU_MIGRATION_PLAN.md`.
 *
 * `scene.ts`'s `createSkyMaterial` is the shipping WebGL twin: a raw
 * `ShaderMaterial` with nine uniforms, one `vDir` varying, and a fragment that
 * is a vertical gradient, a horizon haze band, forward scattering, the sun disk
 * and a 1/512 dither. Read the two side by side.
 *
 * ── WHY THIS FILE EXISTS AT ALL, WHEN STAGES B..E SAID "EVERY MATERIAL" ─────
 * The stage inventory counted `onBeforeCompile` sites and raw `ShaderMaterial`s
 * that carry game shading. The sky is neither: it is a `ShaderMaterial` that
 * nothing injects into, in `src/render/scene.ts`, and it fell between the two
 * lists. **`ShaderMaterial` IS NOT IN `StandardNodeLibrary`** — the registry maps
 * Basic, Lambert, Phong, Standard, Physical, Toon, Normal, Matcap, the two Line
 * kinds, Points, Sprite and Shadow, and nothing else — so under
 * `WebGPURenderer` it does not fall back to
 * GLSL, it fails `NodeBuilder: Material "ShaderMaterial" is not compatible` and
 * draws through a bare `NodeMaterial`. On a dome that fills every pixel the
 * camera does not hit ground with, that is the whole background.
 *
 * ── THE THREE TRANSCRIPTION DECISIONS ───────────────────────────────────────
 * 1. **`gl_Position.z = gl_Position.w` has no node equivalent**, and it does not
 *    need one. It pins the dome to the far plane so nothing can clip it; the dome
 *    is already scaled to `camera.far * 0.9` and drawn at `RENDER_ORDER.SKY` with
 *    `depthWrite: false`, so the pin is belt-and-braces on the WebGL path and its
 *    absence changes no pixel here. Recorded rather than silently dropped.
 * 2. **`normalize(position)` is `positionGeometry`, not `positionLocal`.** The
 *    dome carries no displacement, so the two are equal today — but
 *    `positionLocal` is whatever the last edit left, and reading the geometry
 *    attribute says what the GLSL says.
 * 3. **The dither hash stays a hash.** `fract(sin(dot(p, k)) * 43758.5453)` at
 *    `gl_FragCoord` is screen-space and stable frame to frame, which is what
 *    keeps it a dither rather than the film grain `RA3_LOOK_BIBLE.md` §11 bans.
 *    `screenCoordinate.xy` is the same quantity on both backends — the identical
 *    substitution `shroud-nodes.ts` §6 makes for the carpet's Bayer.
 *
 * NO `.setLayout()` ANYWHERE IN THIS FILE. Every helper here would read a
 * module-scope uniform, and a layout emits a real WGSL function that can see
 * nothing but its parameters — the class of failure that cost Stage D four
 * helpers and did not fail `WGSLNodeBuilder.build()` once. See
 * `StructureNodeMaterial.STAGE_D_TSL_GAPS` #6.
 * ============================================================================
 */

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Fn, clamp, dot, exp, float, fract, max, mix, normalize, positionGeometry, pow,
  screenCoordinate, sin, smoothstep, uniform, vec2, vec3, vec4, varyingProperty,
} from 'three/tsl';

import type { SkyUniformSinkLike } from './gpu-path';

type Vec4N = Node<'vec4'>;

/** The view direction, named to match the GLSL's `vDir`. */
const vDir = varyingProperty('vec3', 'vDir');

export interface SkyNodeMaterialSet {
  readonly material: NodeMaterial;
  /**
   * `{ value }` slots in the SAME shape the GLSL uniforms block has, so
   * `scene.ts#syncSkyUniforms` writes one code path for both renderers.
   *
   * They are the TSL uniform nodes' own `.value` slots, reached through the node
   * — assigning `uniforms.uSunSize.value = x` writes the node. That is why this
   * returns the nodes rather than a mirror: a mirror would need a per-frame copy,
   * and unlike `shroud-nodes.ts` there is no shipping singleton here to pull
   * from. `scene.ts` owns this block outright.
   */
  readonly uniforms: SkyUniformSinkLike;
  dispose(): void;
}

/**
 * THE NODE-PATH TWIN OF `scene.ts#createSkyMaterial`.
 *
 * Same nine uniforms, same names, same defaults.
 */
export function createSkyNodeMaterial(): SkyNodeMaterialSet {
  const uZenith = uniform(new THREE.Vector3());
  const uHorizon = uniform(new THREE.Vector3());
  const uGround = uniform(new THREE.Vector3());
  const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const uSunColor = uniform(new THREE.Vector3(1, 1, 1));
  const uSunSize = uniform(Math.cos(THREE.MathUtils.degToRad(0.3)));
  const uSunIntensity = uniform(12);
  const uHazeWidth = uniform(0.14);
  const uExposure = uniform(1);

  const material = new (class SkyStandardNodeMaterial extends NodeMaterial {
    override setupPosition(builder: Parameters<NodeMaterial['setupPosition']>[0]): Node {
      const position = super.setupPosition(builder) as Node;
      // Publish AFTER super, exactly as `shroud-nodes.ts#shroudVertexUv` is
      // called, so the varying is written at a point in the emitted vertex
      // stage where its right-hand side is already assigned. A `varying()`
      // wrapped around a module-scope `toVar` emits where the node RESOLVES,
      // not where the var was last written — the Stage E defect that shipped
      // two VFX varyings as (0, 0) and compiled clean on both backends.
      vDir.assign(normalize(positionGeometry));
      return position;
    }
  })();
  material.name = 'SkyDomeNode';

  const skyColour = Fn(() => {
    const d = normalize(vDir).toVar('skyD');
    const up = d.y.toVar('skyUp');

    // --- vertical gradient -------------------------------------------------
    const t = clamp(up, 0.0, 1.0).toVar('skyT');
    const sky = mix(uHorizon, uZenith, pow(t, 0.55)).toVar('skySky');

    // Below the horizon: fade to the ground bounce colour.
    const b = clamp(up.negate().div(0.35), 0.0, 1.0).toVar('skyB');
    const col = mix(sky, uGround, smoothstep(0.0, 1.0, b)).toVar('skyCol');

    // --- horizon haze band -------------------------------------------------
    const haze = exp(up.abs().negate().div(max(uHazeWidth, float(1e-3)))).toVar('skyHaze');
    col.assign(mix(col, uHorizon.mul(1.06), haze.mul(0.55)));

    // --- forward scattering toward the sun ---------------------------------
    const cosSun = dot(d, uSunDir).toVar('skyCosSun');
    const glow = pow(max(cosSun, float(0.0)), 8.0).toVar('skyGlow');
    col.addAssign(uSunColor.mul(glow).mul(0.16));
    col.addAssign(uSunColor.mul(pow(max(cosSun, float(0.0)), 2.0)).mul(haze).mul(0.25));

    // --- the sun disk itself -----------------------------------------------
    // ASCENDING: `uSunSize` -> `uSunSize + 0.0016`, as the GLSL wrote it. A
    // descending `smoothstep` is merely unspecified in GLSL and UNDEFINED in
    // WGSL (`WATER_TSL_GAPS` #2, which found one acting as accidental fog).
    const disk = smoothstep(uSunSize, uSunSize.add(0.0016), cosSun).toVar('skyDisk');
    col.addAssign(uSunColor.mul(disk).mul(uSunIntensity));

    col.mulAssign(uExposure);

    // 1/512 dither in linear space. `gl_FragCoord.xy` -> `screenCoordinate.xy`.
    const p = screenCoordinate.xy.toVar('skyP');
    const noise = fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453)).toVar('skyNoise');
    col.addAssign(noise.sub(0.5).mul(1.0 / 512.0));

    return vec4(max(col, vec3(0.0)), 1.0);
  });

  material.fragmentNode = skyColour() as unknown as Vec4N;
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.depthTest = true;
  material.fog = false;
  // Grading happens in post; the sky writes raw HDR. Same on both paths.
  material.toneMapped = false;

  return {
    material,
    uniforms: {
      uZenith, uHorizon, uGround, uSunDir, uSunColor,
      uSunSize, uSunIntensity, uHazeWidth, uExposure,
    },
    dispose(): void {
      material.dispose();
    },
  };
}

/**
 * ============================================================================
 * THE SHADOW A STRUCTURE ACTUALLY CASTS, AND THE PAD THAT MUST NOT OCCLUDE.
 * ============================================================================
 *
 * Three things are pinned here. All three are cross-file contracts with nothing
 * between the two ends but a field name, which is the arrangement this
 * repository has watched rot twice.
 *
 * 1. THE SHADOW PASS RUNS A DIFFERENT PROGRAM. three fills a shadow map with
 *    its own shared `MeshDepthMaterial`, which never runs the colour material's
 *    `onBeforeCompile`. `applyStructureShader` sinks a rising structure below
 *    the ground plane and discards what is left underneath; without a
 *    `customDepthMaterial` doing the SAME arithmetic, a half-built structure
 *    casts its FINISHED silhouette, and at `buildProgress === 0` — where the
 *    colour pass rasterises nothing at all — the frame shows a full, sharp
 *    shadow of a building with only a pad beneath it.
 *
 * 2. THE BATCHER IS THE ONLY HOOK. `BatchPartSpec.customDepthMaterial` and
 *    `aoOccluder` exist because the InstancedMesh belongs to `InstanceBatch`
 *    and no art module can reach it.
 *
 * 3. `aoOccluder: false` IS STRICT. `userData` is empty on almost every mesh in
 *    the game; a truthiness test would take all of them out of the GTAO normal
 *    prepass, which is AO off, arrived at by accident.
 *    `tests/ao-occluder-filter.spec.ts` pins the CONSUMER of that contract in
 *    `src/render/post.ts`; this pins the producers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { InstanceBatch, type BatchPartSpec } from '../src/render/InstanceBatcher';
import { buildingLibrary, createStructureDepthMaterial } from '../src/art/BuildingFactory';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Prose must not be able to satisfy an assertion about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SCENE_CODE = stripComments(read('src/render/scene.ts'));
const BUILDINGS_CODE = stripComments(read('src/art/buildings.system.ts'));

/* -------------------------------------------------------------------------- */

/**
 * The two chunk markers three's own depth vertex shader carries, plus the two
 * the fragment shader carries. Injecting against anything else is injecting
 * against a shader that does not exist.
 */
const DEPTH_VERT = '#include <common>\nvoid main() {\n#include <begin_vertex>\n}';
const DEPTH_FRAG = '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}';

type OnBeforeCompile = NonNullable<THREE.Material['onBeforeCompile']>;
type ShaderArg = Parameters<OnBeforeCompile>[0];

/**
 * Run a material's injector the way three does, and hand back the sources.
 * The renderer argument is never touched by any injector in this file.
 */
function compile(mat: THREE.Material): { vert: string; frag: string; uniforms: Record<string, unknown> } {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
  };
  mat.onBeforeCompile(
    shader as unknown as ShaderArg,
    null as unknown as THREE.WebGLRenderer,
  );
  return { vert: shader.vertexShader, frag: shader.fragmentShader, uniforms: shader.uniforms };
}

describe('the structure depth material', () => {
  it('is a MeshDepthMaterial with its own program cache key', () => {
    const mat = createStructureDepthMaterial();
    expect(mat.isMeshDepthMaterial).toBe(true);
    // Without a key of its own, three serves it the program it built for its
    // OWN stock depth material and the injection is silently a no-op.
    expect(mat.customProgramCacheKey()).toBe('ra3.structure.depth.v1');
    mat.dispose();
  });

  it('leaves depth packing at the MeshDepthMaterial default', () => {
    /*
     * `PropLibrary` asks for RGBADepthPacking and this deliberately does not.
     * In three 0.185 a directional light's shadow map is a real `DepthTexture`
     * (WebGLShadowMap builds `shadow.map.depthTexture` and the sampler reads
     * the depth attachment), so the fragment COLOUR is never looked at and
     * packing it is a `packDepthToRGBA` per fragment for nothing.
     */
    const mat = createStructureDepthMaterial();
    expect(mat.depthPacking).toBe(THREE.BasicDepthPacking);
    mat.dispose();
  });

  it('reads the same two attributes the colour pass reads', () => {
    const mat = createStructureDepthMaterial();
    const { vert } = compile(mat);
    // `aState` is the batcher's per-instance channel; `aFeature` rides along on
    // the source geometry. A depth program that declares neither compiles fine
    // and draws the finished building.
    expect(vert).toContain('attribute vec4 aState;');
    expect(vert).toContain('attribute vec4 aFeature;');
    mat.dispose();
  });

  it('sinks the structure and cuts it at the ground plane', () => {
    const mat = createStructureDepthMaterial();
    const { vert, frag, uniforms } = compile(mat);
    expect(vert).toContain('raSink = (1.0 - bp) * aFeature.y * rises;');
    expect(vert).toContain('transformed.y -= raSink + raDoor;');
    expect(frag).toContain('if (vRaClip < 0.0) discard;');
    // The door and the radar sweep move the silhouette too, so the shadow has
    // to follow them or a bay door casts through its own opening.
    expect(vert).toContain('raDoor = isDoor * aFeature.z * open;');
    expect(vert).toContain('mat2(raSpinC, raSpinS, -raSpinS, raSpinC)');
    // Same clock as the colour pass, or the two disagree about door phase.
    expect(uniforms.uTime).toBeDefined();
    mat.dispose();
  });

  it('injects only into chunks three actually emits', () => {
    // The depth vertex shader has NO `<beginnormal_vertex>` outside
    // USE_DISPLACEMENTMAP, so a copy of the colour shader's split injection
    // would silently drop half of itself.
    const mat = createStructureDepthMaterial();
    const { vert } = compile(mat);
    expect(vert).not.toContain('beginnormal_vertex');
    // The solve has to land AFTER `transformed` exists, i.e. inside the
    // `<begin_vertex>` replacement — `raSink = 0.0` in the pars block is the
    // declaration, not the solve, so match the solve's own right-hand side.
    expect(vert.indexOf('raSink = (1.0 - bp)'))
      .toBeGreaterThan(vert.indexOf('#include <begin_vertex>'));
    mat.dispose();
  });

  it('is one shared instance per library, not one per structure', () => {
    // 24 structures must not mean 24 materials and 24 programs. It reads only
    // `aState` and `aFeature`, so nothing about a faction can change it.
    const a = buildingLibrary.depthMaterial();
    const b = buildingLibrary.depthMaterial();
    expect(a).toBe(b);
  });
});

/* -------------------------------------------------------------------------- */

describe('the colour and depth programs share one copy of the maths', () => {
  const SRC = read('src/art/BuildingFactory.ts');

  it('injects the same named snippets into both', () => {
    // Two copies of this arithmetic is exactly how the shadow and the building
    // come apart again. Each program chooses only WHERE to inject.
    for (const snippet of [
      'STRUCTURE_ANIM_PARS', 'STRUCTURE_ANIM_SOLVE',
      'STRUCTURE_ANIM_APPLY', 'STRUCTURE_CLIP_FRAGMENT',
    ]) {
      const uses = SRC.split(`\${${snippet}}`).length - 1;
      expect(uses, `${snippet} must be injected by both programs`).toBeGreaterThanOrEqual(2);
    }
  });

  it('bumps the colour cache key whenever that source moves', () => {
    // v1 -> v2 was the shroud tint; v2 -> v3 the move to shared snippets;
    // v3 -> v4 the move of every animation NUMBER into `art/structure-anim.ts`,
    // shared with the TSL port in `art/StructureNodeMaterial.ts`. Every value is
    // identical and prints as the literal it replaced, but constants that used
    // to be typed inline are interpolated now, so the SOURCE changed again.
    // v5 adds the structure-only silhouette response and gives pads their own
    // program key, because a pad is ground and must not inherit the lift.
    //
    // Three keys its program cache on this string, so a changed source under an
    // unchanged key is served the OLD program. THIS ASSERTION IS MEANT TO NEED
    // EDITING: a pin somebody has to consciously move is the mechanism, and a
    // regex over the version number would quietly accept never bumping it.
    expect(stripComments(SRC)).toContain("'ra3.structure.rim.v5'");
  });
});

/* -------------------------------------------------------------------------- */

describe('buildings.system hands the batcher what it needs', () => {
  it('gives the body and the turret the depth material', () => {
    // The pad is exempt because it never casts; everything else does, and
    // everything else sinks.
    expect(BUILDINGS_CODE).toContain('buildingLibrary.depthMaterial()');
    expect(BUILDINGS_CODE.split('customDepthMaterial: depth').length - 1)
      .toBeGreaterThanOrEqual(2);
  });

  it('takes the pad out of the AO prepass', () => {
    // 40 mm of slab that GTAO's normal prepass read as a wall a few centimetres
    // above the ground — and paid a second draw per pad-bearing model to say so.
    expect(BUILDINGS_CODE).toContain('aoOccluder: false');
  });
});

/* -------------------------------------------------------------------------- */

describe('InstanceBatch carries both flags onto the mesh', () => {
  function spec(extra: Partial<BatchPartSpec>): BatchPartSpec {
    return { geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), ...extra };
  }

  it('assigns a custom depth material when one is given', () => {
    const depth = createStructureDepthMaterial();
    const batch = new InstanceBatch([spec({ customDepthMaterial: depth })], 'test');
    expect(batch.parts[0].mesh.customDepthMaterial).toBe(depth);
    batch.dispose();
    depth.dispose();
  });

  it('leaves the property absent when none is given', () => {
    // three tests `customMaterial !== undefined`; leaving it unset keeps every
    // other model in the game on the shared fast path.
    const batch = new InstanceBatch([spec({})], 'test');
    expect(batch.parts[0].mesh.customDepthMaterial).toBeUndefined();
    batch.dispose();
  });

  it('stamps vmAoOccluder ONLY for an explicit false', () => {
    const off = new InstanceBatch([spec({ aoOccluder: false })], 'test');
    expect(off.parts[0].mesh.userData.vmAoOccluder).toBe(false);
    off.dispose();

    for (const value of [undefined, true] as const) {
      const on = new InstanceBatch([spec({ aoOccluder: value })], 'test');
      expect(on.parts[0].mesh.userData.vmAoOccluder,
        `aoOccluder: ${String(value)} must leave the mesh in the prepass`).toBeUndefined();
      on.dispose();
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('fitShadow fits the depth slab to the content, not to the world origin', () => {
  /*
   * The bug: `near`/`far` were `1` and `250 + (maxZ - minZ) + 60`, a slab
   * centred on the world origin. A point's depth in the shadow view is
   * `SHADOW_STANDOFF - dot(p, sunDir)`, and across a 512 m map with the noon
   * sun `dot(p, sunDir)` sweeps about -300..+270 — so the far plane covered the
   * fitted quad only while `maxZ >= -60`. Re-simulated over a 4 m focus grid at
   * 8 yaws, that lost the sun shadow ENTIRELY at 22.5% / 12.1% / 1.1% of focus
   * positions at camera distance 30 / 62 / 140.
   *
   * There is no way to drive `fitShadow` in node — `createScene` needs a real
   * `WebGLRenderer` for the PMREM bake — so what is pinned is the SHAPE of the
   * fix, which is what a future edit would undo.
   */
  it('derives near from maxZ and far from minZ', () => {
    expect(SCENE_CODE).toMatch(/nearRaw\s*=\s*SHADOW_STANDOFF - maxZ - /);
    expect(SCENE_CODE).toMatch(/farRaw\s*=\s*SHADOW_STANDOFF - minZ \+ /);
    expect(SCENE_CODE, 'the near plane must not go back to a literal')
      .not.toMatch(/shadowCam\.near = 1;\s*\n\s*shadowCam\.far = Math\.max\(300/);
  });

  it('keeps the light pinned along its own forward axis', () => {
    // Moving the light along `sunDir` cannot change texel alignment, but it
    // leaves `sun.position` drifting sub-millimetre per frame and makes "is the
    // shadow rig stable?" impossible to assert. The DEPTH RANGE moves instead.
    expect(SCENE_CODE).toMatch(/const cz = 0;/);
  });

  it('quantises the slab so the metric size of the bias holds still', () => {
    // three adds `shadowBias` to a post-divide [0,1] coordinate, so the bias is
    // a fraction of (far - near). An unquantised slab wobbles it every frame,
    // which is peter-panning that breathes. Floor/ceil, so quantising can only
    // widen the slab and never clip content out of it.
    expect(SCENE_CODE).toMatch(/shadowCam\.near = Math\.floor\(nearRaw \/ SHADOW_EXTENT_STEP\)/);
    expect(SCENE_CODE).toMatch(/shadowCam\.far = Math\.ceil\(farRaw \/ SHADOW_EXTENT_STEP\)/);
  });

  it('writes the light standoff once, as a name', () => {
    // It was the bare literal 250 in two places — `sun.position` and the `far`
    // expression — which is how the two came apart in the first place.
    const standoffs = SCENE_CODE.split('SHADOW_STANDOFF').length - 1;
    expect(standoffs).toBeGreaterThanOrEqual(4);
    expect(SCENE_CODE, 'no bare 250 may remain in the shadow fit')
      .not.toMatch(/addScaledVector\(sunDir, 250\)/);
  });

  it('converts a caster height into a RAY distance', () => {
    // A caster `h` above the plane whose shadow lands inside the quad lies
    // `h / sin(elevation)` further along the sun ray than that shadow. Using
    // `h` would under-cover the near plane by a factor of 1/sin(el).
    expect(SCENE_CODE).toMatch(/SHADOW_CASTER_CEILING \/ sinEl/);
    expect(SCENE_CODE).toMatch(/SHADOW_RECEIVER_FLOOR \/ sinEl/);
    expect(SCENE_CODE).toMatch(/Math\.max\(SHADOW_MIN_SIN_ELEVATION, sunDir\.y\)/);
  });
});

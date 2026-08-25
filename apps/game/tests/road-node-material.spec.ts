/**
 * ============================================================================
 * VOLTMARCH — tests/road-node-material.spec.ts
 * ============================================================================
 * THE GATE FOR THE STAGE D2 TSL PORT (the WebGPU migration §5):
 * `src/world/Roads.ts`'s three marking shaders.
 *
 * The mechanism is Stage C's and Stage D's: a TSL node graph compiles to WGSL
 * and to GLSL in plain Node, with no GPU, no canvas and no `renderer.init()`.
 *
 * WHAT THREE EARLIER STAGES LEARNED THE HARD WAY, AND WHAT THIS FILE DOES ABOUT
 * IT. Each one found a different way for a broken port to pass every automated
 * gate, and each lesson has a section here:
 *
 *   Stage D  `.setLayout()` on a body that reads module scope generates clean
 *            WGSL and is refused by Chrome. -> §1b, the declared-function scan.
 *   Stage E  A `varying()` wrapped around a module-scope `toVar` assigns WHERE
 *            THE NODE RESOLVES, not where the var is last written; its first VFX
 *            port shipped two varyings as (0,0) and passed all 28 tests. -> §4,
 *            which reads the EMITTED SOURCE and checks the right-hand side and
 *            the assignment ORDER rather than the presence of a name.
 *   Stage E  A descending `smoothstep` is undefined in WGSL. -> §4c.
 *
 * And one this stage adds, because roads are the only material in the migration
 * whose shipping GLSL is BUILT BY STRING INTERPOLATION from the same table the
 * node path reads: §6 walks every numeric literal in the emitted GLSL and
 * requires a decimal point, because `${3.0}` interpolates as `3`, GLSL ES reads
 * that as an int, and the compile error lands in a player's browser and nowhere
 * else.
 *
 * WHAT A GREEN RUN DOES NOT SAY. A compiled shader is not a correct picture.
 * Whether a road LOOKS the same on the two backends is a capture, and it belongs
 * to `tools/road-node-compare.mjs` and to Stage F.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GLSLNodeBuilder, MeshStandardNodeMaterial, PerspectiveCamera, PlaneGeometry, Scene,
  WGSLNodeBuilder, WebGPURenderer,
} from 'three/webgpu';
import {
  ROAD_COLORS, ROAD_CROSSWALK_DEPTH, ROAD_CROSSWALK_PERIOD, ROAD_CROSSWALK_START,
  ROAD_KERB_HEIGHT, ROAD_LANE_WIDTH, ROAD_NORMAL_SCALE, ROAD_ROUGHNESS, ROAD_SLAB_JOINT,
  ROAD_SLAB_METRES, ROAD_STOPBAR_GAP, ROAD_STOPBAR_WIDTH,
} from '../src/core/config';
import { linearColorTriple } from '../src/core/assets';
import { ROAD_GLSL } from '../src/world/Roads';
import {
  ROAD_ARROW, ROAD_ATTRIBUTE_NAMES, ROAD_MARKS, ROAD_MARK_LINEAR, ROAD_MATERIAL_NAMES,
  ROAD_SURFACE_KINDS, SURFACE_COLOURS, SURFACE_TEXELS, SURFACE_TILE_METRES, paveTexels,
  roadSurfaceRequest, type RoadSurfaceKind,
} from '../src/world/road-markings';
import { createRoadNodeMaterial, createRoadNodeMaterials } from '../src/world/RoadNodeMaterial';
import { DITHER_SHIFT_LITERAL } from '../src/render/dither-nodes';

/* ==========================================================================
 * 0. THE OFFLINE COMPILER
 *
 * Roads are NOT instanced — `RoadNetwork.mount` builds a plain `THREE.Mesh` per
 * surface — so this compiles over a plain mesh, which is the opposite of
 * `stage-d-node-materials.spec.ts`'s deliberate `InstancedMesh`. That difference
 * is the point in both files: the graph a material actually runs depends on the
 * object it is drawn on, and compiling the wrong one exercises the wrong code.
 *
 * The geometry carries the surface's own vec4 attribute and nothing else.
 * `attribute()` WARNS AND SUBSTITUTES when the geometry lacks a name, which
 * silently compiles a different shader from the one the game runs.
 * ========================================================================== */

function offlineRenderer(): WebGPURenderer {
  const canvas = {
    width: 4, height: 4, style: {},
    addEventListener() { /* no listeners are ever fired offline */ },
    removeEventListener() { /* ditto */ },
    getContext() { return null; },
  } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  (renderer as unknown as { hasFeature: () => boolean }).hasFeature = () => false;
  return renderer;
}

interface OfflineBuilder {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  scene: Scene;
  camera: PerspectiveCamera;
  build(): unknown;
  vertexShader?: string;
  fragmentShader?: string;
}

interface CompiledShader { vertex: string; fragment: string }

const BOTH = ['wgsl', 'glsl'] as const;
type Backend = (typeof BOTH)[number];

/** One material per call, so a test can mutate flags without leaking. */
function roadMaterial(kind: RoadSurfaceKind): MeshStandardNodeMaterial {
  return createRoadNodeMaterial(kind, 4, createRoadNodeMaterials(4).uniforms);
}

function compile(material: THREE.Material, kind: RoadSurfaceKind, which: Backend): CompiledShader {
  const geometry = new PlaneGeometry(1, 1, 1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    ROAD_ATTRIBUTE_NAMES[kind],
    new THREE.BufferAttribute(new Float32Array(count * 4), 4),
  );

  const mesh = new THREE.Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);

  const Builder = which === 'wgsl' ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(mesh, offlineRenderer()) as unknown as OfflineBuilder;
  builder.material = material;
  builder.scene = scene;
  builder.camera = new PerspectiveCamera();
  builder.geometry = geometry;
  builder.build();

  return { vertex: builder.vertexShader ?? '', fragment: builder.fragmentShader ?? '' };
}

/* ==========================================================================
 * 1. EVERY GRAPH COMPILES — on BOTH backends of the node path
 * ========================================================================== */

describe('the Stage D2 road graphs compile', () => {
  for (const kind of ROAD_SURFACE_KINDS) {
    for (const which of BOTH) {
      it(`builds ${which.toUpperCase()} for the ${kind} material`, () => {
        const mat = roadMaterial(kind);
        const { vertex, fragment } = compile(mat, kind, which);
        expect(vertex.length).toBeGreaterThan(500);
        expect(fragment.length).toBeGreaterThan(2000);
        mat.dispose();
      });
    }

    it(`emits no NaN literal into the ${kind} material`, () => {
      // A `NaN` in a generated constant is the black-frame failure this repo has
      // a standing rule about, and it costs nothing to look for.
      const mat = roadMaterial(kind);
      for (const which of BOTH) {
        const { vertex, fragment } = compile(mat, kind, which);
        expect(vertex).not.toMatch(/NaN/);
        expect(fragment).not.toMatch(/NaN/);
      }
      mat.dispose();
    });
  }
});

/* ==========================================================================
 * 1b. NO DECLARED WGSL FUNCTION CAPTURES MODULE SCOPE
 *
 * Stage D's finding, applied here. `.setLayout()` turns a TSL `Fn` into a real
 * WGSL function, and a WGSL function can see NOTHING but its declared
 * parameters; a body that reads a module-scope attribute, varying or uniform
 * emits a function full of names that are not in its scope, generates cleanly
 * offline and is refused by Chrome. All three paint functions here read `vRoad`,
 * so none of them may ever carry a layout.
 * ========================================================================== */

describe('the generated road WGSL has no function that reaches outside itself', () => {
  const OUT_OF_SCOPE = ['aRoad', 'aKerb', 'aPave', 'vRoad'];

  /** Bodies of every `fn name( ... ) -> type { ... }` three declared. */
  function declaredFunctions(wgsl: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wgsl)) !== null) {
      // `main` IS the entry point and is the one scope that legitimately holds
      // every attribute and varying in the module.
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

  for (const kind of ROAD_SURFACE_KINDS) {
    it(`declares no capturing function in the ${kind} material`, () => {
      const mat = roadMaterial(kind);
      const built = compile(mat, kind, 'wgsl');
      for (const stage of [built.vertex, built.fragment]) {
        for (const fn of declaredFunctions(stage)) {
          for (const name of OUT_OF_SCOPE) {
            expect(fn.body, `fn ${fn.name} reads ${name}, which only main can see`)
              .not.toMatch(new RegExp(`\\b${name}\\b`));
          }
          expect(fn.body, `fn ${fn.name} reads a nodeUniform, which only main can see`)
            .not.toMatch(/\bnodeUniform\d+\b/);
        }
      }
      mat.dispose();
    });
  }

  it('would actually catch one, so the check is not vacuous', () => {
    // The control. Without it, a run in which three stopped emitting declared
    // functions at all would pass every assertion above and prove nothing.
    const wgsl = 'fn roadThing( a : f32 ) -> f32 { return a * vRoad.x; }';
    expect(wgsl.slice(wgsl.indexOf('{'))).toMatch(/\bvRoad\b/);
  });
});

/* ==========================================================================
 * 2. THE SHARED CONSTANTS ARE ON THEIR PRE-MOVE VALUES
 *
 * THE LITERALS ARE WRITTEN OUT AGAIN ON PURPOSE, and this is the block that must
 * not be tidied. Every scalar below was MOVED out of the GLSL template strings in
 * `Roads.ts` so both materials read one copy. Every other assertion in this file
 * compares one path against the other or against that shared table — so a value
 * that drifted during the move would drift on BOTH sides at once and every one of
 * them would still pass. These numbers are transcribed from the shipping GLSL as
 * it stood at v2.13.0, before the move.
 * ========================================================================== */

describe('the shared road marking constants', () => {
  it('keeps the anti-aliasing and paint numbers the GLSL baked in', () => {
    expect(ROAD_MARKS.aaGain).toBe(0.6);
    expect(ROAD_MARKS.aaFloor).toBe(0.004);
    expect(ROAD_MARKS.markMix).toBe(0.92);
    expect(ROAD_MARKS.paintRoughness).toBe(0.52);
  });

  it('keeps the carriageway stripe geometry the GLSL baked in', () => {
    expect(ROAD_MARKS.wheelLo).toBe(0.28);
    expect(ROAD_MARKS.wheelHi).toBe(0.46);
    expect(ROAD_MARKS.wheelInner).toBe(0.85);
    expect(ROAD_MARKS.wheelOuter).toBe(2.55);
    expect(ROAD_MARKS.wheelMix).toBe(0.34);
    expect(ROAD_MARKS.lineHalf).toBe(0.06);
    expect(ROAD_MARKS.centreOffset).toBe(0.12);
    expect(ROAD_MARKS.dashPeriod).toBe(5.8);
    expect(ROAD_MARKS.dashOn).toBe(3.0);
    expect(ROAD_MARKS.dividerLanes).toBe(4.0);
    expect(ROAD_MARKS.edgeHalf).toBe(0.075);
    expect(ROAD_MARKS.edgeInset).toBe(0.325);
  });

  it('keeps the crosswalk and stop-bar insets the GLSL baked in', () => {
    expect(ROAD_MARKS.crosswalkGate).toBe(0.4);
    expect(ROAD_MARKS.crosswalkBias).toBe(1024.0);
    expect(ROAD_MARKS.zebraInsetLo).toBe(0.55);
    expect(ROAD_MARKS.zebraInsetHi).toBe(0.30);
    expect(ROAD_MARKS.stopInsetLo).toBe(0.45);
    expect(ROAD_MARKS.stopInsetHi).toBe(0.25);
  });

  it('keeps the kerb and pavement numbers the GLSL baked in', () => {
    expect(ROAD_MARKS.kerbRedLo).toBe(0.075);
    expect(ROAD_MARKS.kerbRedHi).toBe(0.095);
    expect(ROAD_MARKS.kerbRedMix).toBe(0.94);
    expect(ROAD_MARKS.kerbDashPeriod).toBe(1.35);
    expect(ROAD_MARKS.kerbDashOn).toBe(0.90);
    expect(ROAD_MARKS.kerbTopEps).toBe(0.005);
    expect(ROAD_MARKS.kerbYellowMix).toBe(0.92);
    expect(ROAD_MARKS.kerbBevel).toBe(0.035);
    expect(ROAD_MARKS.kerbBevelGain).toBe(0.22);
    expect(ROAD_MARKS.soldierLo).toBe(0.80);
    expect(ROAD_MARKS.soldierHi).toBe(0.94);
    expect(ROAD_MARKS.soldierDarken).toBe(0.12);
  });

  it('keeps the lane arrow box the GLSL baked in, at the GLSL precision', () => {
    expect(ROAD_ARROW.near).toBe(11.0);
    expect(ROAD_ARROW.far).toBe(16.4);
    expect(ROAD_ARROW.halfWidth).toBe(1.15);
    /*
     * The two DERIVED values are what the shaders actually divide by, and the
     * GLSL interpolated them through `.toFixed( 3 )`. Computing them in float64
     * gives 5.400000000000002 and 2.3, so `span` is stored rounded and pinned
     * here — a shader dividing by a different number is a different shader, and
     * this is the one entry in the table that could drift without a typo.
     */
    expect(ROAD_ARROW.span).toBe(5.400);
    expect(ROAD_ARROW.width).toBe(2.300);
    expect(ROAD_ARROW.span.toFixed(3)).toBe((ROAD_ARROW.far - ROAD_ARROW.near).toFixed(3));
    expect(ROAD_ARROW.width.toFixed(3)).toBe((ROAD_ARROW.halfWidth * 2).toFixed(3));
  });

  it('keeps the surface tiles, texels and colours the generator was tuned for', () => {
    expect(SURFACE_TILE_METRES).toEqual({ asphalt: 6.0, kerb: 2.0, pavement: 4.8 });
    expect(SURFACE_TEXELS).toEqual({ asphalt: 256, kerb: 128, pavement: 512 });
    expect(SURFACE_COLOURS.asphalt).toBe('#242a33');
    expect(SURFACE_COLOURS.kerb).toBe('#7e8aa2');
    expect(SURFACE_COLOURS.pavement).toBe('#697488');
    expect(SURFACE_COLOURS.pavementJoint).toBe('#4c5568');
    // 1.2 m lands on exactly 128 texels and 0.03 m on 3.2 — the alignment the
    // tile size was chosen for, and the thing a changed tile would break.
    expect(paveTexels(ROAD_SLAB_METRES)).toBe(128);
    expect(paveTexels(ROAD_SLAB_JOINT)).toBeCloseTo(3.2, 10);
  });

  it('builds the three texture requests the shipping materials were tuned on', () => {
    // Seeds and wear are the whole look of these surfaces. A changed seed is a
    // different asphalt, and nothing else in the suite would notice.
    expect(roadSurfaceRequest('carriageway')).toMatchObject({
      kind: 'asphalt', size: 256, seed: 0x2a11, wear: 0.6, roughness: ROAD_ROUGHNESS.asphalt,
    });
    expect(roadSurfaceRequest('kerb')).toMatchObject({
      kind: 'flatPaint', size: 128, seed: 0x51c3, wear: 0.35, roughness: ROAD_ROUGHNESS.kerb,
    });
    expect(roadSurfaceRequest('pavement')).toMatchObject({
      kind: 'paving', size: 512, seed: 0x7b09, wear: 0.4, variation: 0.03, bond: 0,
      roughness: ROAD_ROUGHNESS.pavement,
    });
  });

  it('derives the paint colours from ROAD_COLORS rather than from a second table', () => {
    // The complement of the pinned literals above: config owns every PAINT
    // colour, and this table must keep tracking it.
    expect(ROAD_MARK_LINEAR.centre).toEqual(linearColorTriple(ROAD_COLORS.centreLine));
    expect(ROAD_MARK_LINEAR.paint).toEqual(linearColorTriple(ROAD_COLORS.laneLine));
    expect(ROAD_MARK_LINEAR.wheelPath).toEqual(linearColorTriple(ROAD_COLORS.wheelPath));
    expect(ROAD_MARK_LINEAR.kerbRed).toEqual(linearColorTriple(ROAD_COLORS.kerbRed));
    expect(ROAD_MARK_LINEAR.kerbYellow).toEqual(linearColorTriple(ROAD_COLORS.kerbYellow));
    // And they must be LINEAR, not sRGB — a slip shows as a channel above the
    // sRGB->linear curve for a colour that is plainly not that bright.
    for (const rgb of Object.values(ROAD_MARK_LINEAR)) {
      expect(rgb).toHaveLength(3);
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

/* ==========================================================================
 * 3. THE MATERIALS AGREE WITH THEIR SHIPPING TWINS
 * ========================================================================== */

describe('the road node materials', () => {
  it('carry the four maps the GLSL twin binds, and the same normal scale', () => {
    /*
     * `map + normalMap + roughnessMap + aoMap` off one ORM texture is the whole
     * surface. Losing `aoMap` compiles cleanly and flattens every kerb shadow;
     * losing `roughnessMap` leaves the scalar 1.0 in charge and turns tarmac
     * matte everywhere at once.
     */
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      expect(mat.name).toBe(ROAD_MATERIAL_NAMES[kind]);
      expect(mat.map).not.toBeNull();
      expect(mat.normalMap).not.toBeNull();
      expect(mat.roughnessMap).not.toBeNull();
      expect(mat.aoMap).toBe(mat.roughnessMap);
      expect(mat.normalScale.x).toBe(ROAD_NORMAL_SCALE);
      expect(mat.normalScale.y).toBe(ROAD_NORMAL_SCALE);
      expect(mat.roughness).toBe(1.0);
      expect(mat.metalness).toBe(0.0);
      expect(mat.side).toBe(THREE.DoubleSide);
      mat.dispose();
    }
  });

  it('is STANDARD and not physical, exactly as the GLSL twin is', () => {
    /*
     * Bible ruling #3 (base 0.52 + clearcoat) is about PAINTED UNIT HULLS.
     * Asphalt and concrete have no clear coat and paying for one on 17k
     * triangles of ground buys nothing — so this is the one material family in
     * the migration that must NOT be `MeshPhysicalNodeMaterial`.
     */
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      const flags = mat as unknown as {
        isMeshStandardNodeMaterial?: boolean; isMeshPhysicalNodeMaterial?: boolean;
      };
      expect(flags.isMeshStandardNodeMaterial).toBe(true);
      expect(flags.isMeshPhysicalNodeMaterial).not.toBe(true);
      mat.dispose();
    }
  });

  it('shares one uniform block across all three, so a retune reaches the network', () => {
    const set = createRoadNodeMaterials(4);
    expect(Object.keys(set.materials).sort()).toEqual([...ROAD_SURFACE_KINDS].sort());
    expect(set.uniforms.uLaneWidth.value).toBe(ROAD_LANE_WIDTH);
    expect(set.uniforms.uArrowStraight.value).not.toBe(set.uniforms.uArrowTurn.value);
    set.dispose();
  });

  it('re-implements the dithering the node system does not have', () => {
    /*
     * `material.dithering` is honoured by three's WebGL chunk system and by
     * NOTHING in `src/nodes/`. A carriageway is a large, near-flat, single-hue
     * plane running through the far field — the third place in this game where an
     * 8-bit gradient bands. The marker is the +/-0.25/255 shift constant, which
     * nothing else in any graph produces.
     */
    const mat = roadMaterial('carriageway');
    expect(mat.dithering).toBe(true);
    expect(compile(mat, 'carriageway', 'glsl').fragment)
      .toContain(`${DITHER_SHIFT_LITERAL}`.slice(0, 10));
    mat.dispose();
  });

  it('drops the dither when the flag is off, so the flag is really the switch', () => {
    // The control for the test above: a hard-coded dither would pass it too.
    const mat = roadMaterial('carriageway');
    mat.dithering = false;
    expect(compile(mat, 'carriageway', 'glsl').fragment)
      .not.toContain(`${DITHER_SHIFT_LITERAL}`.slice(0, 10));
    mat.dispose();
  });
});

/* ==========================================================================
 * 4. THE EMITTED SOURCE — Stage E's lesson, applied
 *
 * Every assertion in this section reads the GENERATED SHADER. Stage E's worst
 * defect compiled clean on both backends, passed all 28 of its tests and shipped
 * two varyings as (0,0), and it was found by reading the emitted vertex stage.
 * "The name appears somewhere in the source" is exactly the assertion that would
 * have passed.
 * ========================================================================== */

describe('the emitted road shaders', () => {
  it('assigns vRoad FROM the surface own attribute, on both backends', () => {
    /*
     * THE RIGHT-HAND SIDE IS THE TEST. `vRoad` appearing in the vertex stage
     * proves only that a varying was declared; what matters is what was written
     * into it. A material wired to the wrong attribute — or to none, which
     * `attribute()` substitutes for with a warning — publishes a plausible
     * varying full of zeroes, and every stripe in the shader then evaluates at
     * u = v = 0 and paints one uniform band down the map.
     */
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      for (const which of BOTH) {
        const { vertex } = compile(mat, kind, which);
        const assign = /(?:varyings\.)?vRoad\s*=\s*([A-Za-z_]\w*)\s*;/.exec(vertex);
        expect(assign, `${kind}/${which}: nothing assigns vRoad`).not.toBeNull();
        expect(assign?.[1]).toBe(ROAD_ATTRIBUTE_NAMES[kind]);
      }
      mat.dispose();
    }
  });

  it('assigns the paint result BEFORE both of its readers, on both backends', () => {
    /*
     * The one structural risk in this port. `colorNode` and `roughnessNode` share
     * ONE `Fn` call, which three emits into a single var; that is only correct
     * because `NodeMaterial.setup` resolves `setupDiffuseColor` before
     * `setupVariants`. If three ever reorders those two, the assignment lands
     * after the roughness read and the paint stops being glossy — silently, on
     * one backend or both.
     *
     * So the order is asserted against the source rather than against a comment:
     * find the var `DiffuseColor` is built from, then require its assignment to
     * precede both that line and the `Roughness` line that reads its `.w`.
     */
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      for (const which of BOTH) {
        const { fragment } = compile(mat, kind, which);
        const built = /DiffuseColor\s*=\s*vec4(?:<f32>)?\(\s*([A-Za-z_]\w*)\.xyz/.exec(fragment);
        expect(built, `${kind}/${which}: DiffuseColor is not built from a var`).not.toBeNull();
        const name = built?.[1] ?? '';

        const assignAt = fragment.indexOf(`\t${name} = `);
        const diffuseAt = fragment.indexOf('DiffuseColor = vec4');
        const roughLine = /Roughness = .*/.exec(fragment)?.[0] ?? '';

        expect(assignAt, `${kind}/${which}: ${name} is never assigned`).toBeGreaterThan(-1);
        expect(assignAt, `${kind}/${which}: paint assigned after DiffuseColor`)
          .toBeLessThan(diffuseAt);
        expect(assignAt, `${kind}/${which}: paint assigned after Roughness`)
          .toBeLessThan(fragment.indexOf(roughLine));
        // And the paint amount really is what the roughness lerps toward.
        expect(roughLine, `${kind}/${which}: roughness does not read the paint amount`)
          .toContain(`${name}.w`);
        expect(roughLine).toContain(`${ROAD_MARKS.paintRoughness}`);
      }
      mat.dispose();
    }
  });

  it('takes both derivatives and both arrow samples OUTSIDE the branch', () => {
    /*
     * `fwidth` and an implicit-derivative texture fetch are undefined in
     * non-uniform control flow in GLSL and a uniformity violation in WGSL. The
     * shipping GLSL hoists all four above `if ( dEnd >= 0.0 )` and says why; a
     * port that let any of them slide inside would compile and would be wrong on
     * hardware nobody here owns.
     */
    const mat = roadMaterial('carriageway');
    for (const which of BOTH) {
      const { fragment } = compile(mat, which === 'wgsl' ? 'carriageway' : 'carriageway', which);
      const branchAt = fragment.search(/if\s*\(\s*\(?\s*roadDEnd\s*>=\s*0\.0/);
      expect(branchAt, `${which}: the dEnd branch is gone`).toBeGreaterThan(-1);

      for (const marker of ['fwidth( roadU )', 'fwidth( roadV )']) {
        const at = fragment.indexOf(marker);
        expect(at, `${which}: ${marker} missing`).toBeGreaterThan(-1);
        expect(at, `${which}: ${marker} moved inside the branch`).toBeLessThan(branchAt);
      }
      for (const marker of ['roadArrowStraightA = ', 'roadArrowTurnA = ']) {
        const at = fragment.indexOf(marker);
        expect(at, `${which}: ${marker} missing`).toBeGreaterThan(-1);
        expect(at, `${which}: ${marker} moved inside the branch`).toBeLessThan(branchAt);
      }
    }
    mat.dispose();
  });

  it('contains no descending smoothstep, which is UNDEFINED in WGSL', () => {
    /*
     * `TSL_GAPS` #3, hit in Stage C, again in Stage D's bay door and again in
     * Stage E's water. Every edge pair in the road shaders is ascending because
     * the shipping GLSL was already written as `1.0 - smoothstep( lo, hi, v )`,
     * and this is the check that keeps it that way. Only constant-vs-constant
     * pairs can be decided from the text; the rest carry `roadAaU`, which is
     * positive by construction (`fwidth` is an absolute value plus a floor).
     */
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      const { fragment } = compile(mat, kind, 'wgsl');
      const re = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
      let m: RegExpExecArray | null;
      let seen = 0;
      while ((m = re.exec(fragment)) !== null) {
        seen++;
        expect(Number(m[1]), `${kind}: descending smoothstep ${m[1]} -> ${m[2]}`)
          .toBeLessThan(Number(m[2]));
      }
      expect(seen, `${kind}: no constant smoothstep found, so the check proved nothing`)
        .toBeGreaterThan(0);
      mat.dispose();
    }
  });

  it('carries the config geometry into the carriageway, folded to the same numbers', () => {
    // The zebra band and the stop bar are folded at graph-build time on the node
    // path and computed in-shader on the GLSL one. Both must land on the values
    // `config.ts` describes, or a crosswalk drifts down the approach.
    const mat = roadMaterial('carriageway');
    const { fragment } = compile(mat, 'carriageway', 'wgsl');
    const zB = ROAD_CROSSWALK_START + ROAD_CROSSWALK_DEPTH;
    expect(fragment).toContain(`${ROAD_CROSSWALK_START}`);
    expect(fragment).toContain(`${zB}`);
    expect(fragment).toContain(`${zB + ROAD_STOPBAR_GAP}`);
    expect(fragment).toContain(`${zB + ROAD_STOPBAR_GAP + ROAD_STOPBAR_WIDTH}`);
    expect(fragment).toContain(`${ROAD_CROSSWALK_PERIOD}`);
    expect(fragment).toContain(`${ROAD_ARROW.near}`);
    expect(fragment).toContain(`${ROAD_ARROW.span}`);
    mat.dispose();
  });

  it('folds ROAD_KERB_HEIGHT into the kerb bands', () => {
    const mat = roadMaterial('kerb');
    const { fragment } = compile(mat, 'kerb', 'wgsl');
    expect(fragment).toContain(`${ROAD_KERB_HEIGHT + ROAD_MARKS.kerbRedLo}`);
    expect(fragment).toContain(`${ROAD_KERB_HEIGHT + ROAD_MARKS.kerbRedHi}`);
    expect(fragment).toContain(`${ROAD_KERB_HEIGHT + ROAD_MARKS.kerbTopEps}`);
    mat.dispose();
  });
});

/* ==========================================================================
 * 5. THE CACHE KEY THAT MUST NOT COME ACROSS
 * ========================================================================== */

describe('road program caching', () => {
  it('carries none of the GLSL materials hand-managed cache keys', () => {
    /*
     * `customProgramCacheKey` STILL FIRES on node materials — it is the half of
     * the old mechanism that survives `onBeforeCompile`'s silent death
     * (`TerrainNodeMaterial.TSL_GAPS` #6). The shipping materials return
     * `road:aRoad:v2` and friends, strings a human has to remember to bump.
     * There is no injected GLSL on this path, so those strings could only ever be
     * stale, and a stale key hands back the previous program with nothing thrown
     * and nothing logged.
     */
    const stale = ROAD_SURFACE_KINDS.flatMap((kind) => [
      `road:${ROAD_ATTRIBUTE_NAMES[kind]}`, `road:${ROAD_ATTRIBUTE_NAMES[kind]}:v2`,
    ]);
    for (const kind of ROAD_SURFACE_KINDS) {
      const mat = roadMaterial(kind);
      expect(stale).not.toContain(mat.customProgramCacheKey());
      mat.dispose();
    }
  });
});

/* ==========================================================================
 * 6. THE SHIPPING GLSL STILL COMPILES AS GLSL
 *
 * The move put every marking constant behind a template interpolation, and
 * `${3.0}` prints as `3`. GLSL ES reads that as an int, refuses to `step()` it
 * against a float, and three reports the compile error to the console and draws
 * the material black — in a player's browser, because `npm run build` compiles no
 * shader and `npm test` has no GL context. `Roads.glf` is the fix and this is its
 * gate.
 * ========================================================================== */

describe('the shipping road GLSL', () => {
  /**
   * Every numeric literal outside a comment, with the ones GLSL is happy to read
   * as ints removed: array indices and swizzles do not appear in these snippets,
   * so the only legitimate bare integers would be inside comments.
   */
  function numericLiterals(glsl: string): string[] {
    const stripped = glsl.replace(/\/\/[^\n]*/g, '');
    return stripped.match(/(?<![\w.])\d+(?:\.\d*)?(?![\w.])/g) ?? [];
  }

  for (const kind of ROAD_SURFACE_KINDS) {
    it(`gives every numeric literal in the ${kind} snippet a decimal point`, () => {
      const literals = numericLiterals(ROAD_GLSL[kind]);
      expect(literals.length, `${kind}: no literals found, so the check proved nothing`)
        .toBeGreaterThan(3);
      for (const lit of literals) {
        expect(lit, `${kind}: "${lit}" is an int literal in a float context`).toContain('.');
      }
    });

    it(`interpolates the shared table into the ${kind} snippet`, () => {
      // The complement: a snippet that lost its interpolation entirely would pass
      // the check above with hand-typed literals and drift from the node path.
      const glsl = ROAD_GLSL[kind];
      expect(glsl).toContain('roadPaintAmt');
      expect(glsl).toContain('vRoad');
      if (kind === 'carriageway') {
        expect(glsl).toContain(`${ROAD_MARKS.aaGain}`);
        expect(glsl).toContain(`${ROAD_MARKS.dashPeriod}`);
        expect(glsl).toContain(`${ROAD_MARKS.crosswalkBias}.0`);
      }
      if (kind === 'kerb') expect(glsl).toContain(`${ROAD_MARKS.kerbDashPeriod}`);
      if (kind === 'pavement') expect(glsl).toContain(`${ROAD_MARKS.soldierDarken}`);
    });
  }
});

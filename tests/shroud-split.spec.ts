/**
 * ============================================================================
 * tests/shroud-split.spec.ts
 * ============================================================================
 * "Fog carpet paints over units standing in front of shrouded ground."
 *
 * The carpet used to be drawn with `depthTest: false`, so it composited over
 * the screen pixels of any unit standing IN FRONT of shrouded ground. Measured
 * over 3,600 frames of a real match, mean shroud alpha sampled over a unit's
 * head was 0.021 for infantry and 0.060 for vehicles — worst for the TALLEST
 * units, whose heads sample furthest into the fog.
 *
 * The fix was not `depthTest: true` on its own. Depth-testing the carpet fixes
 * the overpaint and breaks three other things:
 *
 *   1. A remembered structure in explored-but-unlit territory pops to full
 *      daylight instead of sitting under the shroud tint.
 *   2. Unexplored OCEAN renders as bright daylight water — the carpet is draped
 *      on the SEABED while the water surface sits at `WATER_LEVEL`, depth
 *      writing, in an earlier render band.
 *   3. Tall scatter props poke through: a forest inside the unexplored black
 *      stays lit.
 *
 * So the shroud stopped being a screen-space layer and became a property of a
 * world XZ: THE CARPET OWNS THE GROUND PLANE, AND ANYTHING DRAWING ABOVE IT
 * TINTS ITSELF, re-running the carpet's own formula per fragment.
 *
 * WHY THIS FILE EXISTS. That split is spread across seven files and nothing
 * asserted it. The whole thing reverts to the original bug the moment someone
 * "simplifies" the carpet back to `depthTest: false`, or adds a new surface
 * that draws above the ground and forgets to tint — and BOTH failures are
 * invisible in a still frame and invisible to every existing test. This is the
 * regression guard the fix shipped without.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const FOG = read('src/render/FogOfWar.ts');

/**
 * Source with comments stripped.
 *
 * Needed because this file DOCUMENTS the old `depthTest: false` at length — the
 * whole header is about why it changed — so a naive grep for the bug finds the
 * explanation of the bug and fails. Comments are prose; only the code is the
 * behaviour.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FOG_CODE = code(FOG);

/* ========================================================================== */

describe('the carpet owns the ground plane and nothing above it', () => {
  it('depth-tests, so it cannot composite over a unit in front of it', () => {
    // THE defect, in one line. `depthTest: false` here is the original bug.
    expect(FOG_CODE).toMatch(/depthTest:\s*true/);
    expect(FOG_CODE, 'the carpet must never go back to a screen-space layer')
      .not.toMatch(/depthTest:\s*false/);
  });

  it('still writes no depth of its own', () => {
    // It is draped ON the ground and must not occlude anything itself; the
    // depth TEST is what stops it painting over units, not a depth write.
    expect(FOG_CODE).toMatch(/depthWrite:\s*false/);
  });

  it('keeps the measurement that justified the change, in the source', () => {
    // The numbers are the reason the trade-off was taken. A future reader
    // weighing "just turn depth off again" needs them at hand, not in a task
    // tracker they will not read.
    expect(FOG).toContain('3,600 frames');
    expect(FOG).toContain('0.021');
    expect(FOG).toContain('0.060');
  });
});

/* ========================================================================== */

describe('everything that draws above the ground tints itself', () => {
  /**
   * The four surface families that can stand inside the fog. Miss one and it
   * lights up like daylight inside unexplored black — which is exactly what
   * `depthTest: true` alone would have done to all four.
   */
  const SURFACES: ReadonlyArray<readonly [string, string]> = [
    ['src/art/UnitFactory.ts', 'units'],
    ['src/art/BuildingFactory.ts', 'structures'],
    ['src/world/PropLibrary.ts', 'scatter props'],
    ['src/render/RenderBridge.ts', 'the placeholder box'],
  ];

  for (const [file, what] of SURFACES) {
    it(`${what} apply the shroud tint`, () => {
      expect(code(read(file))).toContain('applyShroudTint(shader)');
    });
  }

  it('entity props use the same shroud-aware material as scatter props', () => {
    // The entity integration deliberately stopped cloning a smaller material:
    // that clone dropped aEmit/aGloss and drifted from the node path. Pin the
    // shared route and the implementation it reaches instead of demanding a
    // duplicate inline shader hook in the caller.
    const entities = code(read('src/world/entity-props.system.ts'));
    const props = code(read('src/world/PropLibrary.ts'));
    expect(entities).toContain('createPropMaterial()');
    expect(entities).toContain('np.createPropMaterials()');
    expect(props).toContain('applyShroudTint(shader)');
  });

  it('water carries the same formula, by its own route', () => {
    // Water cannot use `applyShroudTint`: its surface sits at WATER_LEVEL in an
    // earlier depth-writing band while the carpet is draped on the seabed
    // below it, so the carpet is behind the water and would never be seen. The
    // formula is reproduced in the water shader instead, and the comment there
    // is what tells the next reader the two must stay in step.
    const water = read('src/world/WaterMaterial.ts');
    expect(water).toContain('applyShroudTint');
    expect(water, 'the water shader must say it is duplicating the formula')
      .toMatch(/Same formula as applyShroudTint/);
  });

  it('publishes the uniforms as a SHARED object, not per-material copies', () => {
    // A copy freezes the mask at its 1x1 default and the whole thing silently
    // does nothing — the file says so, and this pins it.
    expect(FOG_CODE).toMatch(/shader\.uniforms\.uFogMask = shroudUniforms\.uFogMask/);
    expect(FOG).toContain('Assign the SHARED objects, not copies');
  });
});

/* ========================================================================== */

describe('the tint is computed in the same space the carpet blends in', () => {
  it('injects before tonemapping, not after', () => {
    // Three forces NoToneMapping while rendering into the HalfFloat post
    // target. Tinting after the tonemap would apply the shroud in a different
    // space from the carpet and the two would visibly disagree at the seam
    // between shrouded ground and a shrouded building standing on it.
    expect(FOG_CODE).toMatch(/replace\('#include <tonemapping_fragment>'/);
  });

  it('derives world XZ through instanceMatrix, so batched units are not all at the origin', () => {
    // Every unit and structure in the game is drawn from an InstancedMesh
    // pinned at the world origin. Without the instance transform every one of
    // them would sample the fog at (0,0) and the whole army would share one
    // cell's tint.
    expect(FOG_CODE).toContain('USE_INSTANCING');
    expect(FOG_CODE).toMatch(/vmWp = instanceMatrix \* vmWp/);
  });
});

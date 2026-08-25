/**
 * ============================================================================
 * VOLTMARCH — tests/greeble-rust.spec.ts
 * ============================================================================
 * THE RULE THIS FILE EXISTS FOR IS TWO-SIDED, AND BOTH SIDES ARE LOAD-BEARING.
 *
 *   scorecard #22  "Zero grime on vehicles | No streaks, mud, rust or
 *                   scratches on any hull"
 *   bible 5.5      "Rust exists only on buildings, confined to chimneys, pipes
 *                   and scaffolding: #6A4528/#4D3A2E streaks over #2C2A22,
 *                   25-40% coverage of the stack."
 *
 * ONE generator dresses units AND architecture. For most of its life it carried
 * a header asserting #22 as a rule about everything, so the units-only ban was
 * enforced on buildings too and there was no rust anywhere in the game. The fix
 * is `GreebleSpec.surfaceClass`, and the failure mode of the fix is the exact
 * opposite defect: rust escaping onto walls, paint, team slabs or a hull. So
 * the confinement assertions below are the point, not the coverage one.
 *
 * `bareMetal` is the only rusting tile, and that is deliberate — `rivetPlate`
 * carries the Soviet WALL as well as the stack body, and `stripe` carries the
 * lattice the bible wants read as exposed YELLOW scaffolding. See the block
 * above `rustPipework`.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import {
  ATLAS_COLS, SURFACE_BUDGET, generateGreebleAtlas, greebleSpecHash, slotUv,
  type GreebleSpec, type SlotName,
} from '../src/art/greeble-gen';
import { structureAtlasSpec, padAtlasSpec, padSurfaceSlot } from '../src/art/BuildingFactory';
import { specForPalette } from '../src/art/UnitFactory';
import {
  DEFAULT_ART, RA3_PAD_PALETTE, RA3_STRUCTURE_PALETTE, RA3_UNIT_PALETTE, UNIT_GREEBLE,
} from '../src/core/config';

/** A Soviet-flavoured spec: riveted plating is the busier of the two branches. */
const HULL: GreebleSpec = {
  key: 'test.unit', size: 512, seed: 7,
  basePaint: '#6E7A52', paintShadow: '#2A2E20', teamColor: '#E01418',
  teamSecondary: '#8E0A12', insignia: 'star', insigniaColor: '#E8C24A',
  emissiveColor: '#FF9612', bareMetal: '#6A6157', trackLink: '#281A11',
  glass: '#1A2430', stencil: '#D8D2C0', hazard: '#E8B21A',
  rivets: true, rivetPitchPx: 11, plating: 'riveted', sheen: 0.42,
  panelDensity: 3.4, hullNumber: 1234, surfaceClass: 'hull',
};
const STRUCTURE: GreebleSpec = { ...HULL, key: 'test.structure', surfaceClass: 'structure' };

/**
 * Tile pixel rect. Derived from the EXPORTED `slotUv` by undoing its inset,
 * rather than re-deriving the private `TILE_XY` grid from `SLOT_NAMES` order —
 * a test that reimplements the layout it is checking against would keep
 * passing if the layout moved underneath it.
 */
function rectOf(slot: SlotName, size: number): { x: number; y: number; w: number; h: number } {
  const t = size / ATLAS_COLS;
  const inset = t * UNIT_GREEBLE.tileInsetFraction;
  const uv = slotUv(slot, size);
  return { x: Math.round(uv.u0 * size - inset), y: Math.round(uv.v0 * size - inset), w: t, h: t };
}

const hull = generateGreebleAtlas(HULL);
const structure = generateGreebleAtlas(STRUCTURE);
const foundation = generateGreebleAtlas({
  ...STRUCTURE, key: 'test.foundation', surfaceClass: 'foundation',
});

function differs(i: number): boolean {
  const o = i * 3;
  for (let c = 0; c < 3; c++) {
    if (Math.abs(hull.surface.albedo[o + c] - structure.surface.albedo[o + c]) > 1e-6) return true;
  }
  // Material-class roughness and coat masks now differ deliberately between a
  // hull and architecture. Rust confinement is an albedo/relief claim: a
  // stain may recolour pipework but must not reach another tile or normal.
  return Math.abs(hull.surface.height[i] - structure.surface.height[i]) > 1e-9;
}

describe('rust is confined to structures', () => {
  it('never changes relief outside the bareMetal tile', () => {
    // Architecture now gets broad grime in albedo/roughness by design. Rust is
    // still a stain and neither treatment may leak into the normal field.
    const r = rectOf('bareMetal', HULL.size);
    const strays: string[] = [];
    for (let y = 0; y < HULL.size && strays.length < 8; y++) {
      for (let x = 0; x < HULL.size; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        if (inside) continue;
        const i = y * HULL.size + x;
        if (Math.abs(hull.surface.height[i] - structure.surface.height[i]) > 1e-9) {
          strays.push(`(${x},${y})`);
          break;
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it('keeps non-paint identity tiles identical while weathering painted architecture', () => {
    for (const slot of ['teamSlab', 'insignia', 'stripe', 'rivetPlate', 'hatch'] as const) {
      const r = rectOf(slot, HULL.size);
      let diff = 0;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) diff += differs((r.y + y) * HULL.size + (r.x + x)) ? 1 : 0;
      }
      expect(`${slot}:${diff}`).toBe(`${slot}:0`);
    }
    const r = rectOf('paintLarge', HULL.size);
    let changed = 0;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) changed += differs((r.y + y) * HULL.size + (r.x + x)) ? 1 : 0;
    }
    expect(changed).toBeGreaterThan(r.w * r.h * 0.8);
  });
});

describe('architecture consumes the surface-class table', () => {
  function centre(atlas: typeof structure, slot: SlotName): number {
    const r = rectOf(slot, atlas.size);
    return (r.y + Math.floor(r.h * 0.5)) * atlas.size + r.x + Math.floor(r.w * 0.5);
  }

  it('constrains painted panels and concrete foundations to their declared roughness bands', () => {
    const panel = structure.surface.roughness[centre(structure, 'paintLarge')];
    const concrete = foundation.surface.roughness[centre(foundation, 'paintLarge')];
    expect(panel).toBeGreaterThanOrEqual(DEFAULT_ART.surfaces.buildingPanel.roughnessMin);
    expect(panel).toBeLessThanOrEqual(DEFAULT_ART.surfaces.buildingPanel.roughnessMax);
    expect(concrete).toBeGreaterThanOrEqual(DEFAULT_ART.surfaces.buildingConcrete.roughnessMin);
    expect(concrete).toBeLessThanOrEqual(DEFAULT_ART.surfaces.buildingConcrete.roughnessMax);
  });

  it('keeps the faction coat on paint and removes it from machinery and concrete', () => {
    expect(structure.surface.alpha[centre(structure, 'paintLarge')]).toBe(1);
    expect(structure.surface.alpha[centre(structure, 'bareMetal')]).toBe(0);
    expect(structure.surface.alpha[centre(structure, 'grille')]).toBe(0);
    expect(foundation.surface.alpha[centre(foundation, 'paintLarge')]).toBe(0);
  });

  it('binds hull paint and its bevel wear to the declared vehicle surface', () => {
    const look = DEFAULT_ART.surfaces.vehicleArmor;
    const r = rectOf('paintLarge', hull.size);
    const centreI = (r.y + Math.floor(r.h * 0.5)) * hull.size + r.x + Math.floor(r.w * 0.5);
    const off = Math.round(r.w * UNIT_GREEBLE.tileInsetFraction);
    const bevelI = (r.y + off) * hull.size + r.x + off;
    expect(hull.surface.roughness[centreI]).toBeGreaterThanOrEqual(look.roughnessMin);
    expect(hull.surface.roughness[centreI]).toBeLessThanOrEqual(look.roughnessMax);
    expect(hull.surface.metalness[bevelI]).toBeGreaterThan(hull.surface.metalness[centreI]);
  });

  it('varies foundation slab plans by structure key without remapping markings', () => {
    const slots = new Set([
      padSurfaceSlot('allied_conyard', 'paintMed'),
      padSurfaceSlot('allied_warfactory', 'paintMed'),
      padSurfaceSlot('allied_refinery', 'paintMed'),
    ]);
    expect(slots.size).toBeGreaterThan(1);
    expect(padSurfaceSlot('allied_conyard', 'stripe')).toBe('stripe');
    expect(padSurfaceSlot('allied_conyard', 'emissive')).toBe('emissive');
  });
});

describe('a hull carries no rust at all', () => {
  /**
   * The positive statement, and it is exact rather than a hue test.
   *
   * `paintBareMetal` is anisotropic BY CONSTRUCTION — one albedo value per ROW
   * (`turnedGrain(y / r.h)`), machined rings drawn as full-width horizontal
   * lines, and nothing else. So a clean bare-metal tile is EXACTLY row-constant
   * outside the reserved bevel patch. A streak runs down the barrel and breaks
   * that by definition, so "no rust on this hull" and "this tile is row
   * constant" are the same claim, checkable to 1e-9.
   */
  function rowConstantViolations(atlas: typeof hull): number {
    const size = atlas.size;
    const r = rectOf('bareMetal', size);
    const off = Math.round(r.w * UNIT_GREEBLE.tileInsetFraction);
    const patch = Math.round(r.w * UNIT_GREEBLE.bevelPatchFraction);
    let bad = 0;
    for (let y = 0; y < r.h; y++) {
      const inPatchRow = y >= off && y < off + patch;
      let ref = -1;
      for (let x = 0; x < r.w; x++) {
        if (inPatchRow && x >= off && x < off + patch) continue; // clearBevelPatch
        const i = (r.y + y) * size + (r.x + x);
        const o = i * 3;
        const lum = atlas.surface.albedo[o] + atlas.surface.albedo[o + 1] * 2
          + atlas.surface.albedo[o + 2] * 4 + atlas.surface.roughness[i] * 8;
        if (ref < 0) ref = lum;
        else if (Math.abs(lum - ref) > 1e-9) bad++;
      }
    }
    return bad;
  }

  it('keeps the hull bare-metal tile exactly row-constant', () => {
    expect(rowConstantViolations(hull)).toBe(0);
  });

  it('and the structure one is not, because that is what rust is', () => {
    expect(rowConstantViolations(structure)).toBeGreaterThan(0);
  });

  it('gives every real shipped unit atlas surfaceClass hull', () => {
    // The SHIPPED palettes, not a fixture: `structureAtlasSpec` spreads
    // `specForPalette` — the unit builder — so the only thing standing between
    // a building and the vehicle rule is that one override, on the real path.
    for (const [name, palette] of Object.entries(RA3_UNIT_PALETTE)) {
      expect(`${name}:${specForPalette(name, palette, 512, 3).surfaceClass}`).toBe(`${name}:hull`);
    }
    for (const faction of ['allies', 'soviets'] as const) {
      const p = {
        structure: RA3_STRUCTURE_PALETTE[faction], pad: RA3_PAD_PALETTE[faction],
        panelDensity: 3.4, seed: 3, padSeed: 4,
      };
      expect(structureAtlasSpec(`${faction}.structure`, p, 512).surfaceClass).toBe('structure');
      expect(padAtlasSpec(`${faction}.pad`, p, 512).surfaceClass).toBe('foundation');
    }
  });
});

describe('the rust itself obeys 5.5 and the no-noise law', () => {
  it('covers 25-40% of the tile, as bible 5.5 asks of the stack', () => {
    const r = rectOf('bareMetal', HULL.size);
    let rusted = 0;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) rusted += differs((r.y + y) * HULL.size + (r.x + x)) ? 1 : 0;
    }
    const frac = rusted / (r.w * r.h);
    expect(frac).toBeGreaterThanOrEqual(0.25);
    expect(frac).toBeLessThanOrEqual(0.40);
  });

  it('never touches the height field, so the normal map is unchanged', () => {
    // Rust is a STAIN. Relief would put it into `packNormalStructural` and a
    // stained normal map is how this file grew a noise field the first time.
    let diff = 0;
    for (let i = 0; i < HULL.size * HULL.size; i++) {
      if (Math.abs(hull.surface.height[i] - structure.surface.height[i]) > 1e-9) diff++;
    }
    expect(diff).toBe(0);
  });

  it('adds no speckle — it is drawn shapes, not a noise field', () => {
    // THE no-per-pixel-noise gate. Drawn bands have edges, not extrema.
    expect(structure.metrics.speckleRatio).toBeLessThan(SURFACE_BUDGET.speckleCeiling);
    expect(structure.metrics.speckleRatio - hull.metrics.speckleRatio).toBeLessThan(0.002);
  });

  it('is deterministic — two runs of one spec are identical', () => {
    const again = generateGreebleAtlas(STRUCTURE);
    let diff = 0;
    for (let i = 0; i < structure.albedo.length; i++) {
      if (structure.albedo[i] !== again.albedo[i]) diff++;
    }
    expect(diff).toBe(0);
  });

  it('forks the cache key, so a hull can never be served a rusted atlas', () => {
    expect(greebleSpecHash({ ...HULL, key: 'k' }))
      .not.toBe(greebleSpecHash({ ...HULL, key: 'k', surfaceClass: 'structure' }));
  });
});

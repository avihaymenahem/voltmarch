import { describe, expect, it } from 'vitest';

import { buildWreckSet, rubbleKey, wreckKey } from '../src/art/Wrecks';
import {
  BUILDING_RUBBLE_DEF, RUBBLE_SIZES, VEHICLE_WRECK_DEF, WRECK_CLASSES,
  buildingRubbleDefForFootprint, rubbleSizeForDef, vehicleWreckDefForRadius,
  wreckClassForDef,
} from '../src/core/wrecks';
import { propPalette } from '../src/world/PropLibrary';

describe('procedural wreck roster', () => {
  it('maps authored hull and footprint sizes onto stable render ids', () => {
    expect(vehicleWreckDefForRadius(5.4 * 0.45)).toBe(VEHICLE_WRECK_DEF.light);
    expect(vehicleWreckDefForRadius(6.4 * 0.45)).toBe(VEHICLE_WRECK_DEF.medium);
    expect(vehicleWreckDefForRadius(7.0 * 0.45)).toBe(VEHICLE_WRECK_DEF.heavy);
    expect(vehicleWreckDefForRadius(9.0 * 0.45)).toBe(VEHICLE_WRECK_DEF.support);
    expect(vehicleWreckDefForRadius(14.0 * 0.45)).toBe(VEHICLE_WRECK_DEF.naval);
    expect(buildingRubbleDefForFootprint(1)).toBe(BUILDING_RUBBLE_DEF.small);
    expect(buildingRubbleDefForFootprint(4)).toBe(BUILDING_RUBBLE_DEF.medium);
    expect(buildingRubbleDefForFootprint(9)).toBe(BUILDING_RUBBLE_DEF.large);
    for (const cls of WRECK_CLASSES) expect(wreckClassForDef(VEHICLE_WRECK_DEF[cls])).toBe(cls);
    for (const size of RUBBLE_SIZES) expect(rubbleSizeForDef(BUILDING_RUBBLE_DEF[size])).toBe(size);
  });

  it('builds every faction/class silhouette deterministically with full prop attributes', () => {
    const only = {
      factions: ['allies', 'soviets', 'meridian', 'reclaim', 'neutral'] as const,
      classes: WRECK_CLASSES,
      sizes: RUBBLE_SIZES,
    };
    const a = buildWreckSet(propPalette('temperate'), only);
    const b = buildWreckSet(propPalette('temperate'), only);
    expect(a.vehicles.size).toBe(25);
    expect(a.rubble.size).toBe(15);
    expect(a.triangles).toBeGreaterThan(10_000);
    expect(a.triangles).toBe(b.triangles);

    for (const faction of only.factions) {
      for (const cls of WRECK_CLASSES) {
        const ga = a.vehicles.get(wreckKey(faction, cls))!;
        const gb = b.vehicles.get(wreckKey(faction, cls))!;
        expect(ga.getAttribute('position').count).toBe(gb.getAttribute('position').count);
        expect(ga.getAttribute('aEmit').count).toBe(ga.getAttribute('position').count);
        expect(ga.getAttribute('aGloss').count).toBe(ga.getAttribute('position').count);
      }
      for (const size of RUBBLE_SIZES) {
        const ga = a.rubble.get(rubbleKey(faction, size))!;
        expect(ga.getAttribute('position').count).toBeGreaterThan(0);
        expect(ga.boundingBox).not.toBeNull();
      }
    }
    a.dispose();
    b.dispose();
  });
});

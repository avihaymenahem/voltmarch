import { describe, expect, it } from 'vitest';

import { MAP_CELL_COUNT, MAP_SIZE } from '../src/core/config';
import {
  IRRADIANCE_FIELD_FLOATS, IRRADIANCE_FIELD_SIZE, validIrradianceField,
} from '../src/core/irradiance-field';
import { GRID_COUNT, GRID_STRIDE } from '../src/world/terrain-gen';
import {
  generateIrradianceField, irradianceFieldKey, irradianceFieldTransfers,
} from '../src/world/irradiance-field';

function fixture(ridge = false) {
  const height = new Float32Array(GRID_COUNT);
  const slope = new Float32Array(GRID_COUNT);
  const surface = new Uint8Array(MAP_CELL_COUNT);
  surface.fill(1); // dirt: a readable warm bounce
  if (ridge) {
    for (let z = 0; z < GRID_STRIDE; z++) {
      for (let x = GRID_STRIDE >> 1; x < GRID_STRIDE; x++) {
        height[z * GRID_STRIDE + x] = 12;
      }
    }
  }
  return { terrainKey: 'fixture', biome: 'temperate', height, slope, surface };
}

describe('map irradiance field', () => {
  it('publishes the fixed renderer contract and stable world bounds', () => {
    const field = generateIrradianceField(fixture());
    expect(field.key).toBe(irradianceFieldKey('fixture'));
    expect(field.width).toBe(IRRADIANCE_FIELD_SIZE);
    expect(field.height).toBe(IRRADIANCE_FIELD_SIZE);
    expect(field.rgba).toHaveLength(IRRADIANCE_FIELD_FLOATS);
    expect([field.minX, field.minZ, field.maxX, field.maxZ]).toEqual([0, 0, MAP_SIZE, MAP_SIZE]);
    expect(validIrradianceField(field)).toBe(true);
  });

  it('is deterministic and keeps every channel finite and bounded', () => {
    const a = generateIrradianceField(fixture());
    const b = generateIrradianceField(fixture());
    expect(new Uint8Array(a.rgba.buffer)).toEqual(new Uint8Array(b.rgba.buffer));
    for (let i = 0; i < a.rgba.length; i += 4) {
      expect(Number.isFinite(a.rgba[i])).toBe(true);
      expect(a.rgba[i]).toBeGreaterThanOrEqual(0);
      expect(a.rgba[i]).toBeLessThanOrEqual(0.12);
      expect(a.rgba[i + 1]).toBeGreaterThanOrEqual(0);
      expect(a.rgba[i + 1]).toBeLessThanOrEqual(0.12);
      expect(a.rgba[i + 2]).toBeGreaterThanOrEqual(0);
      expect(a.rgba[i + 2]).toBeLessThanOrEqual(0.12);
      expect(a.rgba[i + 3]).toBeGreaterThanOrEqual(0.30);
      expect(a.rgba[i + 3]).toBeLessThanOrEqual(1);
    }
  });

  it('records broad terrain occlusion and transfers its one buffer without a copy', () => {
    const flat = generateIrradianceField(fixture());
    const ridged = generateIrradianceField(fixture(true));
    // Probe immediately west of the raised half sees less sky than flat land.
    const z = IRRADIANCE_FIELD_SIZE >> 1;
    const x = (IRRADIANCE_FIELD_SIZE >> 1) - 2;
    const alpha = (field: typeof flat) => field.rgba[(z * field.width + x) * 4 + 3];
    expect(alpha(ridged)).toBeLessThan(alpha(flat));
    expect(irradianceFieldTransfers(ridged)).toEqual([ridged.rgba.buffer]);
  });
});

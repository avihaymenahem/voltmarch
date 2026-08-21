import { describe, expect, it } from 'vitest';

import {
  MAP_SIZE, MAP_PRESETS, TERRAIN_SEA_START_CLEARANCE, TERRAIN_START_EDGE_WOBBLE,
  TERRAIN_START_FLAT_RADIUS,
} from '../src/core/config';
import {
  MAP_SEAS, MAP_START_TABLES, START_MIN_SEPARATION, seatedSlots, startPointsFor,
  startSpots,
} from '../src/game/Scenarios';

const C = MAP_SIZE * 0.5;

describe('per-map skirmish start tables', () => {
  it('covers every shipped preset exactly once', () => {
    expect(Object.keys(MAP_START_TABLES).sort()).toEqual(Object.keys(MAP_PRESETS).sort());
  });

  it('uses exact bounded integer slots and valid authored pairs', () => {
    for (const [preset, table] of Object.entries(MAP_START_TABLES)) {
      expect(table.slots.length, preset).toBe(4);
      const seen = new Set<string>();
      for (const slot of table.slots) {
        expect(Number.isInteger(slot.dx), `${preset} dx`).toBe(true);
        expect(Number.isInteger(slot.dz), `${preset} dz`).toBe(true);
        expect(C + slot.dx, `${preset} x margin`).toBeGreaterThanOrEqual(64);
        expect(C + slot.dx, `${preset} x margin`).toBeLessThanOrEqual(MAP_SIZE - 64);
        expect(C + slot.dz, `${preset} z margin`).toBeGreaterThanOrEqual(64);
        expect(C + slot.dz, `${preset} z margin`).toBeLessThanOrEqual(MAP_SIZE - 64);
        seen.add(`${slot.dx},${slot.dz}`);
      }
      expect(seen.size, `${preset} duplicate slots`).toBe(table.slots.length);
      expect(table.pairs.length, `${preset} has no two-player layout`).toBeGreaterThan(0);
      for (const [a, b] of table.pairs) {
        expect(a, `${preset} pair a`).toBeGreaterThanOrEqual(0);
        expect(b, `${preset} pair b`).toBeGreaterThanOrEqual(0);
        expect(a, `${preset} pair a`).toBeLessThan(table.slots.length);
        expect(b, `${preset} pair b`).toBeLessThan(table.slots.length);
        expect(a, `${preset} pair repeats a slot`).not.toBe(b);
        const sa = table.slots[a]!;
        const sb = table.slots[b]!;
        expect(Math.hypot(sa.dx - sb.dx, sa.dz - sb.dz), `${preset} opening distance`)
          .toBeGreaterThanOrEqual(START_MIN_SEPARATION);
      }
    }
  });

  it('gives each preset a distinct complete geometry', () => {
    const signatures = Object.entries(MAP_START_TABLES).map(([preset, table]) => [
      preset,
      table.slots.map((s) => `${s.dx},${s.dz}`).join('|'),
    ] as const);
    expect(new Set(signatures.map(([, signature]) => signature)).size).toBe(signatures.length);
  });

  it('uses the selected table for both terrain reservation and actual spawn', () => {
    for (const [preset, table] of Object.entries(MAP_START_TABLES)) {
      const sea = MAP_SEAS[preset] ?? null;
      for (const seed of [1, 7, 19, 4242]) {
        const islandMap = sea?.islands !== undefined && sea.islands.length > 0;
        const slots = islandMap ? [0, 1] : seatedSlots(2, seed, sea, preset);
        const planned = startPointsFor(2, sea, seed, preset);
        const reserved = islandMap ? planned : planned.slice(1);
        const spawned = startSpots(C, C, 2, sea, seed, preset);
        expect(reserved, `${preset} reserved seed ${seed}`).toEqual(slots.map((slot) => ({
          x: C + table.slots[slot]!.dx,
          z: C + table.slots[slot]!.dz,
        })));
        expect(spawned.map(({ x, z }) => ({ x, z })), `${preset} spawned seed ${seed}`)
          .toEqual(reserved);
      }
    }
  });

  it('keeps every authored coastal pairing inland of its complete shelf budget', () => {
    for (const preset of ['coast', 'tropical'] as const) {
      const sea = MAP_SEAS[preset]!;
      const table = MAP_START_TABLES[preset]!;
      const want = TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
        + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE;
      for (const pair of table.pairs) {
        for (const slot of pair) {
          const p = table.slots[slot]!;
          const clearance = -((C + p.dx - sea.x) * sea.normalX
            + (C + p.dz - sea.z) * sea.normalZ);
          expect(clearance, `${preset} slot ${slot}`).toBeGreaterThanOrEqual(want);
        }
      }
    }
  });
});

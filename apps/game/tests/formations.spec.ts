import { describe, expect, it } from 'vitest';
import { EntityStore } from '../src/core/world';
import { EntityKind, Faction, type EntityId, type PlayerId } from '../src/core/types';
import { NAV_FORMATION_MAX_OFFSET } from '../src/core/config';
import { planFormation, type FormationShape } from '../src/input/Formations';

function group(n: number): { store: EntityStore; ids: Int32Array } {
  const store = new EntityStore();
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const id = store.alloc(EntityKind.Infantry, 0, 0 as PlayerId, Faction.Allies, 40 + i, 0, 40, 0);
    const slot = store.index(id as EntityId);
    store.radius[slot] = 0.5;
    ids[i] = id as number;
  }
  return { store, ids };
}

function points(shape: FormationShape, n = 7): number[][] {
  const { store, ids } = group(n);
  const out = planFormation(store, ids, n, shape);
  return Array.from({ length: n }, (_, i) => [out[i * 2], out[i * 2 + 1]]);
}

describe('explicit formation plans', () => {
  it('ships the four visibly different shapes exposed by the HUD', () => {
    const line = points('line');
    const box = points('box');
    const wedge = points('wedge');
    const triangle = points('triangle');
    expect(new Set(line.map((p) => p[1].toFixed(3))).size).toBe(1);
    expect(new Set(box.map((p) => p[1].toFixed(3))).size).toBeGreaterThan(1);
    expect(wedge).not.toEqual(triangle);
  });

  it('centres every shape and respects the navigation offset ceiling', () => {
    for (const shape of ['line', 'box', 'wedge', 'triangle'] as const) {
      const p = points(shape, 40);
      const cx = p.reduce((sum, q) => sum + q[0], 0) / p.length;
      const cz = p.reduce((sum, q) => sum + q[1], 0) / p.length;
      expect(cx).toBeCloseTo(59.5, 4);
      expect(cz).toBeCloseTo(40, 4);
      expect(Math.max(...p.map((q) => Math.hypot(q[0] - cx, q[1] - cz))))
        .toBeLessThanOrEqual(NAV_FORMATION_MAX_OFFSET + 1e-4);
    }
  });
});

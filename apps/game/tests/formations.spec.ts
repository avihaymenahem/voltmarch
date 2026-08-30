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

  it('assigns the nearest slots instead of making handle order cross the squad', () => {
    const store = new EntityStore();
    const ids = new Int32Array(5);
    const xByHandle = [8, -8, 4, -4, 0];
    for (let i = 0; i < ids.length; i++) {
      const id = store.alloc(
        EntityKind.Infantry, 0, 0 as PlayerId, Faction.Allies, xByHandle[i], 0, 40, 0,
      );
      const slot = store.index(id as EntityId);
      store.radius[slot] = 0.5;
      ids[i] = id as number;
    }
    const out = planFormation(store, ids, ids.length, 'line');
    const bySource = Array.from(ids, (id, order) => ({
      source: store.posX[store.index(id as EntityId)],
      target: out[order * 2],
    })).sort((a, b) => a.source - b.source);
    for (let i = 1; i < bySource.length; i++) {
      expect(bySource[i].target).toBeGreaterThan(bySource[i - 1].target);
    }
  });

  it('uses the group heading rather than whichever entity was allocated first', () => {
    const { store, ids } = group(5);
    store.yaw[store.index(ids[0] as EntityId)] = 0;
    for (let i = 1; i < ids.length; i++) {
      store.yaw[store.index(ids[i] as EntityId)] = Math.PI * 0.5;
    }
    const out = planFormation(store, ids, ids.length, 'line');
    const xs = Array.from(ids, (_id, i) => out[i * 2]);
    const zs = Array.from(ids, (_id, i) => out[i * 2 + 1]);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const zSpan = Math.max(...zs) - Math.min(...zs);
    expect(zSpan).toBeGreaterThan(xSpan * 2);
  });
});

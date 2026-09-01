import { describe, expect, it } from 'vitest';

import {
  IRRADIANCE_FIELD_FLOATS,
  IRRADIANCE_FIELD_SIZE,
  type IrradianceFieldUpdate,
} from '../src/core/irradiance-field';
import {
  CONTEXT_LIGHT_ALPHA_BASE,
  CONTEXT_LIGHT_CAP,
  CONTEXT_LIGHT_MAX_RADIANCE,
  composeContextLights,
  contextLightFingerprint,
  planContextLights,
} from '../src/world/context-light-field';
import {
  retainedIrradianceField,
  setRetainedIrradianceField,
} from '../src/world/retained-irradiance';
import type { SemanticContextSource } from '../src/world/semantic-context';

function source(overrides: Partial<SemanticContextSource> = {}): SemanticContextSource {
  return {
    id: 1,
    kind: 'depot',
    key: 'repairDepot',
    x: 120,
    z: 180,
    yaw: 0.4,
    radius: 10,
    ...overrides,
  };
}

const SOURCES: readonly SemanticContextSource[] = [
  source(),
  source({ id: 7, kind: 'civilian', key: 'civApartments', x: 240, z: 220, radius: 8 }),
  source({ id: 0x40000000, kind: 'resource', key: 'ore-field-0', x: 330, z: 310, radius: 22 }),
];

function field(): IrradianceFieldUpdate {
  const rgba = new Float32Array(IRRADIANCE_FIELD_FLOATS);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0.02;
    rgba[i + 1] = 0.025;
    rgba[i + 2] = 0.03;
    rgba[i + 3] = 0.72;
  }
  return {
    width: IRRADIANCE_FIELD_SIZE,
    height: IRRADIANCE_FIELD_SIZE,
    rgba,
    minX: 0,
    minZ: 0,
    maxX: 512,
    maxZ: 512,
  };
}

describe('semantic context light planner', () => {
  it('is deterministic, source-order independent and fingerprints the full plan', () => {
    const a = planContextLights(SOURCES, 0x71c2ab09);
    const b = planContextLights([...SOURCES].reverse(), 0x71c2ab09);
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(contextLightFingerprint(a.anchors));
    expect(a.fingerprint).toBe(2681002436);
    expect([a.depot, a.civilian, a.resource]).toEqual([1, 1, 1]);
  });

  it('fairly admits all three families before filling later rounds and obeys its cap', () => {
    const many = Array.from({ length: 30 }, (_, id) => source({ id: id + 20, key: `depot-${id}` }));
    const tight = planContextLights([...many, ...SOURCES], 9, 3);
    expect(tight.anchors.map((anchor) => anchor.context)).toEqual(['depot', 'civilian', 'resource']);
    expect(planContextLights([...many, ...SOURCES], 9, 999).anchors).toHaveLength(CONTEXT_LIGHT_CAP);
    expect(planContextLights(SOURCES, 9, 0).anchors).toEqual([]);
  });

  it('authors distinct bounded palettes and radii for depot, civilian and ore context', () => {
    const plan = planContextLights(SOURCES, 44);
    const depot = plan.anchors.find((anchor) => anchor.context === 'depot')!;
    const civilian = plan.anchors.find((anchor) => anchor.context === 'civilian')!;
    const resource = plan.anchors.find((anchor) => anchor.context === 'resource')!;
    expect(depot.red).toBeGreaterThan(depot.blue * 3);
    expect(civilian.red).toBeGreaterThan(civilian.green);
    expect(resource.blue).toBeGreaterThan(resource.red * 3);
    for (const anchor of plan.anchors) {
      expect(anchor.radius).toBeGreaterThanOrEqual(11);
      expect(anchor.radius).toBeLessThanOrEqual(28);
      expect(Math.max(anchor.red, anchor.green, anchor.blue)).toBeLessThanOrEqual(0.12);
    }
  });
});

describe('retained irradiance context composition', () => {
  it('mutates the existing 64 KiB array only inside a bounded dirty rectangle', () => {
    const target = field();
    const identity = target.rgba;
    const before = target.rgba.slice();
    const plan = planContextLights(SOURCES, 0x71c2ab09);
    const result = composeContextLights(target, plan.anchors);

    expect(result.applied).toBe(true);
    expect(target.rgba).toBe(identity);
    expect(target.rgba.byteLength).toBe(64 * 1024);
    expect(result.changedTexels).toBeGreaterThan(0);
    expect(result.changedTexels).toBeLessThan(IRRADIANCE_FIELD_SIZE * IRRADIANCE_FIELD_SIZE / 4);
    expect(result.minTexelX).toBeGreaterThanOrEqual(0);
    expect(result.maxTexelX).toBeLessThan(IRRADIANCE_FIELD_SIZE);

    let packed = 0;
    for (let z = 0; z < IRRADIANCE_FIELD_SIZE; z++) {
      for (let x = 0; x < IRRADIANCE_FIELD_SIZE; x++) {
        const o = (z * IRRADIANCE_FIELD_SIZE + x) * 4;
        const changed = target.rgba[o + 3] > CONTEXT_LIGHT_ALPHA_BASE;
        if (changed) {
          packed++;
          expect(x).toBeGreaterThanOrEqual(result.minTexelX);
          expect(x).toBeLessThanOrEqual(result.maxTexelX);
          expect(z).toBeGreaterThanOrEqual(result.minTexelZ);
          expect(z).toBeLessThanOrEqual(result.maxTexelZ);
          expect(target.rgba[o]).toBeLessThanOrEqual(CONTEXT_LIGHT_MAX_RADIANCE);
          expect(target.rgba[o + 1]).toBeLessThanOrEqual(CONTEXT_LIGHT_MAX_RADIANCE);
          expect(target.rgba[o + 2]).toBeLessThanOrEqual(CONTEXT_LIGHT_MAX_RADIANCE);
        } else {
          expect(target.rgba[o]).toBe(before[o]);
          expect(target.rgba[o + 1]).toBe(before[o + 1]);
          expect(target.rgba[o + 2]).toBe(before[o + 2]);
          expect(target.rgba[o + 3]).toBe(before[o + 3]);
        }
      }
    }
    expect(packed).toBeGreaterThan(0);
  });

  it('is idempotent after the packed local-light mask has been installed', () => {
    const target = field();
    const anchors = planContextLights(SOURCES, 17).anchors;
    expect(composeContextLights(target, anchors).applied).toBe(true);
    const once = target.rgba.slice();
    expect(composeContextLights(target, anchors)).toEqual({
      applied: false, changedTexels: 0,
      minTexelX: -1, minTexelZ: -1, maxTexelX: -1, maxTexelZ: -1,
    });
    expect(target.rgba).toEqual(once);
  });

  it('publishes and clears only the presentation field reference', () => {
    const target = field();
    setRetainedIrradianceField(target);
    expect(retainedIrradianceField()).toBe(target);
    setRetainedIrradianceField(null);
    expect(retainedIrradianceField()).toBeNull();
  });
});

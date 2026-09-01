import { describe, expect, it } from 'vitest';

import {
  SOVIET_HARVESTER_CARGO_PLACEMENT,
  buildSovietHarvesterCargoGeometry,
  createSovietHarvesterCargoMaterial,
} from '../src/art/HarvesterCargo';

describe('Soviet harvester visible cargo experiment', () => {
  it('keeps the ore heap cheap and inside the authored hopper envelope', () => {
    const geometry = buildSovietHarvesterCargoGeometry();
    const position = geometry.getAttribute('position');
    const triangles = geometry.index === null ? position.count / 3 : geometry.index.count / 3;
    const bounds = geometry.boundingBox!;

    expect(triangles).toBeLessThanOrEqual(300);
    expect(bounds.min.x + SOVIET_HARVESTER_CARGO_PLACEMENT.x).toBeGreaterThan(-1.35);
    expect(bounds.max.x + SOVIET_HARVESTER_CARGO_PLACEMENT.x).toBeLessThan(1.35);
    expect(bounds.min.z + SOVIET_HARVESTER_CARGO_PLACEMENT.z).toBeGreaterThan(-2.25);
    expect(bounds.max.z + SOVIET_HARVESTER_CARGO_PLACEMENT.z).toBeLessThan(0.60);
    expect(bounds.max.y + SOVIET_HARVESTER_CARGO_PLACEMENT.y).toBeLessThan(3.10);
    geometry.dispose();
  });

  it('uses the WebGPU node material and never adds a texture fetch', () => {
    const material = createSovietHarvesterCargoMaterial();
    expect(material.isNodeMaterial).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(material.roughnessMap).toBeNull();
    material.dispose();
  });
});

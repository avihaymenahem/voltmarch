import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildCrystalCluster } from '../src/world/ore.system';

describe('ore cluster visual contract', () => {
  it('ships a compact, grounded, multi-tone hard-faceted cluster', () => {
    const geometry = buildCrystalCluster();
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const triangles = geometry.getIndex()!.count / 3;
    const bounds = geometry.boundingBox!;

    expect(triangles).toBeGreaterThanOrEqual(100);
    expect(triangles).toBeLessThanOrEqual(180);
    expect(bounds.min.y).toBeLessThan(-0.1);
    expect(bounds.max.y).toBeGreaterThanOrEqual(1.14);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1.1);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.0);

    const tones = new Set<string>();
    for (let i = 0; i < colors.count; i++) {
      tones.add(`${colors.getX(i).toFixed(3)},${colors.getY(i).toFixed(3)},${colors.getZ(i).toFixed(3)}`);
    }
    expect(positions.count).toBeGreaterThan(150);
    expect(tones.size).toBeGreaterThanOrEqual(5);

    geometry.dispose();
  });

  it('keeps grounding and shadow delivery in the instanced render path', () => {
    const source = readFileSync(new URL('../src/world/ore.system.ts', import.meta.url), 'utf8');

    expect(source).toContain('SURFACE_QUAT.setFromUnitVectors(UP, GROUND_NORMAL)');
    expect(source).toContain('mesh.castShadow = true');
    expect(source).toContain('roughness: 0.36');
    expect(source).toContain('emissiveIntensity: 0.06');
  });
});

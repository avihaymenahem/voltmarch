import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { tagQuadrupedGait } from '../src/art/ImportedUnitAssets';

const root = process.cwd();
const sovietDir = path.join(root, 'packages/assets/game/units/soviets');

interface GlbJson {
  accessors: Array<{ count: number }>;
  images?: Array<{ mimeType?: string }>;
  meshes: Array<{ primitives: Array<{ indices?: number; attributes: { POSITION: number } }> }>;
  extensionsRequired?: string[];
}

function glb(file: string): { bytes: Buffer; json: GlbJson; triangles: number } {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0), file).toBe(0x46546c67);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim()) as GlbJson;
  const triangles = json.meshes.flatMap((mesh) => mesh.primitives).reduce((sum, primitive) => {
    const accessor = primitive.indices ?? primitive.attributes.POSITION;
    return sum + json.accessors[accessor].count / 3;
  }, 0);
  return { bytes, json, triangles };
}

describe('Soviet Attack Dog imported asset', () => {
  it('ships one bounded KTX2 body, one colour LOD and a cheap rest-pose proxy', () => {
    const source = glb(path.join(sovietDir, 'attack-dog.glb'));
    const runtime = glb(path.join(sovietDir, 'compressed/attack-dog.glb'));
    const lod1 = glb(path.join(sovietDir, 'derived/attack-dog.lod1.glb'));
    const shadow = glb(path.join(sovietDir, 'derived/attack-dog.shadow.glb'));

    expect(source.triangles).toBe(5_987);
    expect(runtime.triangles).toBe(source.triangles);
    expect(runtime.bytes.length).toBeLessThan(source.bytes.length);
    expect(runtime.json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(runtime.json.images?.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
    expect(lod1.triangles).toBeLessThanOrEqual(2_600);
    expect(shadow.triangles).toBeLessThanOrEqual(750);
    expect(lod1.json.images ?? []).toHaveLength(0);
    expect(shadow.json.images ?? []).toHaveLength(0);
  });

  it('keeps the runtime on the upright Z-long fit and instanced quadruped path', () => {
    const runtime = fs.readFileSync(
      path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8',
    );
    const dog = runtime.slice(runtime.indexOf("key: 'soviet_dog'"), runtime.indexOf("key: 'meridian_carryall'"));
    expect(dog).toContain("sourceLongAxis: 'z'");
    expect(dog).toContain("gait: 'quadruped'");
    expect(dog).toContain('attack-dog.lod1.glb');
    expect(dog).toContain('attack-dog.shadow.glb');
  });

  it('weights both diagonal leg pairs around local fore and hind pivots', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.36, 0.00, -0.85,  0.36, 0.00, -0.85,
      -0.36, 0.00,  0.85,  0.36, 0.00,  0.85,
      -0.30, 0.65, -0.72,  0.30, 0.65, -0.72,
      -0.30, 0.65,  0.72,  0.30, 0.65,  0.72,
       0.00, 1.36,  0.00,  0.00, 0.85,  0.00,
    ], 3));

    tagQuadrupedGait(geometry);
    const gait = geometry.getAttribute('aGait');
    const signs = Array.from({ length: gait.count }, (_, index) => gait.getX(index));
    expect(signs.some((value) => value > 0)).toBe(true);
    expect(signs.some((value) => value < 0)).toBe(true);
    expect(signs.some((value) => Math.abs(value) === 2)).toBe(true);
    expect(signs.some((value) => Math.abs(value) === 3)).toBe(true);
    expect(signs).toContain(0);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

interface GlbJson {
  accessors: Array<{ count: number }>;
  images?: Array<{ mimeType?: string }>;
  materials?: Array<{ doubleSided?: boolean }>;
  meshes: Array<{ primitives: Array<{ indices?: number; attributes: { POSITION: number } }> }>;
  extensionsRequired?: string[];
}

function glb(file: string): { bytes: Buffer; json: GlbJson } {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0), file).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4), file).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return {
    bytes,
    json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbJson,
  };
}

function triangles(json: GlbJson): number {
  return json.meshes.flatMap((mesh) => mesh.primitives).reduce((sum, primitive) => {
    const accessor = primitive.indices ?? primitive.attributes.POSITION;
    return sum + json.accessors[accessor].count / 3;
  }, 0);
}

describe('Soviet strategic aviation shipping family', () => {
  it('ships the Heavy Aviation Works as compact single-sided KTX2 PBR art', () => {
    const dir = path.join(root, 'packages/assets/game/buildings/soviets');
    const source = glb(path.join(dir, 'heavy-aviation-works.glb'));
    const runtime = glb(path.join(dir, 'compressed/heavy-aviation-works.glb'));
    const lod1 = glb(path.join(dir, 'derived/heavy-aviation-works.lod1.glb'));
    const lod2 = glb(path.join(dir, 'derived/heavy-aviation-works.lod2.glb'));
    const shadow = glb(path.join(dir, 'derived/heavy-aviation-works.shadow.glb'));

    expect(triangles(source.json)).toBeLessThanOrEqual(50_000);
    expect(source.bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(source.json.materials).toHaveLength(1);
    expect(source.json.materials?.[0].doubleSided).not.toBe(true);
    expect(runtime.json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(runtime.json.images?.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
    expect(triangles(lod1.json)).toBeLessThanOrEqual(25_000);
    expect(triangles(lod2.json)).toBeLessThanOrEqual(12_000);
    expect(triangles(shadow.json)).toBeLessThanOrEqual(3_200);
    for (const proxy of [lod1, lod2, shadow]) expect(proxy.json.images ?? []).toHaveLength(0);
  });

  it('keeps both imported Soviet aviation assets wired to runtime art', () => {
    const units = fs.readFileSync(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
    const buildings = fs.readFileSync(path.join(root, 'apps/game/src/art/buildings.system.ts'), 'utf8');
    expect(units).toContain("key: 'soviet_molot'");
    expect(units).toContain('soviets/compressed/molot-heavy-bomber.glb');
    expect(buildings).toContain("key: 'soviet_airbase'");
    expect(buildings).toContain('soviets/compressed/heavy-aviation-works.glb');
  });
});

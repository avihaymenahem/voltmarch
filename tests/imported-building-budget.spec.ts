import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = [
  {
    name: 'Construction Yard',
    path: path.resolve('src/assets/buildings/soviets/construction-yard-surface-v2.glb'),
    maxTriangles: 40_000,
    maxBytes: 9 * 1024 * 1024,
  },
  {
    name: 'Tesla Reactor',
    path: path.resolve('src/assets/buildings/soviets/tesla-reactor.glb'),
    maxTriangles: 25_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Flame Tower',
    path: path.resolve('src/assets/buildings/soviets/flame-tower.glb'),
    maxTriangles: 14_000,
    maxBytes: 3 * 1024 * 1024,
    textureDimensions: {
      base: [1024, 1024],
      normal: [1024, 1024],
      metalRough: [512, 512],
    },
  },
  {
    name: 'Sentry Gun',
    path: path.resolve('src/assets/buildings/soviets/sentry-gun.glb'),
    maxTriangles: 14_000,
    maxBytes: 3 * 1024 * 1024,
    maxMeshes: 2,
    textureDimensions: {
      base: [1024, 1024],
      normal: [1024, 1024],
      metalRough: [512, 512],
    },
  },
  {
    name: 'Tesla Coil',
    path: path.resolve('src/assets/buildings/soviets/tesla-coil.glb'),
    maxTriangles: 14_000,
    maxBytes: 3 * 1024 * 1024,
    textureDimensions: {
      base: [1024, 1024],
      normal: [1024, 1024],
      metalRough: [512, 512],
    },
  },
  {
    name: 'Barracks',
    path: path.resolve('src/assets/buildings/soviets/barracks.glb'),
    maxTriangles: 25_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'War Factory',
    path: path.resolve('src/assets/buildings/soviets/war-factory.glb'),
    maxTriangles: 40_000,
    maxBytes: 9 * 1024 * 1024,
  },
  {
    name: 'Ore Refinery',
    path: path.resolve('src/assets/buildings/soviets/ore-refinery.glb'),
    maxTriangles: 40_000,
    maxBytes: 9 * 1024 * 1024,
  },
  {
    name: 'Radar Tower',
    path: path.resolve('src/assets/buildings/soviets/radar-tower.glb'),
    maxTriangles: 25_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Proving Ground',
    path: path.resolve('src/assets/buildings/soviets/proving-ground.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Command Bunker',
    path: path.resolve('src/assets/buildings/soviets/command-bunker.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Repair Depot',
    path: path.resolve('src/assets/buildings/soviets/repair-depot.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Naval Pen',
    path: path.resolve('src/assets/buildings/soviets/naval-pen.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Nuclear Missile Silo',
    path: path.resolve('src/assets/buildings/soviets/nuclear-silo.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Ironclad Field',
    path: path.resolve('src/assets/buildings/soviets/ironclad-field.glb'),
    maxTriangles: 20_000,
    maxBytes: 6 * 1024 * 1024,
  },
  {
    name: 'Ore Silo',
    path: path.resolve('src/assets/buildings/soviets/ore-silo.glb'),
    maxTriangles: 14_000,
    maxBytes: 3 * 1024 * 1024,
    textureDimensions: {
      base: [1024, 1024],
      normal: [1024, 1024],
      metalRough: [512, 512],
    },
  },
] as const;

interface GlbDocument {
  accessors: Array<{ count: number }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
  images: Array<{ bufferView: number }>;
  textures: Array<{ source: number }>;
  materials: Array<{
    pbrMetallicRoughness: {
      baseColorTexture: { index: number };
      metallicRoughnessTexture: { index: number };
    };
    normalTexture: { index: number };
  }>;
  meshes: Array<{ primitives: Array<{ indices: number }> }>;
}

function readGlb(asset: string): { bytes: Buffer; json: GlbDocument; binaryOffset: number } {
  const bytes = fs.readFileSync(asset);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbDocument;
  return { bytes, json, binaryOffset: 28 + jsonLength };
}

function jpegDimensions(bytes: Buffer): [number, number] {
  let cursor = 2;
  while (cursor < bytes.length) {
    if (bytes[cursor++] !== 0xff) continue;
    let marker = bytes[cursor++];
    while (marker === 0xff) marker = bytes[cursor++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(cursor);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3)];
    }
    cursor += length;
  }
  throw new Error('embedded texture is not a readable JPEG');
}

describe('imported building shipping budget', () => {
  for (const asset of ASSETS) {
    it(`keeps the ${asset.name} inside its RTS geometry and download envelope`, () => {
      const { bytes, json } = readGlb(asset.path);
      expect(json.meshes).toHaveLength('maxMeshes' in asset ? asset.maxMeshes : 1);
      const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
      for (const mesh of json.meshes) expect(mesh.primitives).toHaveLength(1);
      const triangles = primitives.reduce(
        (sum, primitive) => sum + json.accessors[primitive.indices].count / 3,
        0,
      );
      expect(triangles).toBeLessThanOrEqual(asset.maxTriangles);
      expect(bytes.length).toBeLessThanOrEqual(asset.maxBytes);
    });

    it(`keeps the ${asset.name} material maps inside their shipping envelope`, () => {
      const { bytes, json, binaryOffset } = readGlb(asset.path);
      const material = json.materials[0];
      const dimensionsFor = (textureIndex: number): [number, number] => {
        const image = json.images[json.textures[textureIndex].source];
        const view = json.bufferViews[image.bufferView];
        const start = binaryOffset + (view.byteOffset ?? 0);
        return jpegDimensions(bytes.subarray(start, start + view.byteLength));
      };
      const expected = 'textureDimensions' in asset
        ? asset.textureDimensions
        : { base: [2048, 2048], normal: [2048, 2048], metalRough: [1024, 1024] };
      expect(dimensionsFor(material.pbrMetallicRoughness.baseColorTexture.index)).toEqual(expected.base);
      expect(dimensionsFor(material.normalTexture.index)).toEqual(expected.normal);
      expect(dimensionsFor(material.pbrMetallicRoughness.metallicRoughnessTexture.index)).toEqual(expected.metalRough);
    });
  }
});

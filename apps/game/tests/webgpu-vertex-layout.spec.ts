import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  promoteGeometryAttributeToFloat32,
  removeStaleTangentAttribute,
} from '../src/art/geometry-attributes';
import { BIOME_NAMES } from '../src/world/Biomes';
import { PropLibrary } from '../src/world/PropLibrary';

describe('WebGPU vertex layout regressions', () => {
  it('expands normalized Int16 normals into a correctly sized float3 buffer', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('normal', new THREE.Int16BufferAttribute([
      32767, 0, 0,
      0, 32767, 0,
      0, 0, -32767,
    ], 3, true));

    expect(promoteGeometryAttributeToFloat32(geometry, 'normal')).toBe(true);

    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    expect(normal.array).toBeInstanceOf(Float32Array);
    expect(normal.normalized).toBe(false);
    expect(normal.itemSize).toBe(3);
    expect(normal.count).toBe(3);
    expect(normal.array.byteLength).toBe(
      normal.count * normal.itemSize * Float32Array.BYTES_PER_ELEMENT,
    );
    expect([...normal.array]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, -1]);
  });

  it('expands normalized Uint16 UVs into a correctly sized float2 buffer', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Uint16BufferAttribute([
      0, 65535,
      32768, 16384,
      65535, 0,
    ], 2, true));

    expect(promoteGeometryAttributeToFloat32(geometry, 'uv')).toBe(true);

    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.normalized).toBe(false);
    expect(uv.itemSize).toBe(2);
    expect(uv.count).toBe(3);
    expect(uv.array.byteLength).toBe(
      uv.count * uv.itemSize * Float32Array.BYTES_PER_ELEMENT,
    );
    const values = [...uv.array];
    expect(values[0]).toBe(0);
    expect(values[1]).toBe(1);
    expect(values[2]).toBeCloseTo(32768 / 65535, 7);
    expect(values[3]).toBeCloseTo(16384 / 65535, 7);
    expect(values[4]).toBe(1);
    expect(values[5]).toBe(0);
  });

  it('drops the quantized tangent basis after creased normals are rebuilt', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('tangent', new THREE.Int16BufferAttribute([
      32767, 0, 0, 32767,
      32767, 0, 0, 32767,
      32767, 0, 0, 32767,
    ], 4, true));

    expect(removeStaleTangentAttribute(geometry)).toBe(true);
    expect(geometry.getAttribute('tangent')).toBeUndefined();
    expect(removeStaleTangentAttribute(geometry)).toBe(false);
  });

  it('keeps every instanced prop at WebGPU guaranteed vertex-buffer capacity', () => {
    const guaranteedWebGpuVertexBufferSlots = 8;
    const runtimeInstanceBuffers = ['instanceMatrix', 'instanceColor', 'aSwayPhase'];

    for (const biome of BIOME_NAMES) {
      const library = new PropLibrary({ biome, seed: 7 });
      for (const key of library.keys()) {
        const prop = library.get(key);
        expect(prop, `${biome}/${key} exists`).toBeDefined();
        const geometry = prop!.geometry;
        const surface = geometry.getAttribute('aSurface');
        expect(surface, `${biome}/${key} packs emit and gloss`).toBeDefined();
        expect(surface.itemSize, `${biome}/${key} aSurface width`).toBe(2);
        expect(geometry.getAttribute('aEmit'), `${biome}/${key} legacy aEmit`).toBeUndefined();
        expect(geometry.getAttribute('aGloss'), `${biome}/${key} legacy aGloss`).toBeUndefined();

        const slots = Object.keys(geometry.attributes).length + runtimeInstanceBuffers.length;
        expect(
          slots,
          `${biome}/${key} uses ${slots}/${guaranteedWebGpuVertexBufferSlots} slots`,
        ).toBeLessThanOrEqual(guaranteedWebGpuVertexBufferSlots);
      }
    }
  });
});

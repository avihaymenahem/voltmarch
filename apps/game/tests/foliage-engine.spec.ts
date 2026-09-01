import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_ASSET_CATALOG,
  environmentAssetManifest,
} from '../src/world/EnvironmentAssetCatalog';
import {
  FOLIAGE_ALPHA_TEST,
  addEnvironmentRuntimeAttributes,
  createEnvironmentMaterial,
} from '../src/world/EnvironmentAssetLoader';
import {
  FoliageEngine,
  resolveFoliagePresentation,
} from '../src/world/FoliageEngine';
import { PROP_KEYS, PropLibrary, type PropGeometry } from '../src/world/PropLibrary';
import {
  FOLIAGE_LOD, Scatter, foliageLodForDistanceSquared, stablePropVisualRadius, streetPropYaw,
} from '../src/world/Scatter';
import { Terrain } from '../src/world/Terrain';

function candidate(base: PropGeometry, name: string): PropGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0,
    0.5, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([
    0.4, 0.5, 0.2,
    0.4, 0.5, 0.2,
    0.4, 0.5, 0.2,
  ], 3));
  geometry.setAttribute('aSway', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute([
    0, 0,
    0, 0,
    0, 0,
  ], 2));
  geometry.setIndex([0, 1, 2]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    def: base.def,
    geometry,
    triangles: 1,
    boundRadius: 0.5,
    boundHeight: 1,
    boundSphereRadius: geometry.boundingSphere?.radius ?? 1,
  };
}

function family(base: PropGeometry) {
  return {
    lod0: candidate(base, 'tree.lod0'),
    lod1: candidate(base, 'tree.lod1'),
    lod2: candidate(base, 'tree.lod2'),
    shadow: candidate(base, 'tree.shadow'),
    emergency: candidate(base, 'tree.emergency'),
  };
}

function glbFloatAttribute(file: string, semantic: string): number[] {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: {
      bufferView: number; byteOffset?: number; componentType: number; count: number; type: string;
    }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const accessor = gltf.accessors[gltf.meshes[0].primitives[0].attributes[semantic]];
  expect(accessor.componentType).toBe(5126);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  expect(components).toBeDefined();
  const view = gltf.bufferViews[accessor.bufferView];
  const binHeader = 20 + jsonLength;
  const binStart = binHeader + 8;
  const stride = view.byteStride ?? components! * Float32Array.BYTES_PER_ELEMENT;
  const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const result: number[] = [];
  for (let row = 0; row < accessor.count; row++) {
    for (let column = 0; column < components!; column++) {
      result.push(bytes.readFloatLE(start + row * stride + column * Float32Array.BYTES_PER_ELEMENT));
    }
  }
  return result;
}

describe('environment asset catalogue', () => {
  it('uses a hard foliage cutout threshold that rejects bright source fringes', () => {
    expect(FOLIAGE_ALPHA_TEST).toBe(0.85);
  });

  it('carries foliage cutouts into the WebGL wind shadow material', () => {
    const map = new THREE.Texture();
    const alphaMap = new THREE.Texture();
    const material = createEnvironmentMaterial({
      map,
      alphaMap,
      alphaTest: FOLIAGE_ALPHA_TEST,
      side: THREE.DoubleSide,
    }, true);
    const depth = material.userData.vmFoliageDepthMaterial as THREE.MeshDepthMaterial;
    expect(depth).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(depth.map).toBe(map);
    expect(depth.alphaMap).toBe(alphaMap);
    expect(depth.alphaTest).toBe(FOLIAGE_ALPHA_TEST);
    expect(depth.side).toBe(THREE.DoubleSide);
    depth.dispose();
    material.dispose();
    map.dispose();
    alphaMap.dispose();
  });

  it('covers every stable Scatter prop identity with an asset-engine manifest', () => {
    expect(Object.keys(ENVIRONMENT_ASSET_CATALOG).sort()).toEqual([...PROP_KEYS].sort());
    for (const key of PROP_KEYS) {
      const manifest = environmentAssetManifest(key);
      expect(manifest?.stage, key).toBe('integrated');
      expect(manifest?.runtimePresentation, key).toBeUndefined();
      expect(manifest?.deliveries, key).toBeDefined();
    }
  });

  it('aligns the boxed hedge long axis with a roadside run', () => {
    // Local +X at yaw 0 follows a +X road; the generic local +Z convention
    // would return PI/2 and expose only the hedge end cap.
    expect(streetPropYaw('hedge', 1, 0)).toBeCloseTo(0);
    expect(streetPropYaw('hedge', 0, 1)).toBeCloseTo(-Math.PI * 0.5);
    expect(streetPropYaw('streetLamp', 1, 0)).toBeCloseTo(Math.PI * 0.5);
  });

  it('publishes complete, budgeted foliage, mineral and box-prop families', () => {
    const tree = environmentAssetManifest('tree');
    expect(tree).toBe(ENVIRONMENT_ASSET_CATALOG.tree);
    expect(tree?.stage).toBe('integrated');
    expect(tree?.family).toBe('canopy');
    expect(tree?.origin).toBe('ground-centre');
    expect(tree?.wind).toBe('canopy');
    expect(tree?.deliveries).toEqual({
      lod0: 'temperate-broadleaf-v1.glb',
      lod1: 'temperate-broadleaf-v1.glb',
      lod2: 'temperate-broadleaf-v1.glb',
      shadow: 'derived/temperate-broadleaf-v1.shadow.glb',
      emergency: 'derived/temperate-broadleaf-v1.lod2.glb',
    });
    expect(tree?.budget).toEqual({
      rawTriangles: 12_000,
      lod0Triangles: 3_500,
      lod1Triangles: 3_500,
      lod2Triangles: 3_500,
      shadowTriangles: 900,
      emergencyTriangles: 400,
      shippingBytes: 1_572_864,
    });
    expect(new Set([
      tree?.deliveries?.lod0,
      tree?.deliveries?.lod1,
      tree?.deliveries?.lod2,
    ])).toEqual(new Set(['temperate-broadleaf-v1.glb']));

    const bush = environmentAssetManifest('bush');
    const hedge = environmentAssetManifest('hedge');
    expect(bush).toMatchObject({
      family: 'shrub',
      stage: 'integrated',
      materialFamily: 'temperate-shrub-v1-pbr',
      wind: 'canopy',
      metres: { radius: 1.1, height: 1.8 },
    });
    expect(hedge).toMatchObject({
      family: 'shrub',
      stage: 'integrated',
      materialFamily: 'temperate-shrub-v1-pbr',
      wind: 'none',
      metres: { radius: 1.9, height: 1.3 },
    });

    const boulder = environmentAssetManifest('boulder');
    const cluster = environmentAssetManifest('rockCluster');
    const debris = environmentAssetManifest('debrisPile');
    expect(boulder).toMatchObject({
      family: 'rock',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      wind: 'none',
      metres: { radius: 2, height: 2.8 },
    });
    expect(cluster).toMatchObject({
      family: 'rock',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      wind: 'none',
      metres: { radius: 1.7, height: 1.22 },
    });
    expect(debris).toMatchObject({
      family: 'yard',
      stage: 'integrated',
      materialFamily: 'mineral-rock-v1-pbr',
      wind: 'none',
      metres: { radius: 1.7, height: 1.22 },
    });
    expect(debris?.deliveries).toEqual(cluster?.deliveries);
    expect(boulder?.budget.shippingBytes).toBe(1_048_576);
    expect(cluster?.budget.shippingBytes).toBe(196_608);
    expect(bush?.budget.shippingBytes).toBe(786_432);
    expect(hedge?.budget.shippingBytes).toBe(65_536);

    const crates = environmentAssetManifest('crateStack');
    const flowers = environmentAssetManifest('flowerBed');
    expect(crates).toMatchObject({
      family: 'yard',
      stage: 'integrated',
      materialFamily: 'box-prop-v1-pbr',
      wind: 'none',
      metres: { radius: 2.2, height: 2.3 },
    });
    expect(flowers).toMatchObject({
      family: 'civic',
      stage: 'integrated',
      materialFamily: 'box-prop-v1-pbr',
      wind: 'none',
      metres: { radius: 2.4, height: 0.8 },
    });
    expect(crates?.budget.shippingBytes).toBe(524_288);
    expect(flowers?.budget.shippingBytes).toBe(65_536);
  });

  it('keeps clipped hedges rigid in imported and procedural presentations', () => {
    const manifest = environmentAssetManifest('hedge');
    expect(manifest?.wind).toBe('none');

    const library = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['hedge'] });
    const fallback = library.get('hedge');
    expect(fallback).toBeDefined();
    const fallbackSway = fallback!.geometry.getAttribute('aSway');
    expect(fallbackSway).toBeDefined();
    for (let i = 0; i < fallbackSway.count; i++) expect(fallbackSway.getX(i)).toBe(0);

    const imported = fallback!.geometry.clone();
    addEnvironmentRuntimeAttributes(imported, manifest?.wind !== 'none');
    const importedSway = imported.getAttribute('aSway');
    for (let i = 0; i < importedSway.count; i++) expect(importedSway.getX(i)).toBe(0);

    imported.dispose();
    library.dispose();
  });

  it('ships imported families by default while preserving explicit diagnostic modes', () => {
    expect(resolveFoliagePresentation('procedural')).toBe('procedural');
    expect(resolveFoliagePresentation('imported')).toBe('imported');
    expect(resolveFoliagePresentation('emergency')).toBe('emergency');
    expect(resolveFoliagePresentation('broken')).toBe('imported');
    expect(resolveFoliagePresentation(null)).toBe('imported');
  });
});

describe('FoliageEngine presentation boundary', () => {
  it('keeps the procedural library dormant when an imported family is complete', () => {
    const source = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const deliveries = family(source.get('tree')!);
    const fallback = new PropLibrary({ biome: 'temperate', seed: 7, keys: [] });
    const engine = new FoliageEngine({ fallback, presentation: 'imported' });

    expect(fallback.count).toBe(0);
    expect(fallback.totalTriangles).toBe(0);
    engine.register('tree', deliveries);
    expect(engine.renderFamily('tree')).toMatchObject({
      lod0: deliveries.lod0,
      lod1: deliveries.lod1,
      lod2: deliveries.lod2,
      shadow: deliveries.shadow,
    });
    expect(engine.resolution('tree')).toMatchObject({
      requested: 'imported',
      source: 'imported',
      reason: 'requested',
    });
    expect(engine.totalTriangles).toBe(1);

    engine.dispose();
    fallback.dispose();
    source.dispose();
  });

  it('falls back without changing the tree definition when the pilot is unavailable', () => {
    const fallback = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const expected = fallback.get('tree')!;
    const engine = new FoliageEngine({ fallback, presentation: 'imported' });
    const resolution = engine.resolution('tree');

    expect(resolution).toMatchObject({
      requested: 'imported',
      source: 'procedural',
      reason: 'missing-imported',
    });
    expect(resolution?.geometry).toBe(expected);
    expect(resolution?.geometry.def).toBe(expected.def);
    expect(engine.totalTriangles).toBe(fallback.totalTriangles);

    engine.dispose();
    fallback.dispose();
  });

  it('selects imported and emergency deliveries from the same placement identity', () => {
    for (const presentation of ['imported', 'emergency'] as const) {
      const fallback = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
      const base = fallback.get('tree')!;
      const deliveries = family(base);
      const engine = new FoliageEngine({ fallback, presentation });
      engine.register('tree', deliveries);

      const resolution = engine.resolution('tree');
      expect(resolution?.source).toBe(presentation);
      expect(resolution?.reason).toBe('requested');
      expect(resolution?.geometry).toBe(
        presentation === 'imported' ? deliveries.lod0 : deliveries.emergency,
      );
      expect(resolution?.geometry.def).toBe(base.def);
      expect(engine.renderFamily('tree')?.shadow).toBe(deliveries.shadow);
      if (presentation === 'emergency') {
        expect(engine.renderFamily('tree')?.lod0).toBe(deliveries.emergency);
        expect(engine.renderFamily('tree')?.lod1).toBe(deliveries.emergency);
        expect(engine.renderFamily('tree')?.lod2).toBe(deliveries.emergency);
      }

      engine.dispose();
      fallback.dispose();
    }
  });

  it('rejects the current over-budget procedural tree as an imported LOD0', () => {
    const fallback = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const tree = fallback.get('tree')!;
    const deliveries = family(tree);
    const engine = new FoliageEngine({ fallback, presentation: 'imported' });

    expect(() => engine.register('tree', { ...deliveries, lod0: tree })).toThrow(/budget is 3500/);

    for (const delivery of Object.values(deliveries)) delivery.geometry.dispose();
    engine.dispose();
    fallback.dispose();
  });
});

describe('broadleaf camera-band LOD pilot', () => {
  function scatterRig(presentation: 'procedural' | 'imported' | 'emergency', deliveries: ReturnType<typeof family>) {
    const scene = new THREE.Scene();
    const terrain = new Terrain({
      scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1,
    });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0,
      densityScale: 1, preferred: ['tree'], maxTypes: 1,
      foliagePresentation: presentation,
      importedFoliage: new Map([['tree', deliveries]]),
    });
    scatter.generate();
    return { scene, scatter };
  }

  function camera(y: number): THREE.OrthographicCamera {
    const result = new THREE.OrthographicCamera(-400, 400, 400, -400, 1, 2000);
    result.position.set(256, y, 256);
    result.lookAt(256, 0, 256);
    result.updateProjectionMatrix();
    result.updateMatrixWorld();
    return result;
  }

  it('keeps placement identity while dispatching the imported tree across real LOD buckets', () => {
    const source = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const deliveries = family(source.get('tree')!);
    const procedural = scatterRig('procedural', deliveries);
    const imported = scatterRig('imported', deliveries);
    const emergency = scatterRig('emergency', deliveries);

    expect(imported.scatter.placementFingerprint).toBe(procedural.scatter.placementFingerprint);
    expect(emergency.scatter.placementFingerprint).toBe(procedural.scatter.placementFingerprint);

    // Exercise a footprint grazing the stable manifest envelope. Imported LOD0
    // is narrower than the procedural crown, so consulting geometry here would
    // produce different felling masks despite identical placement identity.
    procedural.scatter.update(camera(40), 0);
    const parityPositions = new Float32Array(procedural.scatter.propCount * 4);
    expect(procedural.scatter.positions(parityPositions)).toBeGreaterThan(0);
    const px = parityPositions[0], pz = parityPositions[2];
    let placementScale = 0;
    procedural.scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (mesh.name !== 'prop.tree.lod0') return;
      const matrix = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < mesh.count; i++) {
        if (Math.abs(matrix[i * 16 + 12] - px) > 1e-4
          || Math.abs(matrix[i * 16 + 14] - pz) > 1e-4) continue;
        placementScale = Math.hypot(matrix[i * 16], matrix[i * 16 + 1], matrix[i * 16 + 2]);
        break;
      }
    });
    expect(placementScale).toBeGreaterThan(0);
    const stableRadius = stablePropVisualRadius(source.get('tree')!.def, placementScale);
    expect(stableRadius).toBeCloseTo(4.5 * placementScale, 5);
    const edgeX = px + stableRadius - 0.01;
    const parityRemoved = [procedural, imported, emergency].map(({ scatter }) => (
      scatter.clearFootprint(edgeX - 0.002, pz - 0.002, edgeX + 0.002, pz + 0.002, 0)
    ));
    expect(parityRemoved[0]).toBeGreaterThan(0);
    expect(parityRemoved).toEqual([parityRemoved[0], parityRemoved[0], parityRemoved[0]]);

    imported.scatter.update(camera(40), 0);
    const near = [
      imported.scatter.visibleLod0, imported.scatter.visibleLod1, imported.scatter.visibleLod2,
    ];
    const visibleChunks = imported.scatter.visibleChunks;
    imported.scatter.update(camera(88), 0.1);
    const far = [
      imported.scatter.visibleLod0, imported.scatter.visibleLod1, imported.scatter.visibleLod2,
    ];
    expect(imported.scatter.visibleChunks).toBe(visibleChunks);
    expect(imported.scatter.uploadBytes, 'camera-band change did not repack').toBeGreaterThan(0);
    expect(far).not.toEqual(near);
    expect(far[0] + far[1] + far[2]).toBe(imported.scatter.visibleInstances);

    const colour = imported.scene.children.flatMap((root) => root.children)
      .filter((object) => object.name.startsWith('prop.tree.lod')) as THREE.InstancedMesh[];
    const shadow = imported.scene.children.flatMap((root) => root.children)
      .find((object) => object.name === 'prop.tree.shadow') as THREE.InstancedMesh;
    expect(colour.map((mesh) => mesh.name)).toEqual([
      'prop.tree.lod0', 'prop.tree.lod1', 'prop.tree.lod2',
    ]);
    expect(colour.every((mesh) => mesh.castShadow === false)).toBe(true);
    expect(shadow.userData.vmShadowOnly).toBe(true);
    expect(shadow.castShadow).toBe(true);
    expect(colour.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(imported.scatter.propCount);
    expect(shadow.count).toBe(imported.scatter.propCount);

    // Runtime removals repack every active colour bucket and the independent
    // caster, while the save mask remains valid across presentation modes.
    const positions = new Float32Array(imported.scatter.propCount * 4);
    expect(imported.scatter.positions(positions)).toBeGreaterThan(0);
    const crushed = imported.scatter.crushDisc(positions[0], positions[2], 8);
    expect(crushed).toBeGreaterThan(0);
    imported.scatter.update(camera(88), 0.2);
    expect(colour.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(imported.scatter.propCount);
    expect(shadow.count).toBe(imported.scatter.propCount);

    const mask = new Uint8Array(imported.scatter.felledMaskBytes);
    expect(imported.scatter.felledMask(mask)).toBe(mask.length);
    expect(emergency.scatter.applyFelledMask(mask)).toBe(crushed);
    emergency.scatter.update(camera(88), 0.2);
    const emergencyMeshes = emergency.scene.children.flatMap((root) => root.children)
      .filter((object) => object.name.startsWith('prop.tree.')) as THREE.InstancedMesh[];
    expect(emergencyMeshes.every((mesh) => mesh.count === emergency.scatter.propCount)).toBe(true);

    expect(imported.scatter.clearFootprint(-32, -32, 544, 544, 0)).toBeGreaterThan(0);
    imported.scatter.update(camera(88), 0.3);
    expect(colour.every((mesh) => mesh.count === 0)).toBe(true);
    expect(shadow.count).toBe(0);

    for (const id of [0, 1, 1234]) {
      expect(foliageLodForDistanceSquared(FOLIAGE_LOD.lod1Metres ** 2, id))
        .toBe(foliageLodForDistanceSquared(FOLIAGE_LOD.lod1Metres ** 2, id));
    }

    procedural.scatter.dispose();
    imported.scatter.dispose();
    emergency.scatter.dispose();
    source.dispose();
  }, 20_000);

  it('collapses an accepted medium/far alias into two colour buckets', () => {
    const source = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const deliveries = family(source.get('tree')!);
    const retiredLod2 = deliveries.lod2;
    const accepted = { ...deliveries, lod2: deliveries.lod1 };
    const imported = scatterRig('imported', accepted);

    imported.scatter.update(camera(160), 0);
    const colour = imported.scene.children.flatMap((root) => root.children)
      .filter((object) => object.name.startsWith('prop.tree.lod')) as THREE.InstancedMesh[];
    expect(colour.map((mesh) => mesh.name)).toEqual(['prop.tree.lod0', 'prop.tree.lod1']);
    expect(imported.scatter.visibleLod2).toBe(0);
    expect(colour.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(imported.scatter.propCount);

    imported.scatter.dispose();
    retiredLod2.geometry.dispose();
    source.dispose();
  }, 20_000);

  it('keeps an independent caster for every imported bush instance', () => {
    const source = new PropLibrary({ biome: 'temperate', seed: 11, keys: ['bush'] });
    const deliveries = family(source.get('bush')!);
    const cutoutMap = new THREE.Texture();
    const cutoutMaterial = createEnvironmentMaterial({
      map: cutoutMap,
      alphaTest: FOLIAGE_ALPHA_TEST,
      side: THREE.DoubleSide,
    }, true);
    const cutoutDepth = cutoutMaterial.userData.vmFoliageDepthMaterial as THREE.Material;
    const cutoutDeliveries = {
      ...deliveries,
      shadow: { ...deliveries.shadow, material: cutoutMaterial },
    };
    const scene = new THREE.Scene();
    const terrain = new Terrain({
      scene, seed: 0x51a0, biome: 'temperate', anisotropy: 1,
    });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0xb057, urban: 0,
      densityScale: 1, preferred: ['bush'], maxTypes: 18,
      foliagePresentation: 'imported',
      importedFoliage: new Map([['bush', cutoutDeliveries]]),
    });
    scatter.generate();
    scatter.update(camera(40), 0);

    const colour = scene.children.flatMap((root) => root.children)
      .find((object) => object.name === 'prop.bush.lod0') as THREE.InstancedMesh;
    const shadow = scene.children.flatMap((root) => root.children)
      .find((object) => object.name === 'prop.bush.shadow') as THREE.InstancedMesh;
    expect(colour.count).toBeGreaterThan(0);
    expect(shadow.count).toBe(colour.count);
    expect(shadow.castShadow).toBe(true);
    expect(shadow.userData.vmShadowOnly).toBe(true);
    expect(shadow.instanceMatrix.array).toEqual(colour.instanceMatrix.array);
    expect(shadow.material).toBe(cutoutMaterial);
    expect(shadow.customDepthMaterial).toBe(cutoutDepth);

    scatter.dispose();
    source.dispose();
  }, 20_000);

  it('promotes a generated procedural fallback without resurrecting felled props', () => {
    const source = new PropLibrary({ biome: 'temperate', seed: 7, keys: ['tree'] });
    const deliveries = family(source.get('tree')!);
    const scene = new THREE.Scene();
    const terrain = new Terrain({
      scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1,
    });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0,
      densityScale: 1, preferred: ['tree'], maxTypes: 1,
      foliagePresentation: 'imported',
    });
    scatter.generate();
    scatter.update(camera(40), 0);

    const fingerprint = scatter.placementFingerprint;
    const positions = new Float32Array(scatter.propCount * 4);
    expect(scatter.positions(positions)).toBeGreaterThan(0);
    const felled = scatter.crushDisc(positions[0], positions[2], 8);
    expect(felled).toBeGreaterThan(0);
    const surviving = scatter.propCount;
    const beforeMask = new Uint8Array(scatter.felledMaskBytes);
    scatter.felledMask(beforeMask);

    expect(scatter.foliage.resolution('tree')?.source).toBe('procedural');
    expect(scatter.installImportedFoliage(new Map([['tree', deliveries]]))).toBe(1);
    scatter.update(camera(40), 0.1);

    const afterMask = new Uint8Array(scatter.felledMaskBytes);
    scatter.felledMask(afterMask);
    expect(scatter.placementFingerprint).toBe(fingerprint);
    expect(scatter.propCount).toBe(surviving);
    expect(scatter.clearedProps).toBe(felled);
    expect(afterMask).toEqual(beforeMask);
    expect(scatter.foliage.resolution('tree')?.source).toBe('imported');
    const colour = scene.children.flatMap((root) => root.children)
      .filter((object) => object.name.startsWith('prop.tree.lod')) as THREE.InstancedMesh[];
    expect(colour.map((mesh) => mesh.name)).toEqual([
      'prop.tree.lod0', 'prop.tree.lod1', 'prop.tree.lod2',
    ]);
    expect(colour.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(surviving);

    scatter.dispose();
    source.dispose();
  }, 20_000);
});

describe('foliage production profile', () => {
  it('is accepted by both geometry preparation and texture conditioning', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const prepare = readFileSync(join(repo, 'tools', 'prepare-meshy-asset.mjs'), 'utf8');
    const textures = readFileSync(join(repo, 'tools', 'resize-glb-textures.mjs'), 'utf8');
    const splitter = readFileSync(join(repo, 'tools', 'split-orthographic-sheet.mjs'), 'utf8');

    expect(prepare).toContain("'defence', 'foliage'");
    expect(textures).toContain(
      'foliage: { base: 1024, normal: 1024, metalRough: 512, other: 512 }',
    );
    expect(splitter).toContain("extraArgs.indexOf('--gutter')");
  });

  it('ships the complete audited family below its package and triangle ceilings', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'foliage');
    const tree = environmentAssetManifest('tree')!;
    const uniqueFiles = new Set(Object.values(tree.deliveries!));
    let shippingBytes = 0;
    const triangles: Record<string, number> = {};
    for (const file of uniqueFiles) {
      const absolute = join(root, file);
      const bytes = readFileSync(absolute);
      shippingBytes += statSync(absolute).size;
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      const jsonLength = bytes.readUInt32LE(12);
      const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
      let count = 0;
      for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
        const accessor = primitive.indices ?? primitive.attributes.POSITION;
        count += (gltf.accessors[accessor].count ?? 0) / 3;
      }
      triangles[file] = count;
    }
    expect(shippingBytes).toBe(1_435_116);
    expect(shippingBytes).toBeLessThanOrEqual(tree.budget.shippingBytes);
    expect(triangles[tree.deliveries!.lod0]).toBe(3_363);
    expect(triangles[tree.deliveries!.lod1]).toBe(3_363);
    expect(triangles[tree.deliveries!.lod2]).toBe(3_363);
    expect(triangles[tree.deliveries!.emergency]).toBe(384);
    expect(triangles[tree.deliveries!.shadow]).toBe(802);
  });

  it('ships shared-material boulder and rock-cluster LOD families below their budgets', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'mineral');
    const expected = {
      boulder: [576, 224, 100, 144],
      rockCluster: [450, 240, 120, 150],
      debrisPile: [450, 240, 120, 150],
    } as const;
    for (const key of ['boulder', 'rockCluster', 'debrisPile'] as const) {
      const manifest = environmentAssetManifest(key)!;
      const files = [
        manifest.deliveries!.lod0,
        manifest.deliveries!.lod1,
        manifest.deliveries!.lod2,
        manifest.deliveries!.shadow,
      ];
      let shippingBytes = 0;
      if (key === 'boulder') {
        for (const texture of [
          'material/mineral-rock-v1.base.jpg',
          'material/mineral-rock-v1.normal.jpg',
          'material/mineral-rock-v1.mr.jpg',
        ]) shippingBytes += statSync(join(root, texture)).size;
      }
      const triangles = [];
      for (const file of files) {
        const absolute = join(root, file);
        const bytes = readFileSync(absolute);
        shippingBytes += statSync(absolute).size;
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        expect(gltf.meshes).toHaveLength(1);
        expect(gltf.meshes[0].primitives).toHaveLength(1);
        expect(gltf.images ?? []).toHaveLength(0);
        expect(gltf.materials[0].doubleSided ?? false).toBe(false);
        const primitive = gltf.meshes[0].primitives[0];
        expect(primitive.attributes.COLOR_0).toBeTypeOf('number');
        expect(primitive.attributes.TEXCOORD_0).toBeTypeOf('number');
        triangles.push(gltf.accessors[primitive.indices].count / 3);
      }
      expect(triangles).toEqual(expected[key]);
      expect(shippingBytes).toBeLessThanOrEqual(manifest.budget.shippingBytes);
    }
  });

  it('ships alpha-tested bush and hedge LOD families through one shared atlas', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'shrub');
    const expected = {
      bush: [28, 16, 6, 48],
      hedge: [10, 10, 10, 12],
    } as const;
    for (const key of ['bush', 'hedge'] as const) {
      const manifest = environmentAssetManifest(key)!;
      const files = [
        manifest.deliveries!.lod0,
        manifest.deliveries!.lod1,
        manifest.deliveries!.lod2,
        manifest.deliveries!.shadow,
      ];
      let shippingBytes = 0;
      if (key === 'bush') {
        for (const texture of [
          'material/temperate-shrub-v1.base.webp',
          'material/temperate-shrub-v1.normal.jpg',
          'material/temperate-shrub-v1.mr.jpg',
        ]) shippingBytes += statSync(join(root, texture)).size;
        const base = readFileSync(join(root, 'material/temperate-shrub-v1.base.webp'));
        expect(base.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(base.subarray(8, 12).toString('ascii')).toBe('WEBP');
      }
      const triangles = [];
      for (let i = 0; i < files.length; i++) {
        const absolute = join(root, files[i]);
        const bytes = readFileSync(absolute);
        shippingBytes += statSync(absolute).size;
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        expect(gltf.meshes).toHaveLength(1);
        expect(gltf.meshes[0].primitives).toHaveLength(1);
        expect(gltf.images ?? []).toHaveLength(0);
        expect(gltf.materials[0].doubleSided ?? false).toBe(i < 3);
        const primitive = gltf.meshes[0].primitives[0];
        expect(primitive.attributes.COLOR_0).toBeTypeOf('number');
        if (i < 3) expect(primitive.attributes.TEXCOORD_0).toBeTypeOf('number');
        triangles.push(gltf.accessors[primitive.indices].count / 3);
      }
      expect(triangles).toEqual(expected[key]);
      if (key === 'hedge') {
        for (const file of files.slice(0, 3)) {
          const positions = glbFloatAttribute(join(root, file), 'POSITION');
          const uvs = glbFloatAttribute(join(root, file), 'TEXCOORD_0');
          const vertices = new Set<string>();
          const axes = [new Set<number>(), new Set<number>(), new Set<number>()];
          for (let index = 0; index < positions.length; index += 3) {
            const vertex = positions.slice(index, index + 3)
              .map((value) => Number(value.toFixed(3)));
            vertices.add(vertex.join(','));
            for (let axis = 0; axis < 3; axis++) axes[axis].add(vertex[axis]);
          }
          expect(vertices.size, `${file}: all cards share the box corners`).toBe(8);
          expect([...axes[0]].sort((a, b) => a - b)).toEqual([-1.5, 1.5]);
          expect([...axes[1]].sort((a, b) => a - b)).toEqual([0.01, 1.31]);
          expect([...axes[2]].sort((a, b) => a - b)).toEqual([-0.46, 0.46]);
          expect(uvs.slice(16, 24).map((value) => Number(value.toFixed(3))),
            `${file}: crown atlas width follows hedge width`).toEqual([
            0.004, 0.153, 0.496, 0.153, 0.496, 0.347, 0.004, 0.347,
          ]);
        }
      }
      expect(shippingBytes).toBeLessThanOrEqual(manifest.budget.shippingBytes);
    }
  });

  it('ships textured closed crate and flower-box families through one shared atlas', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'box-prop');
    const expected = {
      crateStack: [60, 60, 60, 24],
      flowerBed: [16, 16, 14, 12],
    } as const;
    for (const key of ['crateStack', 'flowerBed'] as const) {
      const manifest = environmentAssetManifest(key)!;
      const files = [
        manifest.deliveries!.lod0,
        manifest.deliveries!.lod1,
        manifest.deliveries!.lod2,
        manifest.deliveries!.shadow,
      ];
      let shippingBytes = 0;
      if (key === 'crateStack') {
        for (const texture of [
          'material/box-prop-v1.base.webp',
          'material/box-prop-v1.normal.jpg',
          'material/box-prop-v1.mr.jpg',
        ]) shippingBytes += statSync(join(root, texture)).size;
      }
      const triangles = [];
      for (let i = 0; i < files.length; i++) {
        const absolute = join(root, files[i]);
        const bytes = readFileSync(absolute);
        shippingBytes += statSync(absolute).size;
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        expect(gltf.meshes).toHaveLength(1);
        expect(gltf.meshes[0].primitives).toHaveLength(1);
        expect(gltf.images ?? []).toHaveLength(0);
        expect(gltf.materials[0].doubleSided ?? false).toBe(false);
        const primitive = gltf.meshes[0].primitives[0];
        expect(primitive.attributes.COLOR_0).toBeTypeOf('number');
        if (i < 3) expect(primitive.attributes.TEXCOORD_0).toBeTypeOf('number');
        triangles.push(gltf.accessors[primitive.indices].count / 3);
      }
      expect(triangles).toEqual(expected[key]);
      expect(shippingBytes).toBeLessThanOrEqual(manifest.budget.shippingBytes);
    }
  });

  it('ships the remaining vegetation through one alpha-tested atlas', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'extended-foliage');
    const expected = {
      treeAutumn: [68, 58, 50, 50],
      conifer: [46, 44, 42, 48],
      palm: [170, 168, 166, 44],
      grassTuft: [8, 6, 4, 24],
      grassTuftGreen: [8, 6, 4, 24],
    } as const;
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      const manifest = environmentAssetManifest(key)!;
      const files = [
        manifest.deliveries!.lod0, manifest.deliveries!.lod1,
        manifest.deliveries!.lod2, manifest.deliveries!.shadow,
      ];
      const triangles = files.map((file, index) => {
        const bytes = readFileSync(join(root, file));
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        expect(gltf.meshes).toHaveLength(1);
        expect(gltf.meshes[0].primitives).toHaveLength(1);
        expect(gltf.materials[0].doubleSided ?? false).toBe(index < 3);
        if (key === 'treeAutumn' && index === 3) {
          expect(gltf.meshes[0].primitives[0].attributes.TEXCOORD_0)
            .toBeTypeOf('number');
        }
        return gltf.accessors[gltf.meshes[0].primitives[0].indices].count / 3;
      });
      expect(triangles).toEqual(expected[key]);
    }
  });

  it('keeps small-foliage casters compact instead of projecting detached blobs', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const bounds = (positions: number[]) => {
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      for (let index = 0; index < positions.length; index += 3) {
        xs.push(positions[index]);
        ys.push(positions[index + 1]);
        zs.push(positions[index + 2]);
      }
      return {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        depth: Math.max(...zs) - Math.min(...zs),
        radius: Math.max(...xs.map((x, index) => Math.hypot(x, zs[index]))),
      };
    };

    const bush = bounds(glbFloatAttribute(join(
      repo, 'packages', 'assets', 'game', 'environment', 'shrub',
      'derived', 'bush-v1.shadow.glb',
    ), 'POSITION'));
    expect(bush.width).toBeLessThanOrEqual(1.25);
    expect(bush.depth).toBeLessThanOrEqual(0.95);
    expect(bush.height).toBeLessThanOrEqual(1.50);

    const extended = join(repo, 'packages', 'assets', 'game', 'environment', 'extended-foliage');
    const autumnShadow = glbFloatAttribute(join(
      extended, 'derived/tree-autumn-v1.shadow.glb',
    ), 'POSITION');
    const autumnRadius = Math.max(...Array.from(
      { length: autumnShadow.length / 3 },
      (_, index) => Math.hypot(autumnShadow[index * 3], autumnShadow[index * 3 + 2]),
    ));
    // The rejected closed proxy had a 3.7 m opaque radius. The card caster may
    // span the whole irregular crown, but its atlas mask — pinned above — owns
    // the empty space instead of turning that span into one solid polygon.
    expect(autumnRadius).toBeLessThan(3.5);

    for (const file of [
      'derived/grass-tuft-v1.shadow.glb',
      'derived/grass-tuft-green-v1.shadow.glb',
    ]) {
      const grass = bounds(glbFloatAttribute(join(extended, file), 'POSITION'));
      expect(grass.radius, file).toBeLessThanOrEqual(0.24);
      expect(grass.height, file).toBeLessThanOrEqual(1.56);
    }
  });

  it('keeps the autumn crown clustered instead of projecting one radial flower card', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const file = join(repo, 'packages', 'assets', 'game', 'environment', 'extended-foliage', 'tree-autumn-v1.glb');
    const positions = glbFloatAttribute(file, 'POSITION');
    const trunkVertices = 20;
    const canopyQuadCount = (positions.length / 3 - trunkVertices) / 4;
    expect(canopyQuadCount).toBe(16);

    let offsetClusters = 0;
    for (let quad = 0; quad < canopyQuadCount; quad++) {
      const firstVertex = trunkVertices + quad * 4;
      const points = Array.from({ length: 4 }, (_, corner) => {
        const offset = (firstVertex + corner) * 3;
        return [positions[offset], positions[offset + 2]] as const;
      });
      const centreX = points.reduce((sum, point) => sum + point[0], 0) / 4;
      const centreZ = points.reduce((sum, point) => sum + point[1], 0) / 4;
      if (Math.hypot(centreX, centreZ) > 0.65) offsetClusters++;
      const maximumFootprint = Math.max(...points.flatMap((a) => (
        points.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))
      )));
      // The rejected full-width horizontal card had a roughly nine-metre XZ
      // diagonal and made the complete branch texture read as a sunflower.
      expect(maximumFootprint).toBeLessThan(5.5);
    }
    expect(offsetClusters).toBeGreaterThanOrEqual(12);
  });

  it('keeps every authored tree trunk inside a mip-safe opaque atlas region', async () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'extended-foliage');
    const atlas = await sharp(join(root, 'material', 'extended-foliage-v1.base.webp'))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pointMappedTrunks = [
      ['tree-autumn-v1.glb', 20],
      ['palm-v1.glb', 90],
    ] as const;

    for (const [file, vertexCount] of pointMappedTrunks) {
      const uv = glbFloatAttribute(join(root, file), 'TEXCOORD_0');
      const u = uv[0];
      const v = uv[1];
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        expect(uv[vertex * 2], `${file} trunk u`).toBeCloseTo(u, 5);
        expect(uv[vertex * 2 + 1], `${file} trunk v`).toBeCloseTo(v, 5);
      }
      const cx = Math.round(u * (atlas.info.width - 1));
      const cy = Math.round((1 - v) * (atlas.info.height - 1));
      // A 33x33 opaque guard survives five atlas mip reductions. The former
      // 8x8 corner swatch passed a base-level alpha check and then vanished.
      for (let y = cy - 16; y <= cy + 16; y++) {
        for (let x = cx - 16; x <= cx + 16; x++) {
          const alpha = atlas.data[(y * atlas.info.width + x) * 4 + 3];
          expect(alpha, `${file} opaque guard at ${x},${y}`).toBeGreaterThanOrEqual(217);
        }
      }
    }

    const coniferUv = glbFloatAttribute(join(root, 'conifer-v1.glb'), 'TEXCOORD_0');
    const coniferTrunkVertices = 90;
    const barkSamples = new Set<string>();
    for (let vertex = 0; vertex < coniferTrunkVertices; vertex++) {
      const u = coniferUv[vertex * 2];
      const v = coniferUv[vertex * 2 + 1];
      expect(u, 'conifer bark u').toBeGreaterThanOrEqual(526 / 1024 - 1e-6);
      expect(u, 'conifer bark u').toBeLessThanOrEqual(602 / 1024 + 1e-6);
      expect(v, 'conifer bark v').toBeGreaterThanOrEqual(1 - 130 / 1024 - 1e-6);
      expect(v, 'conifer bark v').toBeLessThanOrEqual(1 - 14 / 1024 + 1e-6);
      barkSamples.add(`${u.toFixed(5)},${v.toFixed(5)}`);
      const x = Math.round(u * (atlas.info.width - 1));
      const y = Math.round((1 - v) * (atlas.info.height - 1));
      const offset = (y * atlas.info.width + x) * 4;
      expect(atlas.data[offset + 3], `conifer bark alpha at ${x},${y}`).toBe(255);
      expect(atlas.data[offset], `conifer bark red at ${x},${y}`).toBeGreaterThan(atlas.data[offset + 1]);
      expect(atlas.data[offset + 1], `conifer bark green at ${x},${y}`).toBeGreaterThan(atlas.data[offset + 2]);
    }
    // Unlike the other mip-safe point-mapped trunks, the conifer deliberately
    // spans a fissured bark plate instead of tinting one needle texel brown.
    expect(barkSamples.size).toBeGreaterThanOrEqual(5);

    const coniferCrownVertices = 16;
    for (let vertex = coniferTrunkVertices;
      vertex < coniferTrunkVertices + coniferCrownVertices; vertex++) {
      const u = coniferUv[vertex * 2];
      const v = coniferUv[vertex * 2 + 1];
      expect(u, 'conifer crown u').toBeGreaterThanOrEqual(720 / 1024 - 1e-6);
      expect(u, 'conifer crown u').toBeLessThanOrEqual(1006 / 1024 + 1e-6);
      expect(v, 'conifer crown v').toBeGreaterThanOrEqual(1 - 494 / 1024 - 1e-6);
      expect(v, 'conifer crown v').toBeLessThanOrEqual(1 - 18 / 1024 + 1e-6);
    }
    for (let vertex = coniferTrunkVertices + coniferCrownVertices;
      vertex < coniferUv.length / 2; vertex++) {
      const u = coniferUv[vertex * 2];
      const v = coniferUv[vertex * 2 + 1];
      expect(u, 'conifer branch u').toBeGreaterThanOrEqual(528 / 1024 - 1e-6);
      expect(u, 'conifer branch u').toBeLessThanOrEqual(696 / 1024 + 1e-6);
      expect(v, 'conifer branch v').toBeGreaterThanOrEqual(1 - 486 / 1024 - 1e-6);
      expect(v, 'conifer branch v').toBeLessThanOrEqual(1 - 152 / 1024 + 1e-6);
    }
  });

  it('keeps the conifer crown coherent without repeating identical card profiles', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const file = join(
      repo, 'packages', 'assets', 'game', 'environment', 'extended-foliage', 'conifer-v1.glb',
    );
    const positions = glbFloatAttribute(file, 'POSITION');
    const colours = glbFloatAttribute(file, 'COLOR_0');
    const trunkVertices = 90;
    const crownCards = 4;
    const widths = new Set<string>();
    const heights = new Set<string>();
    const tones = new Set<string>();
    for (let card = 0; card < crownCards; card++) {
      const first = trunkVertices + card * 4;
      const a = first * 3;
      const b = (first + 1) * 3;
      const c = (first + 2) * 3;
      widths.add(Math.hypot(
        positions[b] - positions[a], positions[b + 2] - positions[a + 2],
      ).toFixed(2));
      heights.add((positions[c + 1] - positions[a + 1]).toFixed(2));
      tones.add(`${colours[a].toFixed(2)},${colours[a + 1].toFixed(2)},${colours[a + 2].toFixed(2)}`);
    }
    expect(widths.size).toBeGreaterThanOrEqual(3);
    expect(heights.size).toBeGreaterThanOrEqual(3);
    expect(tones.size).toBe(crownCards);
  });

  it('ships every remaining shared-atlas prop as one static asset-engine primitive', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'prop-surface');
    const keys = PROP_KEYS.filter((key) => (
      environmentAssetManifest(key)?.materialFamily === 'prop-surface-v1-pbr'
    ));
    expect(keys).toHaveLength(17);
    for (const key of keys) {
      const manifest = environmentAssetManifest(key)!;
      const files = [
        manifest.deliveries!.lod0, manifest.deliveries!.lod1,
        manifest.deliveries!.lod2, manifest.deliveries!.shadow,
      ];
      for (let i = 0; i < files.length; i++) {
        const absolute = join(root, files[i]);
        const bytes = readFileSync(absolute);
        expect(statSync(absolute).size).toBeLessThanOrEqual(manifest.budget.shippingBytes);
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        expect(gltf.meshes).toHaveLength(1);
        expect(gltf.meshes[0].primitives).toHaveLength(1);
        expect(gltf.images ?? []).toHaveLength(0);
        expect(gltf.materials[0].doubleSided ?? false).toBe(false);
        const primitive = gltf.meshes[0].primitives[0];
        expect(primitive.attributes.COLOR_0).toBeTypeOf('number');
        if (i < 3) expect(primitive.attributes.TEXCOORD_0).toBeTypeOf('number');
        const triangles = gltf.accessors[primitive.indices].count / 3;
        const ceilings = [
          manifest.budget.lod0Triangles, manifest.budget.lod1Triangles,
          manifest.budget.lod2Triangles, manifest.budget.shadowTriangles,
        ];
        expect(triangles, `${key}.${i}`).toBeLessThanOrEqual(ceilings[i]);
      }
    }
  });

  it('ships the civic engineer monument as one embedded-PBR mesh plus a geometry-only caster', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'prop-surface');
    const manifest = environmentAssetManifest('statue')!;
    expect(manifest.materialFamily).toBe('embedded-pbr');
    expect(manifest.deliveries).toMatchObject({
      lod0: 'statue-v2.glb', lod1: 'statue-v2.glb', lod2: 'statue-v2.glb',
      shadow: 'derived/statue-v2.shadow.glb', emergency: 'statue-v2.glb',
    });
    expect(PROP_KEYS).not.toContain('statueRider');
    expect(environmentAssetManifest('statueRider')).toBeUndefined();
    for (const legacy of [
      'statue-v1.glb', 'statue-rider-v1.glb',
      'derived/statue-v1.lod1.glb', 'derived/statue-v1.lod2.glb',
      'derived/statue-v1.shadow.glb', 'derived/statue-rider-v1.lod1.glb',
      'derived/statue-rider-v1.lod2.glb', 'derived/statue-rider-v1.shadow.glb',
    ]) expect(existsSync(join(root, legacy)), legacy).toBe(false);

    const visible = join(root, manifest.deliveries!.lod0);
    const bytes = readFileSync(visible);
    expect(statSync(visible).size).toBeLessThanOrEqual(manifest.budget.shippingBytes);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
    expect(gltf.meshes).toHaveLength(1);
    expect(gltf.meshes[0].primitives).toHaveLength(1);
    expect(gltf.images).toHaveLength(3);
    expect(gltf.materials).toHaveLength(1);
    expect(gltf.materials[0].doubleSided ?? false).toBe(false);
    const primitive = gltf.meshes[0].primitives[0];
    expect(primitive.attributes.TEXCOORD_0).toBeTypeOf('number');
    expect(gltf.accessors[primitive.indices].count / 3).toBe(8_094);

    const positions = glbFloatAttribute(visible, 'POSITION');
    const xs = positions.filter((_, index) => index % 3 === 0);
    const ys = positions.filter((_, index) => index % 3 === 1);
    const zs = positions.filter((_, index) => index % 3 === 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(4.6, 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.8, 1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.9, 1);

    const shadow = join(root, manifest.deliveries!.shadow);
    const shadowBytes = readFileSync(shadow);
    const shadowJsonLength = shadowBytes.readUInt32LE(12);
    const shadowGltf = JSON.parse(
      shadowBytes.subarray(20, 20 + shadowJsonLength).toString('utf8').trim(),
    );
    const shadowPrimitive = shadowGltf.meshes[0].primitives[0];
    expect(shadowGltf.images ?? []).toHaveLength(0);
    expect(shadowGltf.accessors[shadowPrimitive.indices].count / 3)
      .toBeLessThanOrEqual(manifest.budget.shadowTriangles);
  });

  it('uses silhouette casters for the field tent and barrel group', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const root = join(repo, 'packages', 'assets', 'game', 'environment', 'prop-surface', 'derived');
    const triangles = (file: string) => {
      const bytes = readFileSync(join(root, file));
      const jsonLength = bytes.readUInt32LE(12);
      const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
      const primitive = gltf.meshes[0].primitives[0];
      return gltf.accessors[primitive.indices].count / 3;
    };
    expect(triangles('haystack-v1.shadow.glb')).toBe(84);
    expect(triangles('barrel-v1.shadow.glb')).toBe(128);
  });
});

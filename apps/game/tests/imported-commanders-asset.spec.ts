import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const commanders = [
  ['allies', 'field-marshal'],
  ['soviets', 'war-commissar'],
  ['meridian', 'hierarch'],
  ['reclamation', 'scrap-baron'],
] as const;

function commanderFile(faction: string, stem: string, variant: string): string {
  return path.join(root, 'packages/assets/game/units', faction, 'commanders', `${stem}-${variant}.glb`);
}

describe('imported faction commander assets', () => {
  it.each(commanders)('%s %s ships one bounded, skinned PBR body', async (faction, stem) => {
    const document = await io.read(commanderFile(faction, stem, 'lod0'));
    const asset = document.getRoot();
    const meshes = asset.listMeshes();
    const skins = asset.listSkins();
    const materials = asset.listMaterials();

    expect(meshes).toHaveLength(1);
    expect(skins).toHaveLength(1);
    expect(skins[0].listJoints()).toHaveLength(24);
    expect(materials).toHaveLength(1);
    expect(asset.listTextures()).toHaveLength(3);

    const primitives = meshes[0].listPrimitives();
    expect(primitives).toHaveLength(1);
    const primitive = primitives[0];
    const position = primitive.getAttribute('POSITION');
    const joints = primitive.getAttribute('JOINTS_0');
    const weights = primitive.getAttribute('WEIGHTS_0');
    expect(position).not.toBeNull();
    expect(joints).not.toBeNull();
    expect(weights).not.toBeNull();
    const triangles = (primitive.getIndices()?.getCount() ?? position!.getCount()) / 3;
    expect(triangles).toBeGreaterThan(40_000);
    expect(triangles).toBeLessThanOrEqual(50_000);

    const joint = new Array<number>(4);
    const weight = new Array<number>(4);
    let maxJoint = -1;
    let invalidWeights = 0;
    for (let vertex = 0; vertex < position!.getCount(); vertex++) {
      joints!.getElement(vertex, joint);
      weights!.getElement(vertex, weight);
      maxJoint = Math.max(maxJoint, ...joint);
      const sum = weight.reduce((total, value) => total + value, 0);
      if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.01) invalidWeights++;
    }
    expect(maxJoint).toBeLessThan(24);
    expect(invalidWeights).toBe(0);

    const material = materials[0];
    expect(material.getBaseColorTexture()?.getSize()).toEqual([1024, 1024]);
    expect(material.getNormalTexture()?.getSize()).toEqual([1024, 1024]);
    expect(material.getMetallicRoughnessTexture()?.getSize()).toEqual([512, 512]);
    expect(material.getNormalScale()).toBeGreaterThan(0);
  });

  it.each(commanders)('%s %s keeps walk and run as mesh-free animation clips', async (faction, stem) => {
    for (const variant of ['walk', 'run']) {
      const document = await io.read(commanderFile(faction, stem, variant));
      const asset = document.getRoot();
      expect(asset.listMeshes(), `${variant} meshes`).toHaveLength(0);
      expect(asset.listMaterials(), `${variant} materials`).toHaveLength(0);
      expect(asset.listTextures(), `${variant} textures`).toHaveLength(0);
      expect(asset.listAnimations(), `${variant} animations`).toHaveLength(1);
      expect(asset.listAnimations()[0].listChannels(), `${variant} channels`).toHaveLength(72);
    }
  });
});

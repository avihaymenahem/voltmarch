import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createInfantryPackGeometry,
  createInfantryWeaponGeometry,
  infantryAttachmentTriangles,
} from '@voltmarch/assets/runtime/infantry-attachments.mjs';
import { IMPORTED_INFANTRY_FAMILIES } from '../src/art/ImportedInfantryAssets';

describe('shared authored infantry runtime', () => {
  it('maps one body to line, specialist and engineer roles for all four factions', () => {
    expect(IMPORTED_INFANTRY_FAMILIES).toHaveLength(4);
    const modelKeys = new Set<string>();
    for (const family of IMPORTED_INFANTRY_FAMILIES) {
      expect(family.roles).toHaveLength(3);
      expect(family.url).toMatch(/-lod0\.glb/);
      expect(family.clipUrl).toMatch(/-run-shoot\.glb/);
      for (const role of family.roles) modelKeys.add(role.modelKey);
    }
    expect(modelKeys.size).toBe(12);
  });

  it('keeps every modular role part beneath the 200-triangle ceiling', () => {
    for (const family of IMPORTED_INFANTRY_FAMILIES) {
      for (const role of family.roles) {
        const weapon = createInfantryWeaponGeometry(role.weapon);
        expect(infantryAttachmentTriangles(weapon)).toBeLessThanOrEqual(200);
        weapon.dispose();
        if (role.pack === undefined) continue;
        const pack = createInfantryPackGeometry(role.pack);
        expect(infantryAttachmentTriangles(pack)).toBeLessThanOrEqual(200);
        pack.dispose();
      }
    }
  });

  it('bakes and discards the rig before handing ordinary geometry to RenderBridge', () => {
    const sourcePath = fileURLToPath(new URL('../src/art/ImportedInfantryAssets.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain('mesh.applyBoneTransform');
    expect(source).toContain("geometry.deleteAttribute('skinIndex')");
    expect(source).toContain('mixer.uncacheRoot(root)');
    // A geometry-only LOD cannot swap the authored atlas material. The old
    // single-texel box proxy made distant infantry look unloaded, so keep the
    // inexpensive 4.5k-triangle authored body until a real textured LOD ships.
    expect(source).not.toContain('farBody');
    expect(source).not.toContain('lods:');
    expect(source).not.toContain('SkeletonUtils.clone');
    expect(source).not.toContain('AnimationMixer(model');
  });
});

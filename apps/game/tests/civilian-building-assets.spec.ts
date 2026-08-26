import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/asset-families/civilian-buildings.json'),
  'utf8',
));
const sourceDir = path.join(root, manifest.sourceDir);
const compressedDir = path.join(sourceDir, 'compressed');
const derivedDir = path.join(root, manifest.outputDir);
const compression = JSON.parse(fs.readFileSync(
  path.join(compressedDir, 'texture-compression-report.json'),
  'utf8',
));
const optimization = JSON.parse(fs.readFileSync(
  path.join(derivedDir, 'optimization-report.json'),
  'utf8',
));

function glbJson(file: string): Record<string, any> {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

describe('the imported civilian building family', () => {
  it('ships the Oil Derrick, Hospital and Apartment Block inside explicit geometry and transfer budgets', () => {
    expect(manifest.assets.map((asset: any) => asset.key)).toEqual([
      'civ_derrick',
      'civ_hospital',
      'civ_apartments',
    ]);
    expect(compression.rows).toHaveLength(3);
    expect(optimization.rows).toHaveLength(3);

    const triangleCaps: Record<string, number> = {
      civ_derrick: 20_000,
      civ_hospital: 40_000,
      civ_apartments: 40_000,
    };
    const transferCaps: Record<string, number> = {
      civ_derrick: 3.25 * 1024 * 1024,
      civ_hospital: 4.25 * 1024 * 1024,
      civ_apartments: 4.25 * 1024 * 1024,
    };

    for (const asset of manifest.assets) {
      const row = optimization.rows.find((candidate: any) => candidate.key === asset.key);
      expect(row.source.triangles, asset.key).toBeLessThanOrEqual(triangleCaps[asset.key]);

      const promoted = path.join(compressedDir, asset.file);
      expect(fs.statSync(promoted).size, asset.key).toBeLessThanOrEqual(transferCaps[asset.key]);
      const json = glbJson(promoted);
      expect(json.materials, asset.key).toHaveLength(1);
      expect(json.extensionsRequired, asset.key).toContain('KHR_texture_basisu');
      expect(json.images, asset.key).toHaveLength(3);
      expect(json.images.every((image: any) => image.mimeType === 'image/ktx2'), asset.key).toBe(true);
    }
  });

  it('uses reviewed LOD0 silhouettes and bounded geometry-only shadow proxies', () => {
    for (const row of optimization.rows) {
      const lods = row.outputs.filter((output: any) => output.profile.startsWith('lod'));
      if (row.key === 'civ_apartments') {
        expect(lods.find((output: any) => output.profile === 'lod1')?.status).toBe('candidate');
        expect(lods.find((output: any) => output.profile === 'lod1')?.triangles).toBeLessThanOrEqual(15_000);
        expect(lods.find((output: any) => output.profile === 'lod2')?.status).toBe('blocked');
      } else {
        expect(lods, row.key).toHaveLength(0);
      }
      const shadow = row.outputs.find((output: any) => output.profile === 'shadow');
      expect(shadow.status, row.key).toBe('candidate');
      expect(shadow.triangles, row.key).toBeLessThanOrEqual(3_000);
      expect(fs.existsSync(path.resolve(shadow.file)), row.key).toBe(true);
      expect(glbJson(path.resolve(shadow.file)).images ?? [], row.key).toHaveLength(0);
    }
  });

  it('keeps all civilian replacements faction-neutral in runtime registration', () => {
    const source = fs.readFileSync(path.join(root, 'apps/game/src/art/buildings.system.ts'), 'utf8');
    expect(source).toContain("key: 'civ_derrick'");
    expect(source).toContain("civilian/compressed/oil-derrick.glb");
    expect(source).toContain("key: 'civ_hospital'");
    expect(source).toContain("civilian/compressed/hospital.glb");
    expect(source).toContain("key: 'civ_apartments'");
    expect(source).toContain("civilian/compressed/apartment-block.glb");
    expect(source).toContain("civilian/derived/apartment-block.lod1.glb");
    expect(source).toContain('...IMPORTED_CIVILIAN_STRUCTURES');
    expect(source).toContain("civOilDerrick: 'civ_derrick'");
    expect(source).toContain("civHospital: 'civ_hospital'");
    expect(source).toContain("civApartments: 'civ_apartments'");
  });
});

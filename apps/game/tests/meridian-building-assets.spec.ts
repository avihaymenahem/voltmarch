import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/asset-families/meridian-buildings.json'), 'utf8',
));
const sourceDir = path.join(root, manifest.sourceDir);
const compressedDir = path.join(sourceDir, 'compressed');
const derivedDir = path.join(root, manifest.outputDir);
const compression = JSON.parse(fs.readFileSync(
  path.join(compressedDir, 'texture-compression-report.json'), 'utf8',
));
const optimization = JSON.parse(fs.readFileSync(
  path.join(derivedDir, 'optimization-report.json'), 'utf8',
));
const runtime = fs.readFileSync(path.join(root, 'apps/game/src/art/Faction3Buildings.ts'), 'utf8');

function glbJson(file: string): Record<string, any> {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

describe('the imported Meridian building family', () => {
  it('ships sixteen single-material KTX2 PBR replacements inside the building budget', () => {
    expect(manifest.assets).toHaveLength(16);
    expect(compression.rows).toHaveLength(16);
    expect(optimization.rows).toHaveLength(15);

    for (const asset of manifest.assets) {
      const promoted = path.join(compressedDir, asset.file);
      expect(fs.existsSync(promoted), asset.key).toBe(true);
      const json = glbJson(promoted);
      expect(json.materials, asset.key).toHaveLength(1);
      expect(json.extensionsRequired, asset.key).toContain('KHR_texture_basisu');
      expect(json.images, asset.key).toHaveLength(3);
      expect(json.images.every((image: any) => image.mimeType === 'image/ktx2'), asset.key).toBe(true);

      const compressed = compression.rows.find((candidate: any) => candidate.key === asset.key);
      expect(compressed.outputFileBytes, asset.key).toBeLessThan(compressed.sourceFileBytes);
      expect(compressed.compressedGpuBytes8bpp, asset.key)
        .toBeLessThanOrEqual(compressed.sourceGpuBytesRGBA8 / 4);

      const row = optimization.rows.find((candidate: any) => candidate.key === asset.key);
      if (asset.key === 'meridian_helios') {
        expect(row, 'moving Helios deliberately has no fused derived geometry').toBeUndefined();
      } else {
        expect(row.source.triangles, asset.key).toBeGreaterThanOrEqual(7_000);
        expect(row.source.triangles, asset.key).toBeLessThanOrEqual(50_000);
      }
    }
  });

  it('keeps bounded casters for static models and colour LODs only where declared', () => {
    for (const row of optimization.rows) {
      const asset = manifest.assets.find((candidate: any) => candidate.key === row.key);
      const shadow = row.outputs.find((output: any) => output.profile === 'shadow');
      expect(shadow.status, `${row.key} shadow`).toBe('candidate');
      expect(shadow.triangles, `${row.key} shadow`).toBeLessThanOrEqual(3_200);
      const expected = [shadow];
      if (asset.lods) {
        const lod1 = row.outputs.find((output: any) => output.profile === 'lod1');
        expect(lod1.status, `${row.key} LOD1`).toBe('candidate');
        expected.push(lod1);
      }
      for (const output of expected) {
        expect(fs.existsSync(path.resolve(output.file)), `${row.key}:${output.profile}`).toBe(true);
        expect(glbJson(path.resolve(output.file)).images ?? []).toHaveLength(0);
      }
    }
  });

  it('registers complete replacements while preserving procedural socket authority', () => {
    for (const key of [
      'meridian_conclave', 'meridian_solararray', 'meridian_cistern',
      'meridian_chapterhouse', 'meridian_forgeyard',
      'meridian_pharos', 'meridian_reliquary', 'meridian_depot', 'meridian_slipway',
      'meridian_vault', 'meridian_rampart', 'meridian_heliograph',
    ]) {
      const block = runtime.match(new RegExp(`key: '${key}',[\\s\\S]*?proceduralParts: 'none'`))?.[0];
      expect(block, key).toBeDefined();
      expect(block, `${key} caster inset`).toContain('shadowInset: 0.985');
    }
    for (const key of ['meridian_oculus', 'meridian_helios']) {
      const block = runtime.match(new RegExp(`key: '${key}',[\\s\\S]*?style: MERIDIAN_IMPORTED_STYLE`))?.[0];
      expect(block, key).toContain("proceduralParts: 'none'");
      expect(block, `${key} articulated`).toContain('movingTurret:');
    }
    expect(runtime).toContain('const imported = importedMeshes.get(key)');
    expect(runtime).toContain('meridianBuildingLibrary.depthMaterial()');
  });
});

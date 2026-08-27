import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const manifestPath = path.join(root, 'tools/asset-families/allied-buildings.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sourceDir = path.join(root, manifest.sourceDir);
const compressedDir = path.join(sourceDir, 'compressed');
const derivedDir = path.join(root, manifest.outputDir);
const compression = JSON.parse(fs.readFileSync(path.join(compressedDir, 'texture-compression-report.json'), 'utf8'));
const optimization = JSON.parse(fs.readFileSync(path.join(derivedDir, 'optimization-report.json'), 'utf8'));

function glbJson(file: string): Record<string, any> {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

describe('the Allied imported building roster', () => {
  it('ships sixteen one-material KTX2 PBR replacements within their geometry gates', () => {
    expect(manifest.assets).toHaveLength(16);
    expect(compression.rows).toHaveLength(manifest.assets.length);
    expect(optimization.rows).toHaveLength(manifest.assets.length);

    for (const asset of manifest.assets) {
      const source = path.join(sourceDir, asset.file);
      const promoted = path.join(compressedDir, asset.file);
      const sourceRow = optimization.rows.find((row: any) => row.key === asset.key);
      expect(fs.existsSync(source), asset.key).toBe(true);
      expect(fs.existsSync(promoted), asset.key).toBe(true);
      const [minimum, maximum] = asset.class === 'defence' || asset.class === 'utility'
        ? [8_000, 14_000]
        : [24_000, 40_000];
      expect(sourceRow.source.triangles, asset.key).toBeGreaterThanOrEqual(minimum);
      expect(sourceRow.source.triangles, asset.key).toBeLessThanOrEqual(maximum);

      const json = glbJson(promoted);
      expect(json.materials, asset.key).toHaveLength(1);
      expect(json.extensionsRequired, asset.key).toContain('KHR_texture_basisu');
      expect(json.images, asset.key).toHaveLength(3);
      expect(json.images.every((image: any) => image.mimeType === 'image/ktx2'), asset.key).toBe(true);

      const compressionRow = compression.rows.find((row: any) => row.key === asset.key);
      expect(compressionRow.outputFileBytes, asset.key).toBeLessThan(compressionRow.sourceFileBytes);
      expect(compressionRow.compressedGpuBytes8bpp, asset.key)
        .toBeLessThanOrEqual(compressionRow.sourceGpuBytesRGBA8 / 4);
    }
  });

  it('keeps approved colour LODs where simplification passes and a bounded shadow proxy for every building', () => {
    for (const row of optimization.rows) {
      const asset = manifest.assets.find((candidate: any) => candidate.key === row.key);
      const lod1 = row.outputs.find((output: any) => output.profile === 'lod1');
      const shadow = row.outputs.find((output: any) => output.profile === 'shadow');
      if (asset.lods === true) expect(['candidate', 'blocked'], `${row.key} LOD1`).toContain(lod1.status);
      else expect(lod1, `${row.key} intentionally has no distance LOD`).toBeUndefined();
      expect(shadow.status, `${row.key} shadow`).toBe('candidate');
      expect(shadow.triangles, `${row.key} shadow`).toBeLessThanOrEqual(3_000);

      for (const output of [lod1, shadow].filter((candidate) => candidate?.status === 'candidate')) {
        const file = path.resolve(output.file);
        expect(fs.existsSync(file), `${row.key}:${output.profile}`).toBe(true);
        expect(fs.statSync(file).size).toBe(output.fileBytes);
        const json = glbJson(file);
        expect(json.images ?? []).toHaveLength(0);
      }
    }
  });
});

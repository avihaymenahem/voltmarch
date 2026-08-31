import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface FamilyManifest {
  sourceDir: string;
  outputDir: string;
  profiles: { shadow: { maxRatio: number; maxTriangles: number } };
  assets: Array<{ key: string; file: string; lods: boolean }>;
}

interface OutputReport {
  profile: 'lod1' | 'lod2' | 'shadow';
  status: 'candidate' | 'blocked';
  file: string;
  triangles: number;
  triangleRatio: number;
  boundsDriftRatio: number;
  fileBytes: number;
  geometryOnly: boolean;
}

interface OptimizationReport {
  family: string;
  write: boolean;
  rows: Array<{
    key: string;
    source: { file: string; triangles: number; fileBytes: number };
    outputs: OutputReport[];
  }>;
}

interface GlbJson {
  images?: unknown[];
  materials?: unknown[];
  meshes?: Array<{
    primitives?: Array<{ attributes?: Record<string, number> }>;
  }>;
  extensionsRequired?: string[];
}

const MANIFEST_PATH = path.resolve('tools/asset-families/soviet-buildings.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as FamilyManifest;
const reportPath = path.resolve(manifest.outputDir, 'optimization-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as OptimizationReport;

function readGlbJson(file: string): GlbJson {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbJson;
}

describe('reusable asset optimization pipeline', () => {
  it('audits every Soviet imported building without replacing LOD0', () => {
    expect(manifest.assets).toHaveLength(17);
    expect(report.family).toBe('soviet-buildings');
    expect(report.write).toBe(true);
    expect(report.rows.map((row) => row.key)).toEqual(manifest.assets.map((asset) => asset.key));

    for (const asset of manifest.assets) {
      expect(fs.existsSync(path.resolve(manifest.sourceDir, asset.file))).toBe(true);
      const row = report.rows.find((candidate) => candidate.key === asset.key);
      expect(row?.source.file).toBe(`${manifest.sourceDir}/${asset.file}`);
    }
  });

  it('produces a bounded, texture-free shadow proxy for every building', () => {
    for (const row of report.rows) {
      const output = row.outputs.find((candidate) => candidate.profile === 'shadow');
      expect(output, `${row.key} has no shadow output`).toBeDefined();
      expect(output?.status, `${row.key} shadow proxy was blocked`).toBe('candidate');
      expect(output?.geometryOnly).toBe(true);
      expect(output?.boundsDriftRatio).toBeLessThanOrEqual(0.02);
      expect(
        output!.triangles <= manifest.profiles.shadow.maxTriangles
          || output!.triangleRatio <= manifest.profiles.shadow.maxRatio,
      ).toBe(true);

      const outputPath = path.resolve(output!.file);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.statSync(outputPath).size).toBe(output!.fileBytes);
      const json = readGlbJson(outputPath);
      expect(json.images ?? []).toHaveLength(0);
      expect(json.materials ?? []).toHaveLength(0);
    }
  });

  it('keeps only valid colour LOD candidates and records difficult meshes as blocked', () => {
    const candidates = new Set([
      'soviet_warfactory:lod1',
      'soviet_warfactory:lod2',
      'soviet_refinery:lod1',
      'soviet_refinery:lod2',
      'soviet_barracks:lod1',
      'soviet_radar:lod1',
      'soviet_commandpost:lod1',
      'soviet_subpen:lod1',
      'soviet_nuke:lod1',
      'soviet_silo:lod1',
      'soviet_power:lod1',
      'soviet_power:lod2',
      'soviet_flametower:lod1',
      'soviet_airbase:lod1',
      'soviet_airbase:lod2',
    ]);

    for (const row of report.rows) {
      for (const output of row.outputs.filter((candidate) => candidate.profile !== 'shadow')) {
        const key = `${row.key}:${output.profile}`;
        expect(output.status).toBe(candidates.has(key) ? 'candidate' : 'blocked');
        expect(output.boundsDriftRatio).toBeLessThanOrEqual(0.02);
        const outputPath = path.resolve(output.file);
        expect(fs.existsSync(outputPath)).toBe(output.status === 'candidate');
        if (output.status === 'candidate') {
          const json = readGlbJson(outputPath);
          expect(json.images ?? []).toHaveLength(0);
          const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
          expect(primitives.length).toBeGreaterThan(0);
          for (const primitive of primitives) {
            expect(primitive.attributes?.TEXCOORD_0, `${key} lost the LOD0 UV channel`).toBeDefined();
            expect(primitive.attributes?.NORMAL, `${key} lost the LOD0 normal channel`).toBeDefined();
          }
          expect(json.extensionsRequired).toContain('KHR_mesh_quantization');
        }
      }
    }
  });
});

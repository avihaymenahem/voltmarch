import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceDir = path.join(root, 'src/assets/buildings/soviets');
const compressedDir = path.join(sourceDir, 'compressed');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/asset-families/soviet-buildings.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(compressedDir, 'texture-compression-report.json'), 'utf8'));

function glbJson(file: string): Record<string, any> {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

describe('the imported Soviet family ships through KTX2/Basis', () => {
  it('promotes every manifest LOD0 with required KHR_texture_basisu images', () => {
    expect(report.rows).toHaveLength(manifest.assets.length);
    for (const asset of manifest.assets) {
      const output = path.join(compressedDir, asset.file);
      expect(fs.existsSync(output), asset.key).toBe(true);
      const json = glbJson(output);
      expect(json.extensionsUsed, asset.key).toContain('KHR_texture_basisu');
      expect(json.extensionsRequired, asset.key).toContain('KHR_texture_basisu');
      expect(json.images?.length, asset.key).toBeGreaterThan(0);
      expect(json.images.every((image: any) => image.mimeType === 'image/ktx2'), asset.key).toBe(true);
      expect(
        json.textures.every((texture: any) => texture.extensions?.KHR_texture_basisu?.source !== undefined),
        asset.key,
      ).toBe(true);
    }
  });

  it('reduces both transfer bytes and conservative desktop GPU residency per asset', () => {
    for (const row of report.rows) {
      expect(row.outputFileBytes, row.key).toBeLessThan(row.sourceFileBytes);
      expect(row.compressedGpuBytes8bpp, row.key).toBeLessThanOrEqual(row.sourceGpuBytesRGBA8 / 4);
      expect(row.textures.every((texture: any) => texture.ktx2Bytes > 0), row.key).toBe(true);
    }
    expect(report.totals.transferRatio).toBeLessThanOrEqual(0.80);
    expect(report.totals.compressedGpuBytes8bpp / report.totals.sourceGpuBytesRGBA8)
      .toBeLessThanOrEqual(0.17);
  });

  it('keeps the matching Three transcoder and loader wired into WebGL and WebGPU', () => {
    const runtime = fs.readFileSync(path.join(root, 'src/art/buildings.system.ts'), 'utf8');
    const sharedLoader = fs.readFileSync(path.join(root, 'src/art/RuntimeKTX2Loader.ts'), 'utf8');
    expect(runtime).toContain("from './RuntimeKTX2Loader'");
    expect(runtime).toContain('handle.node ?? handle.webgl');
    expect(sharedLoader).toContain("from 'three/examples/jsm/loaders/KTX2Loader.js'");
    expect(sharedLoader).toContain('.detectSupport(renderer');
    expect(sharedLoader).toContain('new KTX2Loader().setWorkerLimit(2)');
    expect(sharedLoader).toContain('if (import.meta.env.DEV)');
    expect(sharedLoader).toContain("loader.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/')");
    expect(sharedLoader).toContain('consumers++');
    expect(fs.existsSync(path.join(root, 'public/basis'))).toBe(false);
    for (const asset of manifest.assets) {
      expect(runtime, asset.key).toContain(`soviets/compressed/${asset.file}`);
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pocDir = path.join(root, 'packages/assets/game/units/allies/compressed');

function glbJson(file: string): Record<string, any> {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

describe('the Meshopt WebAssembly loading POC', () => {
  it('keeps KTX2 while compressing Chrono Miner geometry', () => {
    const report = JSON.parse(fs.readFileSync(path.join(pocDir, 'meshopt-poc-report.json'), 'utf8'));
    const source = path.join(pocDir, report.source);
    const output = path.join(pocDir, report.output);
    const json = glbJson(output);

    expect(fs.statSync(source).size).toBe(report.sourceBytes);
    expect(fs.statSync(output).size).toBe(report.outputBytes);
    expect(report.outputBytes / report.sourceBytes).toBeLessThanOrEqual(0.65);
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.extensionsRequired).toContain('KHR_mesh_quantization');
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
  });

  it('installs one shared decoder policy in every shipping GLB loader', () => {
    const helper = fs.readFileSync(path.join(root, 'apps/game/src/art/RuntimeGLTFLoader.ts'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'packages/gltf-runtime/src/gltf.ts'), 'utf8');
    expect(helper).toContain("from '@voltmarch/gltf-runtime/gltf'");
    expect(helper).toContain('createGltfLoader()');
    expect(shared).toContain("from 'three/examples/jsm/libs/meshopt_decoder.module.js'");
    expect(shared).toContain('new GLTFLoader(options.manager).setMeshoptDecoder(MeshoptDecoder)');

    for (const relative of [
      'apps/game/src/art/ImportedUnitAssets.ts',
      'apps/game/src/art/ImportedInfantryAssets.ts',
      'apps/game/src/art/ImportedWreckAssets.ts',
      'apps/game/src/art/buildings.system.ts',
      'apps/game/src/world/EnvironmentAssetLoader.ts',
    ]) {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(source, relative).toContain('createRuntimeGLTFLoader');
      expect(source, relative).not.toContain('new GLTFLoader()');
    }
  });

  it('points the live Allied harvester at the compressed POC', () => {
    const runtime = fs.readFileSync(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
    expect(runtime).toContain('compressed/chrono-miner.meshopt.glb');
  });

  it('promotes the complete Allied land/air slice with exact structural contracts', () => {
    const report = JSON.parse(fs.readFileSync(
      path.join(pocDir, 'allied-land-air.meshopt-report.json'), 'utf8',
    ));
    expect(report.rows).toHaveLength(6);
    expect(report.savedBytes).toBe(11_228_312);
    expect(report.transferRatio).toBeLessThanOrEqual(0.567);
    expect(report.geometryDriftGate.maximumRelativeBoundsDriftPercent).toBeLessThan(0.1);
    expect(report.geometryDriftGate.unmatchedPositions).toBe(0);

    for (const row of report.rows) {
      const source = path.join(pocDir, row.file);
      const output = path.join(pocDir, row.output);
      expect(fs.statSync(source).size, row.key).toBe(row.sourceBytes);
      expect(fs.statSync(output).size, row.key).toBe(row.outputBytes);
      expect(row.outputBytes, row.key).toBeLessThan(row.sourceBytes);
      const json = glbJson(output);
      expect(json.extensionsRequired, row.key).toContain('EXT_meshopt_compression');
      expect(json.extensionsRequired, row.key).toContain('KHR_mesh_quantization');
      expect(json.extensionsRequired, row.key).toContain('KHR_texture_basisu');
      expect(row.contract.ktx2Textures, row.key).toBeGreaterThan(0);
    }
  });

  it('selects one packaged land/air transport arm at build time', () => {
    const runtime = fs.readFileSync(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
    const vite = fs.readFileSync(path.join(root, 'apps/game/vite.config.ts'), 'utf8');
    for (const stem of [
      'guardian-tank', 'sabre-ifv', 'refractor-tank',
      'construction-dozer', 'petrel-bomber', 'albatross-heavy-bomber',
    ]) {
      expect(runtime).toContain(`@allied-${stem}-runtime?url`);
      expect(vite).toContain(`'${stem}'`);
    }
    expect(vite).toContain("process.env.VM_ALLIED_MESHOPT_ARM?.trim() || 'control'");
  });
});

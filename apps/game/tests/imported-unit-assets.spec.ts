import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

interface AssetFamily {
  name: string;
  manifest: string;
  sourceDir: string;
  key: string;
  file: string;
  stem: string;
}

const FAMILIES: readonly AssetFamily[] = [
  { name: 'Soviet Ore Collector', manifest: 'soviet-vehicles.json', sourceDir: 'soviets', key: 'soviet_harvester', file: 'ore-collector.glb', stem: 'ore-collector' },
  { name: 'Allied Chrono Miner', manifest: 'allied-vehicles.json', sourceDir: 'allies', key: 'allied_harvester', file: 'chrono-miner.glb', stem: 'chrono-miner' },
  { name: 'Meridian Sun Collector', manifest: 'meridian-vehicles.json', sourceDir: 'meridian', key: 'meridian_collector', file: 'sun-collector.glb', stem: 'sun-collector' },
  { name: 'Reclamation Scrapjaw', manifest: 'reclamation-vehicles.json', sourceDir: 'reclamation', key: 'reclaim_scrapper', file: 'scrapjaw.glb', stem: 'scrapjaw' },
  { name: 'Allied Construction Dozer', manifest: 'allied-vehicles.json', sourceDir: 'allies', key: 'allied_dozer', file: 'construction-dozer.glb', stem: 'construction-dozer' },
  { name: 'Allied Petrel Bomber', manifest: 'allied-vehicles.json', sourceDir: 'allies', key: 'allied_vindicator', file: 'petrel-bomber.glb', stem: 'petrel-bomber' },
  { name: 'Soviet Sputnik Dozer', manifest: 'soviet-vehicles.json', sourceDir: 'soviets', key: 'soviet_dozer', file: 'sputnik-dozer.glb', stem: 'sputnik-dozer' },
  { name: 'Soviet Interceptor', manifest: 'soviet-vehicles.json', sourceDir: 'soviets', key: 'soviet_mig', file: 'interceptor.glb', stem: 'interceptor' },
  { name: 'Meridian Pactworks Carryall', manifest: 'meridian-vehicles.json', sourceDir: 'meridian', key: 'meridian_carryall', file: 'pactworks-carryall.glb', stem: 'pactworks-carryall' },
  { name: 'Meridian Kestrel Gunship', manifest: 'meridian-vehicles.json', sourceDir: 'meridian', key: 'meridian_kestrel', file: 'kestrel-gunship.glb', stem: 'kestrel-gunship' },
  { name: 'Reclamation Yardcrawler', manifest: 'reclamation-vehicles.json', sourceDir: 'reclamation', key: 'reclaim_crawler', file: 'yardcrawler.glb', stem: 'yardcrawler' },
  { name: 'Reclamation Swarmhornet', manifest: 'reclamation-vehicles.json', sourceDir: 'reclamation', key: 'reclaim_hornet', file: 'swarmhornet.glb', stem: 'swarmhornet' },
];

interface GlbJson {
  accessors: Array<{ count: number }>;
  images?: Array<{ mimeType?: string }>;
  materials?: Array<{ doubleSided?: boolean }>;
  meshes: Array<{ name?: string; primitives: Array<{ indices?: number; attributes: { POSITION: number } }> }>;
  nodes: Array<{ name?: string; mesh?: number }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

interface AssetManifest {
  assets: Array<{ key: string; file: string; lods: boolean }>;
}

function familyPath(family: AssetFamily, ...parts: string[]): string {
  return path.join(root, 'apps/game/src/assets/units', family.sourceDir, ...parts);
}

function glbJson(file: string): { bytes: Buffer; json: GlbJson } {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0), file).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4), file).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbJson;
  return { bytes, json };
}

function triangles(json: GlbJson): number {
  return json.meshes.flatMap((mesh) => mesh.primitives).reduce((sum, primitive) => {
    const accessor = primitive.indices ?? primitive.attributes.POSITION;
    return sum + json.accessors[accessor].count / 3;
  }, 0);
}

describe('imported unit shipping budgets', () => {
  for (const family of FAMILIES) {
    describe(family.name, () => {
      it('stays inside the approved 50k hero-unit envelope', () => {
        const source = glbJson(familyPath(family, family.file));
        expect(source.json.meshes).toHaveLength(1);
        expect(source.json.meshes[0].primitives).toHaveLength(1);
        expect(source.json.meshes[0].name).toBe('Hull');
        expect(source.json.nodes.find((node) => node.mesh !== undefined)?.name).toBe('Hull');
        expect(source.json.materials?.every((material) => material.doubleSided !== true)).toBe(true);
        expect(triangles(source.json)).toBeLessThanOrEqual(50_000);
        expect(source.bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
      });

      it('ships meaningful geometry-only LODs and a cheap shadow proxy', () => {
        const lod1 = glbJson(familyPath(family, 'derived', `${family.stem}.lod1.glb`));
        const lod2 = glbJson(familyPath(family, 'derived', `${family.stem}.lod2.glb`));
        const shadow = glbJson(familyPath(family, 'derived', `${family.stem}.shadow.glb`));
        expect(triangles(lod1.json)).toBeLessThanOrEqual(25_000);
        expect(triangles(lod2.json)).toBeLessThanOrEqual(16_000);
        expect(triangles(shadow.json)).toBeLessThanOrEqual(3_000);
        expect(lod1.json.images ?? []).toHaveLength(0);
        expect(lod2.json.images ?? []).toHaveLength(0);
        expect(shadow.json.images ?? []).toHaveLength(0);
        for (const lod of [lod1, lod2]) {
          expect(lod.json.meshes[0].name).toBe('Hull');
          expect(lod.json.nodes.find((node) => node.mesh !== undefined)?.name).toBe('Hull');
        }
      });

      it('uses required KTX2 textures and is smaller on disk', () => {
        const compressedDir = familyPath(family, 'compressed');
        const report = JSON.parse(
          fs.readFileSync(path.join(compressedDir, 'texture-compression-report.json'), 'utf8'),
        ) as { rows: Array<{ key: string; outputFileBytes: number; sourceFileBytes: number }> };
        const { json } = glbJson(path.join(compressedDir, family.file));
        expect(json.extensionsUsed).toContain('KHR_texture_basisu');
        expect(json.extensionsRequired).toContain('KHR_texture_basisu');
        expect(json.images?.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
        const row = report.rows.find((candidate) => candidate.key === family.key);
        expect(row).toBeDefined();
        expect(row!.outputFileBytes).toBeLessThan(row!.sourceFileBytes);
      });

      it('remains wired to the imported-unit runtime and its faction registry', () => {
        const runtime = fs.readFileSync(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
        expect(runtime).toContain(`key: '${family.key}'`);
        expect(runtime).toContain(`${family.sourceDir}/compressed/${family.file}`);
        expect(runtime).toContain(`${family.sourceDir}/derived/${family.stem}.lod1.glb`);
        expect(runtime).toContain(`${family.sourceDir}/derived/${family.stem}.lod2.glb`);
        expect(runtime).toContain(`${family.sourceDir}/derived/${family.stem}.shadow.glb`);
        if (family.sourceDir === 'meridian') {
          const registry = fs.readFileSync(path.join(root, 'apps/game/src/art/Faction3Units.ts'), 'utf8');
          expect(registry).toContain(`'${family.key}'`);
          expect(registry).toContain('await loadImportedUnitOverride(model, spec)');
        }
        if (family.sourceDir === 'reclamation') {
          const registry = fs.readFileSync(path.join(root, 'apps/game/src/art/Faction4Units.ts'), 'utf8');
          expect(registry).toContain(`'${family.key}'`);
          expect(registry).toContain('await loadImportedUnitOverride(model, spec)');
        }
      });
    });
  }

  it('keeps every asset-family manifest entry promoted to KTX2', () => {
    for (const family of FAMILIES) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, 'tools/asset-families', family.manifest), 'utf8'),
      ) as AssetManifest;
      const report = JSON.parse(
        fs.readFileSync(familyPath(family, 'compressed', 'texture-compression-report.json'), 'utf8'),
      ) as { rows: Array<{ key: string }> };
      expect(report.rows).toHaveLength(manifest.assets.length);
      for (const asset of manifest.assets) {
        const { json } = glbJson(familyPath(family, 'compressed', asset.file));
        expect(json.extensionsRequired, asset.key).toContain('KHR_texture_basisu');
        expect(json.images?.every((image) => image.mimeType === 'image/ktx2'), asset.key).toBe(true);
      }
    }
  });

  it('keeps the Sputnik Dozer hull on its approved runtime axis', () => {
    const runtime = fs.readFileSync(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
    const dozer = runtime.slice(runtime.indexOf("key: 'soviet_dozer'"), runtime.indexOf("key: 'soviet_mig'"));
    expect(dozer).toContain('yawDeg: -90');
    expect(dozer).toContain('Rotate the complete vehicle together');
  });

  it('loads every private-faction construction vehicle before publishing its registry', () => {
    for (const contract of [
      { file: 'Faction3Units.ts', key: 'meridian_carryall' },
      { file: 'Faction4Units.ts', key: 'reclaim_crawler' },
    ]) {
      const source = fs.readFileSync(path.join(root, 'apps/game/src/art', contract.file), 'utf8');
      const key = source.indexOf(`'${contract.key}'`);
      const imported = source.indexOf('meshes.set(key, await loadImportedUnitOverride');
      const published = source.indexOf('for (const [contentKey, modelKey] of Object.entries(');
      expect(key, contract.file).toBeGreaterThanOrEqual(0);
      expect(imported, contract.file).toBeGreaterThan(key);
      expect(published, contract.file).toBeGreaterThan(imported);
    }
  });
});

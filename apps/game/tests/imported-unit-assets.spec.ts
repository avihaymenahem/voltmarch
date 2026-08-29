import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  assertImportedHorizontalEnvelope, IMPORTED_UNIT_SPECS,
} from '../src/art/ImportedUnitAssets';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';
import { NAVAL_UNIT_DIMENSIONS } from '../src/core/config';

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
  return path.join(root, 'packages/assets/game/units', family.sourceDir, ...parts);
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

  it('ships both naval conversion waves with their authored articulation contract', () => {
    const ships = [
      { key: 'allied_hydrofoil', faction: 'allies', file: 'hydrofoil.glb', meshes: ['Hull', 'Turret'] },
      { key: 'soviet_picket', faction: 'soviets', file: 'picket-boat.glb', meshes: ['Hull', 'Turret'] },
      { key: 'meridian_cutter', faction: 'meridian', file: 'sun-cutter.glb', meshes: ['Hull', 'Turret'] },
      { key: 'reclaim_skimmer', faction: 'reclamation', file: 'scrap-skimmer.glb', meshes: ['Hull'] },
      { key: 'allied_gunboat', faction: 'allies', file: 'assault-destroyer.glb', meshes: ['Hull', 'Turret'] },
      { key: 'soviet_sub', faction: 'soviets', file: 'attack-submarine.glb', meshes: ['Hull'] },
      { key: 'meridian_corvette', faction: 'meridian', file: 'kite-corvette.glb', meshes: ['Hull', 'Turret'] },
      { key: 'reclaim_scow', faction: 'reclamation', file: 'slag-scow.glb', meshes: ['Hull'] },
      { key: 'allied_destroyer', faction: 'allies', file: 'aircraft-cruiser.glb', meshes: ['Hull', 'Turret'] },
      { key: 'soviet_dreadnought', faction: 'soviets', file: 'dreadnought.glb', meshes: ['Hull', 'Turret'] },
      { key: 'meridian_monitor', faction: 'meridian', file: 'sunmonitor.glb', meshes: ['Hull', 'Turret'] },
      { key: 'reclaim_hulk', faction: 'reclamation', file: 'reclaimed-hulk.glb', meshes: ['Hull', 'Turret'] },
      { key: 'soviet_transport', faction: 'soviets', file: 'hover-transport.glb', meshes: ['Hull'] },
      { key: 'soviet_lighter', faction: 'soviets', file: 'assault-barge.glb', meshes: ['Hull'] },
      { key: 'allied_transport', faction: 'allies', file: 'hover-transport.glb', meshes: ['Hull'] },
      { key: 'allied_lighter', faction: 'allies', file: 'landing-craft.glb', meshes: ['Hull'] },
      { key: 'meridian_lighter', faction: 'meridian', file: 'sun-lighter.glb', meshes: ['Hull'] },
      { key: 'meridian_argosy', faction: 'meridian', file: 'argosy.glb', meshes: ['Hull'] },
      { key: 'reclaim_hauler', faction: 'reclamation', file: 'slag-hauler.glb', meshes: ['Hull'] },
    ] as const;
    const runtime = fs.readFileSync(
      path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8',
    );
    for (const ship of ships) {
      const sourceDir = path.join(root, 'packages/assets/game/units', ship.faction);
      const source = glbJson(path.join(sourceDir, ship.file));
      const compressed = glbJson(path.join(sourceDir, 'compressed', ship.file));
      expect(source.json.meshes.map((mesh) => mesh.name).sort(), ship.key)
        .toEqual([...ship.meshes].sort());
      expect(source.json.materials?.every((material) => material.doubleSided !== true)).toBe(true);
      expect(triangles(source.json), ship.key).toBeLessThanOrEqual(28_000);
      expect(compressed.bytes.length, ship.key).toBeLessThanOrEqual(7 * 1024 * 1024);
      expect(compressed.json.extensionsRequired, ship.key).toContain('KHR_texture_basisu');
      expect(compressed.json.images?.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
      expect(runtime).toContain(`key: '${ship.key}'`);
      expect(runtime).toContain(`${ship.faction}/compressed/${ship.file}`);
      const shadow = path.join(
        sourceDir, 'derived', `${path.basename(ship.file, '.glb')}.shadow.glb`,
      );
      expect(fs.existsSync(shadow), `${ship.key} shadow proxy`).toBe(true);
      expect(triangles(glbJson(shadow).json), ship.key).toBeLessThanOrEqual(2_000);
    }
  });

  it('loads every private-faction ship override before publishing its registry', () => {
    for (const contract of [
      {
        file: 'Faction3Units.ts',
        keys: [
          'meridian_cutter', 'meridian_corvette', 'meridian_monitor',
          'meridian_lighter', 'meridian_argosy',
        ],
      },
      {
        file: 'Faction4Units.ts',
        keys: ['reclaim_skimmer', 'reclaim_scow', 'reclaim_hulk', 'reclaim_hauler'],
      },
    ]) {
      const source = fs.readFileSync(path.join(root, 'apps/game/src/art', contract.file), 'utf8');
      const importsStart = source.indexOf('const importedKeys = [');
      const imports = source.slice(importsStart, source.indexOf('] as const;', importsStart));
      for (const key of contract.keys) expect(imports, `${contract.file}:${key}`).toContain(`'${key}'`);
      expect(source.indexOf('for (const key of importedKeys)'))
        .toBeLessThan(source.indexOf('for (const [contentKey, modelKey] of Object.entries('));
    }
  });

  it('keeps the final transport wave on its gameplay envelopes', () => {
    const targets = new Map(IMPORTED_UNIT_SPECS.map((spec) => [spec.key, spec.target] as const));
    expect(targets.get('soviet_transport')).toEqual([5.0, 3.4, 9.6]);
    expect(targets.get('soviet_lighter')).toEqual([5.2, 3.0, 11.0]);
    expect(targets.get('allied_transport')).toEqual([5.0, 3.4, 9.6]);
    expect(targets.get('allied_lighter')).toEqual([5.0, 3.0, 11.0]);
    expect(targets.get('meridian_lighter')).toEqual([5.0, 3.0, 11.2]);
    expect(targets.get('meridian_argosy')).toEqual([6.0, 3.6, 13.2]);
    expect(targets.get('reclaim_hauler')).toEqual([6.2, 3.6, 13.0]);
  });

  it('keeps the fleet-wide recon and Allied combat ladders synchronized', () => {
    const reconTargets = {
      allied_hydrofoil: [3.2, 2.8, 9.0],
      soviet_picket: [3.3, 2.9, 9.0],
      meridian_cutter: [3.3, 2.8, 9.2],
      reclaim_skimmer: [3.4, 2.8, 9.0],
    } as const;
    const targets = new Map(
      IMPORTED_UNIT_SPECS
        .filter((spec) => spec.key in reconTargets || spec.key === 'allied_gunboat')
        .map((spec) => [spec.key, spec.target] as const),
    );
    const hullLengths = new Map(
      [...UNIT_MASS_LISTS, ...MERIDIAN_UNIT_MASS_LISTS, ...RECLAIM_UNIT_MASS_LISTS]
        .map((model) => [model.key, model.hullLength] as const),
    );

    for (const [key, envelope] of Object.entries(reconTargets)) {
      expect(targets.get(key), key).toEqual(envelope);
      expect(hullLengths.get(key), key).toBe(envelope[2]);
    }
    expect(targets.get('allied_gunboat')).toEqual([4.0, 3.8, 12.0]);
    expect(hullLengths.get('allied_gunboat')).toBe(12.0);
    expect(hullLengths.get('allied_destroyer')).toBe(14.0);

    expect(NAVAL_UNIT_DIMENSIONS.recon).toMatchObject({ l: 9.0, w: 3.2, h: 2.8 });
    expect(NAVAL_UNIT_DIMENSIONS.gunboat).toMatchObject({ l: 12.0, w: 4.0, h: 3.8 });
    expect(NAVAL_UNIT_DIMENSIONS.gunboat.l)
      .toBeGreaterThan(NAVAL_UNIT_DIMENSIONS.recon.l * 1.25);
    expect(NAVAL_UNIT_DIMENSIONS.gunboat.l)
      .toBeLessThan(NAVAL_UNIT_DIMENSIONS.destroyer.l);
  });

  it('keeps the Assault Destroyer hull anchored to its articulated waterline', () => {
    const assault = UNIT_MASS_LISTS.find((model) => model.key === 'allied_gunboat');
    const imported = IMPORTED_UNIT_SPECS.find((spec) => spec.key === 'allied_gunboat');
    expect(assault).toBeDefined();
    expect(imported?.sourceTurretPivot).toBeDefined();
    expect(assault?.turretPivot).toBeDefined();
    // A missing target ring becomes [0,0,0] in UnitFactory. Aligning the
    // imported source ring to that point puts nearly its whole hull underwater.
    expect(assault!.turretPivot![1]).toBeGreaterThan(1.5);
    const foreMount = assault!.masses.filter((mass) => mass.name.startsWith('fore'));
    expect(foreMount).toHaveLength(3);
    expect(foreMount.every((mass) => mass.turret === true)).toBe(true);
  });

  it('rejects a microscopic post-fit Allied hull before registration', () => {
    const assault = IMPORTED_UNIT_SPECS.find((spec) => spec.key === 'allied_gunboat');
    expect(assault).toBeDefined();

    const fitted = new THREE.BoxGeometry(assault!.target[0], 1, assault!.target[2]);
    expect(() => assertImportedHorizontalEnvelope(fitted, assault!.target, assault!.label))
      .not.toThrow();

    const microscopic = new THREE.BoxGeometry(
      assault!.target[0] * 0.25, 1, assault!.target[2] * 0.25,
    );
    expect(() => assertImportedHorizontalEnvelope(microscopic, assault!.target, assault!.label))
      .toThrow(/fitted hull footprint/);

    fitted.dispose();
    microscopic.dispose();
  });
});

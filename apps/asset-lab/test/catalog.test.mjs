import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAssetCatalog, catalogSummary } from '../src/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ASSETS = path.join(ROOT, 'packages', 'assets', 'game');

async function findGlbs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? findGlbs(target) : (/\.glb$/i.test(entry.name) ? [target] : []);
  }));
  return nested.flat();
}

test('catalog groups every owned GLB without losing a delivery', async () => {
  const paths = await findGlbs(ASSETS);
  const entries = Object.fromEntries(paths.map((file) => [file, `file://${file.replaceAll('\\', '/')}`]));
  const catalog = buildAssetCatalog(entries);
  const summary = catalogSummary(catalog);
  assert.equal(summary.files, paths.length);
  assert.ok(summary.families > 80, `expected a full roster, found ${summary.families} families`);
  assert.deepEqual(new Set(catalog.map((asset) => asset.faction)), new Set(['allies', 'soviets', 'meridian', 'reclamation', 'civilian', 'neutral']));
});

test('infantry deliveries become one family with clips and gameplay LOD', async () => {
  const paths = (await findGlbs(ASSETS)).filter((file) => file.includes(`${path.sep}infantry-poc${path.sep}`));
  const catalog = buildAssetCatalog(Object.fromEntries(paths.map((file) => [file, file])));
  const peacekeeper = catalog.find((asset) => asset.slug === 'peacekeeper');
  const conscript = catalog.find((asset) => asset.slug === 'conscript');
  assert.ok(peacekeeper?.hasAnimations);
  assert.ok(conscript?.hasAnimations);
  assert.equal(peacekeeper.primary.variant, 'LOD0 · gameplay');
  assert.equal(conscript.primary.variant, 'LOD0 · gameplay');
});

test('commanders stay in Infantry and group gameplay, walk and run files', async () => {
  const paths = (await findGlbs(ASSETS)).filter((file) => file.includes(`${path.sep}commanders${path.sep}`));
  const catalog = buildAssetCatalog(Object.fromEntries(paths.map((file) => [file, file])));
  assert.equal(catalog.length, 4);
  for (const commander of catalog) {
    assert.equal(commander.category, 'Infantry');
    assert.equal(commander.primary.variant, 'LOD0 · gameplay');
    assert.equal(commander.variantCount, 3);
    assert.equal(commander.hasAnimations, true);
    assert.deepEqual(
      new Set(commander.files.map((file) => file.variant)),
      new Set(['LOD0 · gameplay', 'Animation · Walk', 'Animation · Run']),
    );
  }
});

test('the shipped roster uses gameplay roles rather than name substrings', async () => {
  const paths = await findGlbs(ASSETS);
  const catalog = buildAssetCatalog(Object.fromEntries(paths.map((file) => [file, file])));
  const category = (id) => catalog.find((asset) => asset.id === id)?.category;

  assert.equal(category('Units/soviets/attack-dog'), 'Infantry');
  assert.equal(category('Units/soviets/sputnik-dozer'), 'Vehicles');
  assert.equal(category('Units/reclamation/yardcrawler'), 'Vehicles');
  assert.equal(category('Units/meridian/pactworks-carryall'), 'Vehicles');

  for (const id of [
    'Buildings/allies/construction-yard',
    'Buildings/soviets/construction-yard',
    'Buildings/soviets/construction-yard-surface-v2',
    'Buildings/meridian/forgeyard',
    'Buildings/reclamation/breaker-yard',
    'Buildings/reclamation/patch-yard',
  ]) assert.equal(category(id), 'Buildings', id);

  for (const id of [
    'Buildings/allies/naval-yard',
    'Buildings/soviets/naval-pen',
    'Buildings/meridian/slipway',
    'Buildings/reclamation/breaker-dock',
  ]) assert.equal(category(id), 'Naval structures', id);

  for (const id of [
    'Units/allies/petrel-bomber',
    'Units/soviets/interceptor',
    'Units/meridian/kestrel-gunship',
    'Units/reclamation/swarmhornet',
  ]) assert.equal(category(id), 'Aircraft', id);

  for (const id of [
    'Units/allies/hydrofoil',
    'Units/allies/assault-destroyer',
    'Units/allies/aircraft-cruiser',
    'Units/soviets/picket-boat',
    'Units/soviets/attack-submarine',
    'Units/soviets/dreadnought',
    'Units/meridian/sun-cutter',
    'Units/meridian/kite-corvette',
    'Units/meridian/sunmonitor',
    'Units/reclamation/scrap-skimmer',
    'Units/reclamation/slag-scow',
    'Units/reclamation/reclaimed-hulk',
    'Units/soviets/hover-transport',
    'Units/soviets/assault-barge',
    'Units/allies/hover-transport',
    'Units/allies/landing-craft',
    'Units/meridian/sun-lighter',
    'Units/meridian/argosy',
    'Units/reclamation/slag-hauler',
  ]) assert.equal(category(id), 'Naval units', id);
});

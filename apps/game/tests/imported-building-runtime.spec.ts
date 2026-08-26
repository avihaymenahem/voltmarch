import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('apps/game/src/art/buildings.system.ts'), 'utf8');
const bridgeSystem = readFileSync(resolve('apps/game/src/render/render-bridge.system.ts'), 'utf8');
const shellSource = readFileSync(resolve('apps/game/src/shell/Shell.ts'), 'utf8');

describe('imported building runtime contract', () => {
  it('uses derived caster proxies for static imports without putting them in colour or AO', () => {
    // Thirty static buildings have geometry-only caster proxies. Moving
    // defences are deliberately excluded: a fused proxy would leave their
    // shadows pointing in the authored direction after the head slews.
    expect(source.split('.shadow.glb').length - 1).toBe(30);
    const sentry = source.match(/key: 'soviet_sentry',[\s\S]*?\n  \},\n  \{\n    key: 'soviet_tesla'/)?.[0];
    expect(sentry).toBeDefined();
    expect(sentry).not.toContain('shadowUrl:');

    expect(source).toContain('material.colorWrite = false');
    expect(source).toContain('material.depthWrite = false');
    expect(source).toContain('material.depthTest = false');
    expect(source).toMatch(/geometry:\s*shadowGeometry,[\s\S]*?castShadow:\s*true,[\s\S]*?receiveShadow:\s*false,[\s\S]*?aoOccluder:\s*false/);
    expect(source).toContain('castShadow: shadowGeometry === undefined');
    expect(source).toContain("get('assetopt') !== 'off'");
    expect(source).toContain('const lodSpecs = optimize ? spec.lods ?? [] : []');
    expect(source).toContain('const shadowUrl = optimize ? spec.shadowUrl : undefined');
    expect(source).toContain('position.array instanceof Float32Array');
    expect(source).toContain("result.setAttribute('position', new THREE.BufferAttribute(values, 3))");
    expect(source).toContain("promoteGeometryAttributeToFloat32(result, 'uv')");
    expect(source).toContain('removeStaleTangentAttribute(result)');
  });

  it('only ships distance LODs that passed the asset-family gates', () => {
    expect(source).toContain("war-factory.lod1.glb");
    expect(source).toContain("war-factory.lod2.glb");
    expect(source).toContain("ore-refinery.lod1.glb");
    expect(source).toContain("ore-refinery.lod2.glb");
    expect(source).toContain("barracks.lod1.glb");
    expect(source).toContain("radar-tower.lod1.glb");
    expect(source).toContain("command-bunker.lod1.glb");
    expect(source).toContain("naval-pen.lod1.glb");
    expect(source).toContain("nuclear-silo.lod1.glb");
    expect(source).toContain("ore-silo.lod1.glb");
    expect(source).toContain("tesla-reactor.lod1.glb");
    expect(source).toContain("tesla-reactor.lod2.glb");
    expect(source).toContain("flame-tower.lod1.glb");
    expect(source.split('.lod1.glb').length - 1).toBe(20);
    expect(source.split('.lod2.glb').length - 1).toBe(4);
    expect(source).toContain('minDistance: 78');
    expect(source).toContain('minDistance: 82');
    expect(source).toContain('minDistance: 86');
    expect(source).toContain('minDistance: 94');
    expect(source).toContain('minDistance: 112');
    expect(source).toContain('minDistance: 116');
    expect(bridgeSystem).toContain("get('assetlod')");
    expect(bridgeSystem).toContain('forcedLodDistance ?? cameraRig.distance');
  });

  it('ships Allied production buildings and landmarks as complete visual replacements', () => {
    for (const key of [
      'allied_conyard',
      'allied_power',
      'allied_barracks',
      'allied_refinery',
      'allied_warfactory',
      'allied_radar',
      'allied_tech',
      'allied_commandpost',
      'allied_depot',
      'allied_navalyard',
      'allied_chrono',
      'allied_weather',
    ]) {
      const block = source.match(new RegExp(`key: '${key}',[\\s\\S]*?proceduralParts: 'none'`))?.[0];
      expect(block, key).toBeDefined();
      expect(block, `${key} shadow inset`).toContain('shadowInset: 0.90');
    }
    expect(source).toContain("allies/compressed/construction-yard.glb");
    expect(source).toContain("allies/compressed/power-plant.glb");
    expect(source).toContain("allies/compressed/barracks.glb");
    expect(source).toContain("allies/compressed/ore-refinery.glb");
    expect(source).toContain("allies/compressed/war-factory.glb");
    expect(source).toContain("allies/compressed/radar-dome.glb");
    expect(source).toContain("allies/compressed/tech-centre.glb");
    expect(source).toContain("allies/compressed/command-post.glb");
    expect(source).toContain("allies/compressed/repair-depot.glb");
    expect(source).toContain("allies/compressed/naval-yard.glb");
    expect(source).toContain("allies/compressed/displacement-ring.glb");
    expect(source).toContain("allies/compressed/weather-device.glb");
  });

  it('ships the Allied unique defence trio with sealed authored articulation', () => {
    for (const key of ['allied_pillbox', 'allied_aa', 'allied_prismtower']) {
      const block = source.match(new RegExp(`key: '${key}',[\\s\\S]*?proceduralParts: 'none'`))?.[0];
      expect(block, key).toBeDefined();
      expect(block, `${key} shadow inset`).toContain('shadowInset: 0.90');
    }
    expect(source).toContain("allies/compressed/pillbox.glb");
    expect(source).toContain("allies/compressed/aa-battery.glb");
    expect(source).toContain("allies/compressed/refractor-tower.glb");
    expect(source).toMatch(/key: 'allied_aa',[\s\S]*?bodyName: 'body',[\s\S]*?turretName: 'turret'/);
    expect(source).toMatch(/key: 'allied_prismtower',[\s\S]*?bodyName: 'body',[\s\S]*?turretName: 'head'/);
  });

  it('applies the family exposure compensation in linear material space', () => {
    expect(source).toContain('const IMPORTED_STRUCTURE_EXPOSURE = 1.10;');
    expect(source).toContain('.multiplyScalar(IMPORTED_STRUCTURE_EXPOSURE)');
    expect(source).toContain('spec.style.ambientIntensity * IMPORTED_STRUCTURE_EXPOSURE');
    expect(source).toContain('spec.style.envMapIntensity * IMPORTED_STRUCTURE_EXPOSURE');
  });

  it('uses the approved imported architecture on the title backdrop too', () => {
    expect(source).not.toContain("get('title') !== '1'");
    expect(source).not.toContain('importedStructuresRequested()');
    expect(shellSource).not.toContain("query.set('title', '1')");
    expect(shellSource).toContain("query.delete('title')");
  });

  it('can reject baked studio gloss for dry hard-surface families', () => {
    expect(source).toContain("roughnessMap: spec.style.useRoughnessMap === false ? null : source.roughnessMap");
  });

  it('compensates the Construction Yard low-contrast source maps without a global repaint', () => {
    const conyard = source.match(/key: 'soviet_conyard',[\s\S]*?\n  \},\n  \{\n    key: 'soviet_warfactory'/)?.[0];
    expect(conyard).toBeDefined();
    expect(conyard).toContain('creaseAngle: 38');
    expect(conyard).toContain('metalness: 0.10');
    expect(conyard).toContain('roughness: 0.50');
    expect(conyard).toContain('normalScale: 1.80');
  });
});

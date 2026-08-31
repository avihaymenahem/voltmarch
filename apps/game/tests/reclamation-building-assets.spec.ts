import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface OutputRow {
  profile: 'lod1' | 'lod2' | 'shadow';
  status: 'candidate' | 'blocked';
  file: string;
  fileBytes: number;
  geometryOnly: boolean;
}

interface AssetRow {
  key: string;
  source: { file: string; triangles: number; fileBytes: number };
  outputs: OutputRow[];
}

const report = JSON.parse(fs.readFileSync(
  path.resolve('packages/assets/game/buildings/reclamation/derived/optimization-report.json'),
  'utf8',
)) as { family: string; write: boolean; rows: AssetRow[] };
const runtime = fs.readFileSync(path.resolve('apps/game/src/art/Faction4Buildings.ts'), 'utf8');

describe('Reclamation hard-surface asset chain', () => {
  it('records the dedicated-retopo close meshes rather than the melted local reductions', () => {
    expect(report.family).toBe('reclamation-buildings');
    expect(report.write).toBe(true);
    expect(Object.fromEntries(report.rows.map((row) => [row.key, row.source.triangles]))).toEqual({
      reclaim_foundry: 195_311,
      reclaim_furnace: 96_806,
      reclaim_sorter: 126_532,
      reclaim_rookery: 24_158,
      reclaim_breakeryard: 36_017,
      reclaim_spotter: 17_309,
      reclaim_signalrig: 26_236,
      reclaim_crucible: 31_746,
      reclaim_depot: 21_703,
      reclaim_drydock: 35_868,
      reclaim_heap: 21_957,
      reclaim_spitpost: 18_009,
      reclaim_pylon: 24_552,
      reclaim_barricade: 7_417,
      reclaim_stormworks: 42_464,
      reclaim_airbase: 49_598,
    });
    for (const row of report.rows) {
      expect(fs.statSync(path.resolve(row.source.file)).size).toBe(row.source.fileBytes);
    }
  });

  it('quarantines the colour LOD candidates until they pass live WebGPU presentation', () => {
    const referenced = [...runtime.matchAll(
      /reclamation\/derived\/([^']+\.lod\d+\.glb)/g,
    )].map((match) => match[1]);
    expect(referenced).toEqual([
      'rookery.lod1.glb',
      'breaker-yard.lod1.glb',
      'spotter-mast.lod1.glb',
      'signal-rig.lod1.glb',
      'crucible.lod1.glb',
      'patch-yard.lod1.glb',
      'breaker-dock.lod1.glb',
      'carrion-roost.lod1.glb',
      'carrion-roost.lod2.glb',
    ]);
    expect(runtime).toContain('the whole 3D command buffer is rejected');
    expect(runtime).not.toContain('foundry.lod1.glb');
    expect(runtime).not.toContain('scrap-furnace.lod1.glb');
    expect(runtime).not.toContain('ore-sorter.lod1.glb');
    expect(runtime).not.toContain('ore-sorter.lod2.glb');
    expect(runtime).not.toContain('foundry.lod2.glb');
    expect(runtime).not.toContain('arc-pylon.lod1.glb');
    expect(runtime).not.toContain('stormworks.lod1.glb');
  });

  it('keeps the modular barricade thin inside its square gameplay cell', () => {
    const barricade = runtime.slice(runtime.indexOf("key: 'reclaim_barricade'"));
    expect(barricade).toContain('widthScale: 0.96, depthScale: 0.18');
  });

  it('keeps the dry hard-surface material contract for the family', () => {
    expect(runtime).toContain('useRoughnessMap: false');
    expect(runtime).toContain('normalScale: 1.00');
    expect(runtime).toContain('metalness: 0.12');
    expect(runtime).toContain('ambientIntensity: 0.22');
    expect(runtime).toContain('clearcoat: 0.00');
    expect(runtime).toContain('creaseAngle: 42');
  });
});

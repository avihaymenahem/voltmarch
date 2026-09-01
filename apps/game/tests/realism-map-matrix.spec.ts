import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MAP_PRESETS } from '../src/core/config';
import { MAP_START_TABLES } from '../src/game/Scenarios';
import { MAPS } from '../src/shell/settings-store';
import {
  REALISM_MAP_CELLS, REALISM_MAP_THRESHOLDS,
} from '../../../tools/lib/realism-map-matrix.mjs';

const tool = readFileSync(
  fileURLToPath(new URL('../../../tools/realism-map-matrix.mjs', import.meta.url)),
  'utf8',
);

describe('all-map WebGPU realism acceptance matrix', () => {
  it('covers every shipped map, preset and authored start table exactly once', () => {
    expect(REALISM_MAP_CELLS).toHaveLength(7);
    expect(new Set(REALISM_MAP_CELLS.map((cell) => cell.id))).toEqual(
      new Set(MAPS.map((map) => map.id)),
    );
    expect(new Set(REALISM_MAP_CELLS.map((cell) => cell.preset))).toEqual(
      new Set(Object.keys(MAP_PRESETS)),
    );
    expect(new Set(REALISM_MAP_CELLS.map((cell) => cell.preset))).toEqual(
      new Set(Object.keys(MAP_START_TABLES)),
    );
  });

  it('pins every evidence cell to the shipping biome, preset and mood', () => {
    for (const cell of REALISM_MAP_CELLS) {
      const map = MAPS.find((candidate) => candidate.id === cell.id);
      expect(map, cell.id).toBeDefined();
      expect(cell.biome, cell.id).toBe(map?.biome);
      expect(cell.preset, cell.id).toBe(map?.preset);
      expect(cell.mood, cell.id).toBe(map?.mood);
      expect(MAP_PRESETS[cell.preset]?.mood, cell.id).toBe(cell.mood);
    }
  });

  it('exercises dry dust, rain and snow plus the authored urban night', () => {
    expect(REALISM_MAP_CELLS.some((cell) => cell.weather === 'off')).toBe(true);
    expect(REALISM_MAP_CELLS.some((cell) => cell.precipitation === 'rain')).toBe(true);
    expect(REALISM_MAP_CELLS.some((cell) => cell.precipitation === 'snow')).toBe(true);
    expect(REALISM_MAP_CELLS.find((cell) => cell.id === 'industrial-grid')).toMatchObject({
      dayPhase: 'night', mood: 'night', semanticContext: 'required',
    });
  });

  it('requires map-general irradiance, causal wear and deterministic camera motion', () => {
    expect(REALISM_MAP_THRESHOLDS.irradianceFieldPixelsMin).toBe(4096);
    expect(REALISM_MAP_THRESHOLDS.structureWearMarksMin).toBeGreaterThan(0);
    for (const evidence of [
      'irradiance-field-installed', 'contextual-structure-wear',
      'simulation-invariance', 'colour-draw-budget', 'program-stability',
    ]) expect(tool).toContain(evidence);
    expect(tool).toContain('globalThis.__vmStructureWear');
    expect(tool).toContain('globalThis.__vmSemanticContexts');
    expect(tool).toContain('vm.focusOn(camera.x + panMetres');
  });

  it('requires preset-owned semantic composition on every shipped map', () => {
    const required = REALISM_MAP_CELLS.filter((cell) => cell.semanticContext === 'required');
    expect(required).toHaveLength(7);
    expect(tool).toContain('evidence.semanticContexts.grammar === cell.preset');
    expect(tool).toContain('evidence.semanticContexts.grammarFingerprint !== 0');
    expect(tool).not.toContain('coverageDebt');
  });

  it('boots the no-query WebGPU product path and adds no realism product gate', () => {
    expect(tool).not.toContain("query.set('gpu'");
    expect(tool).not.toMatch(/[?&](?:gi|worldstories|surfaceaging)=/);
    expect(tool).not.toContain("query.set('gi'");
    expect(tool).not.toContain("query.set('worldstories'");
    expect(tool).not.toContain("query.set('surfaceaging'");
    expect(tool).toContain("tier: 'medium', gpupasses: '1', weather: cell.weather");
    expect(tool).toContain("query.set('dayphase', cell.dayPhase)");
    expect(tool).toContain("weather: weather !== 'off'");
  });
});

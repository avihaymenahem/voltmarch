import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FACTION_PALETTE } from '../src/core/config';
import { loadingFactionTheme } from '../src/shell/loading-theme';
import { MAPS } from '../src/shell/settings-store';

const root = process.cwd();
const shell = readFileSync(join(root, 'apps/game/src/shell/Shell.ts'), 'utf8');
const css = readFileSync(join(root, 'apps/game/src/shell/shell.css'), 'utf8');

describe('the tactical loading presentation', () => {
  it('has a bounded, authored battlefield preview for every selectable map', () => {
    for (const map of MAPS) {
      const preview = join(root, 'apps/game/public/maps/previews', `${map.id}.webp`);
      expect(existsSync(preview), `${map.name} has no loading preview`).toBe(true);
      expect(statSync(preview).size, `${map.name} preview is too heavy for the loading path`)
        .toBeLessThanOrEqual(256 * 1024);
    }
  });

  it('feeds real map and match data into the briefing instead of decorative placeholders', () => {
    expect(shell).toContain('preview: `/maps/previews/${map.id}.webp`');
    expect(shell).toContain('blurb: map.blurb');
    expect(shell).toContain('armies: this.setup.opponents.length + 1');
    expect(shell).toContain("metaChip('Terrain', this.battlefield.biome)");
    expect(shell).toContain("el('strong', 'vm-load-status', 'Initialising')");
  });

  it('keeps the map legible beneath faction atmosphere and honors reduced motion', () => {
    expect(css).toContain('.vm-shell .vm-load-backdrop');
    expect(css).toContain('.vm-shell .vm-load-atmosphere');
    expect(css).toContain('.vm-shell .vm-load-grid');
    expect(css).toContain('html.vm-reduced-motion .vm-shell .vm-load-backdrop');
    expect(css).toContain('.vm-shell .vm-load.is-soviets');
    expect(css).toContain('.vm-shell .vm-load.is-meridian');
    expect(css).toContain('.vm-shell .vm-load.is-reclaim');
  });

  it('derives Meridian and Reclamation loading colors from their real faction palettes', () => {
    const meridian = {
      accent: FACTION_PALETTE.meridian.hudAccent,
      rgb: '18, 181, 143',
    };
    const reclaim = {
      accent: FACTION_PALETTE.reclaim.hudAccent,
      rgb: '185, 63, 224',
    };
    expect(loadingFactionTheme('meridian')).toEqual(meridian);
    expect(loadingFactionTheme('pact')).toEqual(meridian);
    expect(loadingFactionTheme('reclaim')).toEqual(reclaim);
    expect(loadingFactionTheme('reclamation')).toEqual(reclaim);
  });
});

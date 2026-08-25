import { afterEach, describe, expect, it } from 'vitest';
import { Faction } from '../src/core/types';
import {
  isArtFactionPlanned,
  plannedArtFactions,
  setPlannedArtFactions,
} from '../src/art/boot-plan';
import { readFileSync } from 'node:fs';
import path from 'node:path';

afterEach(() => setPlannedArtFactions(null));

describe('faction art boot plan', () => {
  it('defaults broad for harnesses and unknown boot paths', () => {
    setPlannedArtFactions(null);
    expect(plannedArtFactions()).toBeNull();
    expect(isArtFactionPlanned(Faction.Allies)).toBe(true);
    expect(isArtFactionPlanned(Faction.Reclaim)).toBe(true);
  });

  it('loads only explicitly seated faction packs', () => {
    setPlannedArtFactions([Faction.Allies, Faction.Soviets, Faction.Allies]);
    expect(plannedArtFactions()).toEqual([Faction.Allies, Faction.Soviets]);
    expect(isArtFactionPlanned(Faction.Meridian)).toBe(false);
    expect(isArtFactionPlanned(Faction.Reclaim)).toBe(false);
  });

  it('guards both standalone imported-art systems before they allocate', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    for (const [file, faction] of [
      ['apps/game/src/art/faction3.system.ts', 'Faction.Meridian'],
      ['apps/game/src/art/faction4.system.ts', 'Faction.Reclaim'],
    ] as const) {
      const source = readFileSync(path.join(repo, file), 'utf8');
      const guard = source.indexOf(`if (!isArtFactionPlanned(${faction}))`);
      const context = source.indexOf('const { loop } = ctx()');
      expect(guard, file).toBeGreaterThanOrEqual(0);
      expect(guard, `${file} checks after touching the engine`).toBeLessThan(context);
    }
  });

  it('filters original-faction imported GLBs against the seated-faction plan', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    for (const file of [
      'apps/game/src/art/buildings.system.ts',
      'apps/game/src/art/units.system.ts',
    ]) {
      const source = readFileSync(path.join(repo, file), 'utf8');
      expect(source).toContain("import { isArtFactionPlanned } from './boot-plan'");
      expect(source).toContain("spec.key.startsWith('allied_')");
      expect(source).toContain('isArtFactionPlanned(Faction.Allies)');
      expect(source).toContain("spec.key.startsWith('soviet_')");
      expect(source).toContain('isArtFactionPlanned(Faction.Soviets)');
    }
  });

  it('plans only the opponent that the two-army title backdrop actually seats', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    const shell = readFileSync(path.join(repo, 'apps/game/src/shell/Shell.ts'), 'utf8');
    expect(shell).toMatch(
      /const artOpponents = backdrop\s*\? effectiveOpponents\(this\.setup\)\.slice\(0, 1\)/,
    );
    expect(shell).toContain('for (const opponent of artOpponents)');
  });

  it('widens imported-building decode only on capable clients', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    const buildings = readFileSync(
      path.join(repo, 'apps/game/src/art/buildings.system.ts'),
      'utf8',
    );
    expect(buildings).toContain('function importedStructureConcurrency(): number');
    expect(buildings).toContain("typeof navigator === 'undefined'");
    expect(buildings).toMatch(/hardwareConcurrency \|\| 4\) >= 8 \? 6 : 3/);
    expect(buildings).toContain('importedStructureConcurrency(),');
  });
});

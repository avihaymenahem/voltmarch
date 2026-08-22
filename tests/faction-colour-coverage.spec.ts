import { describe, expect, it } from 'vitest';

import { generateGreebleAtlas } from '../src/art/greeble-gen';
import { padAtlasSpec } from '../src/art/BuildingFactory';
import { specForPalette } from '../src/art/UnitFactory';
import { RA3_ALLIED_PAD, RA3_ALLIED_STRUCTURE, RA3_ALLIES } from '../src/core/config';

describe('visible faction-colour accounting', () => {
  it('counts the slab, glass, and only the coloured field of an insignia', () => {
    const atlas = generateGreebleAtlas(
      specForPalette('coverage.allies', RA3_ALLIES, 256, 0x4172),
    );
    const cover = atlas.metrics.factionColourTileCover;

    expect(cover.teamSlab).toBeGreaterThan(0.90);
    expect(cover.glass).toBeGreaterThan(0.90);
    expect(cover.insignia).toBeGreaterThan(0.20);
    expect(cover.insignia).toBeLessThan(0.75);
    expect(cover.paintLarge).toBeLessThan(0.05);
  });

  it('counts blue-family foundation paint without calling it an identity slab', () => {
    const atlas = generateGreebleAtlas(
      padAtlasSpec('coverage.allied-pad', {
        structure: RA3_ALLIED_STRUCTURE,
        pad: RA3_ALLIED_PAD,
        panelDensity: 1,
        seed: 0x4172,
        padSeed: 0x4173,
      }, 256),
    );
    const cover = atlas.metrics.factionColourTileCover;

    expect(cover.paintLarge).toBeGreaterThan(0.80);
    expect(cover.teamSlab).toBeGreaterThan(0.90);
  });
});

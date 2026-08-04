/**
 * ============================================================================
 * VOLTMARCH — tests/props-surface.spec.ts
 * ============================================================================
 * THE PROP SURFACE CONTRACT.
 *
 * Props carry no texture map at all: the paint is per-vertex colour on one
 * shared material. So the "no visible per-pixel noise" law cannot be enforced
 * here with `checkNoiseBudget` — there are no texels to check. The equivalent
 * failure mode for a vertex-painted prop is the TONE LADDER: two adjacent
 * masses of the same object painted far apart in value read as blotching, and
 * when the alternation is per-blade or per-lobe it reads as an outright noise
 * field at gameplay zoom. That is precisely what `grassTuft` (every third blade
 * at 0.61x), `conifer` (tiers 0.41x apart) and `boulder` (masses 0.60x apart)
 * used to do.
 *
 * These tests pin the fixed behaviour:
 *   1. every ladder inside an object spans at most 1.40x in value
 *   2. foliage hue never enters the emerald 100-120 band
 *   3. man-made paint is genuinely saturated, RA3 toy-car style
 *   4. a grass fan is ONE tone, not a two-tone stipple
 *   5. `aGloss` exists, is bounded, and is spent on paint rather than leaves
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { PropLibrary, PROP_GLOSS_ROUGHNESS, propPalette } from '../src/world/PropLibrary';
import { linearColorTriple } from '../src/core/assets';
import type { BiomeName } from '../src/world/Biomes';

const BIOMES: readonly BiomeName[] = ['temperate', 'desert', 'snow', 'urban'];

/** HSV value = max channel, the metric the palette ladders were authored in. */
function value(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255;
}

/** HSV saturation. */
function saturation(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Hue in degrees. */
function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 1e-6) return 0;
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h / 6) * 360;
}

/** Value ratio of the brightest to the darkest tone in a ladder. */
function span(...hexes: readonly string[]): number {
  const vs = hexes.map(value);
  return Math.max(...vs) / Math.max(Math.min(...vs), 1e-6);
}

/**
 * Fraction of a prop's vertices painted in `hex`.
 *
 * The baked AO ramp multiplies a vertex colour by a scalar, and `shadeOf`
 * multiplies value while holding hue and saturation, so "painted in `hex`" is
 * "is a positive scalar multiple of linear(hex)" — a direction test in RGB,
 * not an equality test.
 */
function toneFraction(geometry: { getAttribute: (n: string) => { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } }, hex: string): number {
  const t = linearColorTriple(hex);
  const tLen = Math.hypot(t[0], t[1], t[2]);
  const col = geometry.getAttribute('color');
  let hits = 0;
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    const len = Math.hypot(r, g, b);
    if (len < 1e-6) continue;
    const dot = (r * t[0] + g * t[1] + b * t[2]) / (len * tLen);
    if (dot > 0.9995) hits++;
  }
  return hits / col.count;
}

/* ==========================================================================
 * 1. THE PALETTE LADDERS
 * ========================================================================== */

describe('prop palette — the tone-ladder budget', () => {
  /**
   * 1.40x is the line. A canopy whose lobes span more than that stops reading
   * as one tree lit from one direction and starts reading as blotches; the
   * broken version spanned 1.52x on foliage and 2.42x on conifers.
   */
  const MAX_SPAN = 1.40;

  it('keeps every within-object ladder inside 1.40x of value', () => {
    for (const biome of BIOMES) {
      const p = propPalette(biome);
      const ladders: ReadonlyArray<readonly [string, readonly string[]]> = [
        ['leaf', [p.leafA, p.leafB, p.leafC]],
        ['autumn', [p.autumnA, p.autumnB, p.autumnC]],
        ['conifer', [p.conifer, p.coniferDark]],
        ['shrub', [p.shrub, p.shrubDark]],
        ['grassGold', [p.grassGold, p.grassGoldBase]],
        ['grassGreen', [p.grassGreen, p.grassGreenBase]],
        ['rock', [p.rock, p.rockShade]],
        ['crate', [p.crateA, p.crateB]],
        ['container', [p.containerA, p.containerB]],
      ];
      for (const [name, tones] of ladders) {
        expect(span(...tones), `${biome}.${name}`).toBeLessThanOrEqual(MAX_SPAN);
      }
    }
  });

  it('lets trunk-vs-canopy span freely — that is two objects, not one surface', () => {
    // The rule is about variation WITHIN a surface. A brown trunk under a green
    // canopy is a legitimate hard boundary and must not be flattened.
    for (const biome of BIOMES) {
      const p = propPalette(biome);
      expect(hue(p.trunk), biome).toBeLessThan(60);
      expect(hue(p.leafA), biome).toBeGreaterThan(45);
    }
  });

  it('keeps foliage out of the emerald 100-120 hue band', () => {
    for (const biome of BIOMES) {
      const p = propPalette(biome);
      const greens = { leafA: p.leafA, leafB: p.leafB, leafC: p.leafC, conifer: p.conifer,
        coniferDark: p.coniferDark, frond: p.frond, shrub: p.shrub, shrubDark: p.shrubDark,
        hedge: p.hedge, grassGreen: p.grassGreen, grassGreenBase: p.grassGreenBase };
      for (const [k, hex] of Object.entries(greens)) {
        const h = hue(hex);
        // Warm olive through yellow-green. Never emerald: the terrain agent is
        // steering the ground yellow-olive and a 110-degree bush on top of it
        // reads as a different game.
        expect(h, `${biome}.${k} hue`).toBeGreaterThan(45);
        expect(h, `${biome}.${k} hue`).toBeLessThan(100);
      }
    }
  });

  it('paints man-made props as saturated toys, not dusted brick', () => {
    const p = propPalette('urban');
    for (const hex of [p.paintRed, p.paintYellow, p.paintBlue, p.paintGreen,
      p.containerA, p.containerB, p.crateA, p.flowerA, p.flowerB]) {
      expect(saturation(hex), hex).toBeGreaterThan(0.6);
    }
    // ...and man-made colour is biome independent, so a red car is the same red
    // in the snow as it is in the desert.
    for (const biome of BIOMES) expect(propPalette(biome).paintRed).toBe(p.paintRed);
  });
});

/* ==========================================================================
 * 2. THE BUILT GEOMETRY
 * ========================================================================== */

describe('prop surfaces — flat masses, no stipple', () => {
  const lib = new PropLibrary({ biome: 'temperate', seed: 11 });
  const p = propPalette('temperate');

  it('paints a grass fan in ONE tone (was a 14-cell two-tone noise field)', () => {
    for (const key of ['grassTuft', 'grassTuftGreen']) {
      const pg = lib.get(key)!;
      const tip = key === 'grassTuft' ? p.grassGold : p.grassGreen;
      // Every one of the 14 blades is the tip tone; the ~17% residue is the
      // soil clump the fan grows out of, which is a different object. The
      // broken version painted 5 of the 14 blades in `base` and scored ~0.53.
      expect(toneFraction(pg.geometry, tip), key).toBeGreaterThan(0.80);
    }
  });

  it('gives a hedge a LIGHTER crown than its box, not a darker one', () => {
    const pg = lib.get('hedge')!;
    // The crown lobes must be a scalar brighten of the hedge tone, so they
    // still register as the hedge tone by direction...
    expect(toneFraction(pg.geometry, p.hedge)).toBeGreaterThan(0.5);
    // ...and the brightest non-bevel vertex must beat the box's own value.
    const col = pg.geometry.getAttribute('color');
    let maxG = 0;
    for (let i = 0; i < col.count; i++) maxG = Math.max(maxG, col.getY(i));
    expect(maxG).toBeGreaterThan(linearColorTriple(p.hedge)[1]);
  });

  it('draws crate seams as crisp dark battens over a flat body', () => {
    const pg = lib.get('crateStack')!;
    const seam = toneFraction(pg.geometry, p.woodDark);
    // Present — the seams are real, drawn geometry...
    expect(seam).toBeGreaterThan(0.15);
    // ...but a minority of the surface. A crate is a flat tan slab that happens
    // to be framed, not a dark lattice.
    expect(seam).toBeLessThan(0.62);
  });

  it('never lets a prop go fully black or blow out', () => {
    for (const pg of lib.all()) {
      const col = pg.geometry.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const m = Math.max(col.getX(i), col.getY(i), col.getZ(i));
        expect(m, `${pg.def.key}[${i}]`).toBeGreaterThan(0.0005);
        expect(m, `${pg.def.key}[${i}]`).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

/* ==========================================================================
 * 3. THE GLOSS CHANNEL
 * ========================================================================== */

describe('aGloss — roughness variation, and nothing else', () => {
  const lib = new PropLibrary({ biome: 'urban', seed: 5 });

  it('rides on every prop geometry, bounded to 0..1, one per vertex', () => {
    for (const pg of lib.all()) {
      const a = pg.geometry.getAttribute('aGloss');
      expect(a, pg.def.key).toBeTruthy();
      expect(a.count, pg.def.key).toBe(pg.geometry.getAttribute('position').count);
      for (let i = 0; i < a.count; i++) {
        expect(a.getX(i), `${pg.def.key}[${i}]`).toBeGreaterThanOrEqual(0);
        expect(a.getX(i), `${pg.def.key}[${i}]`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spends gloss on paint and leaves foliage and stone matte', () => {
    const maxGloss = (key: string): number => {
      const a = lib.get(key)!.geometry.getAttribute('aGloss');
      let m = 0;
      for (let i = 0; i < a.count; i++) m = Math.max(m, a.getX(i));
      return m;
    };
    // Painted / glazed.
    for (const key of ['carSedan', 'carVan', 'carPickup', 'barrel', 'roadSign', 'streetLamp']) {
      expect(maxGloss(key), key).toBeGreaterThan(0.4);
    }
    // Leaves, grass and rock are not lacquer. Bible §5.4 reserves the coat for
    // painted armour, and a waxy leaf reads as plastic.
    for (const key of ['tree', 'conifer', 'bush', 'hedge', 'grassTuft', 'boulder', 'rockCluster']) {
      expect(maxGloss(key), key).toBe(0);
    }
  });

  it('gives a car a majority-glossy shell', () => {
    const a = lib.get('carSedan')!.geometry.getAttribute('aGloss');
    let glossy = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) > 0.5) glossy++;
    expect(glossy / a.count).toBeGreaterThan(0.5);
  });

  it('targets a lacquer roughness, not a mirror', () => {
    // A mirror-flat prop would pick up the whole env map and pop out of the
    // frame; 0.24 is the bible §5.4 painted-armour band.
    expect(PROP_GLOSS_ROUGHNESS).toBeGreaterThan(0.15);
    expect(PROP_GLOSS_ROUGHNESS).toBeLessThan(0.4);
  });
});

/**
 * ============================================================================
 * tests/terrain-surfaces.spec.ts — THE GROUND IS FLAT AND IT IS NOT EMERALD
 * ============================================================================
 * Two look failures were measured on the ground, and both of them are the kind
 * that creep back in one "just a little variation" at a time. So both are
 * tests.
 *
 * 1. THE ONE RULE — per-pixel noise is wrong. The six splat tiles used to come
 *    from `genGround`, which is 5-octave fbm + a 7x fbm + a 9x worley clump
 *    field. A layer tiles at 5-10 m over 256 texels, so those octaves were
 *    per-SCREEN-PIXEL noise at gameplay zoom. `checkNoiseBudget` is the
 *    automated form of "does this look like TV static?".
 *
 * 2. SCORECARD #9, WEIGHT 3 — the emerald tell. `tools/metrics.mjs` counts
 *    pixels at hue 100-120 with s > 0.25 and v > 0.15; the target is under 2%
 *    and RA3 itself measures 0.3%. No authored terrain colour, and no texel
 *    any terrain generator produces, may sit in that window. The layer
 *    palettes additionally keep RED AT OR ABOVE GREEN on every natural ground
 *    layer, because the blue hemisphere fill and the blue-grey fog lerp both
 *    push a g > r colour toward the window after the albedo is out of our
 *    hands. See the header of src/world/Biomes.ts.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { checkNoiseBudget, type Surface } from '../src/core/assets';
import { BIOMES, BIOME_NAMES, SURFACE_COUNT, type SurfaceLayerDef } from '../src/world/Biomes';
import {
  FIELD_DRIFT_CAP, FIELD_MIN_WAVELENGTH, buildFieldSurface, buildLayerSurface,
  buildLayerArrayTexture,
} from '../src/world/TerrainMaterial';

/** Small enough to keep the suite fast, large enough for the drift wavelengths. */
const SIZE = 128;

/* -------------------------------------------------------------------------- */

/** Exactly the conversion `tools/metrics.mjs` uses, so the bands line up. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hexHsv(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return rgbToHsv(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** The scorecard predicate, evaluated on one colour. */
function isEmerald(h: number, s: number, v: number): boolean {
  return h >= 100 && h <= 120 && s > 0.25 && v > 0.15;
}

/** Every authored colour on a layer. */
function layerColours(L: SurfaceLayerDef): readonly string[] {
  return L.joint === undefined
    ? [L.albedo, L.shade, L.accent]
    : [L.albedo, L.shade, L.accent, L.joint];
}

function luminanceRange(s: Surface): { min: number; max: number } {
  let min = 1, max = 0;
  for (let i = 0; i < s.size * s.size; i++) {
    const l = 0.2126 * s.albedo[i * 3] + 0.7152 * s.albedo[i * 3 + 1] + 0.0722 * s.albedo[i * 3 + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return { min, max };
}

/* ==========================================================================
 * 1. THE PALETTE
 * ========================================================================== */

describe('biome palettes', () => {
  it('no authored terrain colour sits in the emerald window', () => {
    for (const name of BIOME_NAMES) {
      const b = BIOMES[name];
      const colours = [
        ...b.layers.flatMap(layerColours),
        b.macroTint,
        b.cliff.base, b.cliff.shade, b.cliff.highlight, b.cliff.capColor,
      ];
      for (const hex of colours) {
        const [h, s, v] = hexHsv(hex);
        expect(
          isEmerald(h, s, v),
          `${name} colour ${hex} is at hue ${h.toFixed(1)} — inside the emerald window`,
        ).toBe(false);
      }
    }
  });

  it('green is never the dominant channel on a natural ground layer', () => {
    // This is the property that survives the lighting, and it is exactly the
    // precondition of the failure: hue lands in 100-120 only when green is the
    // strict maximum channel. A g > r albedo becomes g >> r under the blue sky
    // fill, and then fog lifts blue to just under red — hue ~104.
    //
    // Blue-dominant layers (ice) are fine: max === b can never produce a hue
    // in the green sector at all.
    for (const name of BIOME_NAMES) {
      for (const L of BIOMES[name].layers) {
        if (L.surface !== 'field') continue;
        for (const hex of layerColours(L)) {
          const [r, g, b] = hexRgb(hex);
          expect(
            g > r && g > b,
            `${name}/${L.label} ${hex} is green-dominant`,
          ).toBe(false);
        }
      }
    }
  });

  it('grass sits in the bible hue / saturation / value bands', () => {
    let found = 0;
    for (const name of BIOME_NAMES) {
      for (const L of BIOMES[name].layers) {
        if (L.label !== 'grass') continue;
        found++;
        const [h, s, v] = hexHsv(L.albedo);
        expect(h, `${name} grass hue`).toBeGreaterThanOrEqual(55);
        expect(h, `${name} grass hue`).toBeLessThanOrEqual(75);
        expect(s, `${name} grass saturation`).toBeGreaterThanOrEqual(0.78);
        expect(v, `${name} grass value`).toBeGreaterThanOrEqual(0.3);
        expect(v, `${name} grass value`).toBeLessThanOrEqual(0.55);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a layer tone triple stays low contrast', () => {
    // Broad, soft, low-contrast fields — not a two-colour ramp. The old grass
    // spanned #2C3309..#6C7C1C, a 2.4x luminance range, and its dark end was
    // exactly what the fog dragged into the emerald window.
    for (const name of BIOME_NAMES) {
      for (const L of BIOMES[name].layers) {
        if (L.surface !== 'field') continue;
        const lum = layerColours(L).map((hex) => {
          const [r, g, b] = hexRgb(hex);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        });
        const ratio = Math.max(...lum) / Math.max(1e-4, Math.min(...lum));
        expect(ratio, `${name}/${L.label} tone range`).toBeLessThan(1.5);
      }
    }
  });
});

/* ==========================================================================
 * 2. THE GENERATED TILES
 * ========================================================================== */

describe('terrain layer surfaces', () => {
  const cases: ReadonlyArray<readonly [string, SurfaceLayerDef]> = BIOME_NAMES.flatMap(
    (name) => BIOMES[name].layers.map((L) => [`${name}/${L.label}`, L] as const),
  );

  it('every layer passes the noise budget', () => {
    for (const [id, L] of cases) {
      const report = checkNoiseBudget(buildLayerSurface(L, SIZE));
      expect(report.speckleRatio, `${id} speckle`).toBeLessThan(0.002);
    }
  });

  it('no generated texel lands in the emerald window', () => {
    for (const [id, L] of cases) {
      const s = buildLayerSurface(L, SIZE);
      let leaked = 0;
      for (let i = 0; i < s.size * s.size; i++) {
        const [h, sat, v] = rgbToHsv(s.albedo[i * 3], s.albedo[i * 3 + 1], s.albedo[i * 3 + 2]);
        if (isEmerald(h, sat, v)) leaked++;
      }
      expect(leaked, `${id} leaked ${leaked} texels`).toBe(0);
    }
  });

  it('field tiles are exactly flat in height', () => {
    for (const [id, L] of cases) {
      if (L.surface !== 'field') continue;
      const s = buildLayerSurface(L, SIZE);
      for (let i = 0; i < s.size * s.size; i++) {
        expect(s.height[i], `${id} height at ${i}`).toBe(0.5);
      }
    }
  });

  it('field tiles stay inside their own contrast budget', () => {
    for (const [id, L] of cases) {
      if (L.surface !== 'field') continue;
      const { min, max } = luminanceRange(buildLayerSurface(L, SIZE));
      // Drift is capped at FIELD_DRIFT_CAP either side, and the patches can
      // reach shade/accent. Anything beyond 1.45x is a ramp, not a field.
      expect(max / Math.max(1e-4, min), `${id} tile contrast`).toBeLessThan(1.45);
    }
  });

  it('field tiles are seamless across the wrap', () => {
    for (const [id, L] of cases) {
      if (L.surface !== 'field') continue;
      const s = buildLayerSurface(L, SIZE);
      for (let y = 0; y < SIZE; y++) {
        // budgetedNoise is a sum of plane waves at INTEGER frequencies, so the
        // field is exactly periodic: the step from the last column back to the
        // first is no bigger than any interior step.
        const a = s.albedo[(y * SIZE + SIZE - 1) * 3];
        const b = s.albedo[(y * SIZE) * 3];
        const interior = Math.abs(s.albedo[(y * SIZE + 1) * 3] - b);
        expect(Math.abs(a - b), `${id} wrap seam at row ${y}`)
          .toBeLessThan(interior + 0.01);
      }
    }
  });

  it('generation is deterministic', () => {
    const L = BIOMES.temperate.layers[0];
    const a = buildFieldSurface(L, SIZE);
    const b = buildFieldSurface(L, SIZE);
    expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
  });

  it('field drift never asks for a feature finer than the floor', () => {
    // Guards the two constants against a well-meaning future edit: the whole
    // point is that the shortest wavelength is a multiple of the assets.ts
    // floor, so no drift can alias into grain.
    expect(FIELD_MIN_WAVELENGTH).toBeGreaterThanOrEqual(48);
    expect(FIELD_DRIFT_CAP).toBeLessThanOrEqual(0.06);
  });
});

/* ==========================================================================
 * 3. THE PACKED ARRAY
 * ========================================================================== */

describe('buildLayerArrayTexture', () => {
  it('packs six non-empty layers for every biome', () => {
    for (const name of BIOME_NAMES) {
      const tex = buildLayerArrayTexture(BIOMES[name], SIZE);
      expect(tex.image.depth).toBe(SURFACE_COUNT);
      const data = tex.image.data as Uint8Array;
      expect(data.length).toBe(SIZE * SIZE * 4 * SURFACE_COUNT);
      for (let i = 0; i < SURFACE_COUNT; i++) {
        const o = SIZE * SIZE * 4 * i;
        expect(data[o] + data[o + 1] + data[o + 2], `${name} layer ${i} is black`)
          .toBeGreaterThan(0);
      }
      tex.dispose();
    }
  });
});

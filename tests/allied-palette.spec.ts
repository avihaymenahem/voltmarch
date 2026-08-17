/**
 * The Allied palette rules, pinned as numbers.
 *
 * `tools/metrics.mjs` scores the FRAME, so a law about one army's albedo has no
 * gate of its own and rots unwatched — which is how `RA3_ALLIED_STRUCTURE.base`
 * came to sit at a value that made its own greebling mathematically
 * unrepresentable for the whole life of the project.
 *
 * TWO RULES THAT BELONG HERE ARE DELIBERATELY ABSENT, and their absence is the
 * finding rather than an omission. Both are written up with their measurements
 * in docs/RENDER_FINDINGS.md §6b and §6c:
 *
 *   - `shadowIntensity` is banned by RA3_LOOK_BIBLE.md §3.3 by name and is
 *     nonetheless still 0.80. Asserting 1.0 would fail; asserting 0.80 would PIN
 *     A DEFECT, and a green suite that is evidence for the wrong thing is worse
 *     than no test. Removing it alone takes scorecard #9 on `09-placement` from
 *     0.0123 to 0.0640 against a 0.02 ceiling, so it is a paired change with the
 *     hemisphere fill and gets its own commit.
 *   - Terrain `envMapIntensity` cannot be asserted because the material knob is
 *     INERT — measured at 0 pixels changed between 0.0 and 8.0. A test for it
 *     would pass while guarding nothing, which is exactly the `SURFACES` failure
 *     mode: a fully-specified table with no readers.
 *
 * When either is genuinely wired, its assertion belongs here.
 */
import { describe, expect, it } from 'vitest';

import { RA3_ALLIED_STRUCTURE, RA3_SOVIET_STRUCTURE, RA3_PAD_PALETTE } from '../src/core/config';

/** Value channel of a `#rrggbb` string, 0..1 — HSV's V, i.e. max(r,g,b). */
function valueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255;
}

/** Saturation of a `#rrggbb` string, 0..1. */
function satOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** sRGB luminance of a `#rrggbb` string, 0..255. */
function lumaOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

describe('Allied structure albedo leaves room for its own greebling', () => {
  /*
   * The atlas's detail language is MULTIPLICATIVE on the base: cavity recess
   * x0.32, a +16% lip, a +22% V bevel. So `base * 1.22` has to stay below 1.0
   * or the brightest half of the detail is unrepresentable in albedo, before a
   * single photon. At the '#BCC6D6' this shipped with, V 0.839, the bevel
   * computed to 1.024 and every lit Allied facade clipped:
   *
   *     01-establishing-base (Allied)   2.37% of frame pure white
   *     07-soviet-base       (Soviet)   0.00%
   *
   * Same generator, same lighting, same fixtures. The greebling was never
   * missing, it was being tone-mapped off.
   */
  const BEVEL_VALUE_GAIN = 1.22;

  it('the bevel highlight is representable', () => {
    const v = valueOf(RA3_ALLIED_STRUCTURE.base);
    expect(
      v * BEVEL_VALUE_GAIN,
      `RA3_ALLIED_STRUCTURE.base is ${RA3_ALLIED_STRUCTURE.base} (V ${v.toFixed(3)}), so its `
      + '+22% bevel lands above 1.0 in ALBEDO and clips before it is ever lit. '
      + 'Lower the base; do not answer a flat-looking facade by adding panel lines.',
    ).toBeLessThan(1.0);
  });

  it('but is not so dark that highlights stop reaching', () => {
    /*
     * The opposite failure, and it was measured too: V 0.729 fixed the clipping
     * and took `03-terrain-closeup` BELOW scorecard #6's p99 floor (0.8990
     * against 0.9000), with 10-selection -0.021 and 11-dusk-mood -0.040. The
     * cure for a clipped top end is to get under 1.0 with headroom, not to go
     * as dark as the Soviets.
     */
    expect(valueOf(RA3_ALLIED_STRUCTURE.base)).toBeGreaterThan(0.75);
  });

  it('stays the palest army, and stays ceramic rather than Soviet olive', () => {
    expect(valueOf(RA3_ALLIED_STRUCTURE.base))
      .toBeGreaterThan(valueOf(RA3_SOVIET_STRUCTURE.base));
    // Low chroma is what makes it read as white ceramic at all.
    expect(satOf(RA3_ALLIED_STRUCTURE.base)).toBeLessThan(0.20);
  });
});

describe('foundation pads read as aprons, not as holes in the map', () => {
  /*
   * Measured on the shipped captures before the change:
   *
   *                             01-establishing-base   07-soviet-base
   *     Allied pad, on screen        23  (12.3% of frame)    18
   *     ground IN CAST SHADOW        53                      57
   *     lit ground beside it        106                     103
   *
   * The Allied pad was 2.3x DARKER THAN A CAST SHADOW over a twelfth of the
   * frame. Nothing that dark reads as occluded ground; it reads as a hole cut
   * in the map. RA3's aprons are concrete, with the darkening supplied by
   * contact AO rather than by albedo.
   *
   * The other three armies already agreed — Soviet V 0.54, Meridian V 0.56,
   * Reclamation V 0.44 — and the Pact's own palette comment states the
   * principle: "a bone building on a near-black pad reads as a model on a
   * plinth; a bone building on a warm stone pad reads as a building on ground."
   * The Allied pad at V 0.19 was the lone outlier, under the whitest buildings
   * in the game.
   */
  const GRASS_ALBEDO_LUMA = lumaOf('#666B44'); // TERRAIN_NOON.grass, ~103

  for (const [faction, pad] of Object.entries(RA3_PAD_PALETTE)) {
    it(`${faction}: the pad is not darker than the ground it sits on`, () => {
      expect(
        lumaOf(pad.base),
        `${faction} pad base ${pad.base} is darker than grass. A pad darker than `
        + 'its surroundings cannot read as ground — the contact pool supplies the '
        + 'darkening, the albedo must not.',
      ).toBeGreaterThan(GRASS_ALBEDO_LUMA * 0.9);
    });

    it(`${faction}: pad detail colours stay ordered around the base`, () => {
      // These were all ratios of a near-black base on Allies, so `bareMetal`
      // and `trackLink` had ended up DARKER than concrete would be.
      expect(lumaOf(pad.shadow)).toBeLessThan(lumaOf(pad.base));
      expect(lumaOf(pad.bareMetal)).toBeGreaterThan(lumaOf(pad.trackLink));
    });
  }
});

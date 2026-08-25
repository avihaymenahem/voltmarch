/**
 * THE "VALID" GREEN IS ONE COLOUR, AND IT STAYS OUT OF THE EMERALD WINDOW.
 *
 * Two facts about `PLACEMENT.validColor` that a reviewer would have to know to
 * check, and which nothing was checking.
 *
 * 1. IT IS THE SAME COLOUR AS `HudLook.ok`, deliberately: the sidebar says
 *    "this is valid" in one green and the world says it in another the moment
 *    the two drift. They were both #4ADE80 and both moved to #34D399 together;
 *    the failure mode is somebody retuning one of them for a measurement and
 *    leaving the other, which is silent on screen until you put a ghost next to
 *    the panel.
 *
 * 2. IT IS NOT A COLOUR THE HOLOGRAM CAN COMPOSITE INTO SCORECARD #9.
 *    `PlacementController.updateMeshes` writes this tint onto `volumeMat`, and
 *    that volume is `DoubleSide` at `ghostOpacity`, so roughly twice that alpha
 *    of this exact hue lands over whatever ground the ghost is standing on. At
 *    #4ADE80 (hue 142) the composite over sunlit grass measured hue 100.7 —
 *    inside the 100-120 window scorecard #9 bans, and `09-placement` failed at
 *    0.0516 against a 0.02 ceiling. Captured across the hue axis with the rest
 *    of the frame held fixed, the knee is sharp: hue 146 -> 0.0392,
 *    151 -> 0.0262, 155 -> 0.0097. Hence the floor asserted here.
 *
 * The floor is on the AUTHORED hue, which is a proxy — the metric measures the
 * composited, graded pixel and only `npm run shots` can do that. It is the
 * right proxy because the composite is monotone in this hue over the range that
 * matters, and because a proxy that fails in CI beats a regression that waits
 * for somebody to run the capture harness.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_ART, PLACEMENT } from '../src/core/config';

/** HSV hue in degrees, the form `tools/metrics.mjs` uses. */
function hue(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let x: number;
  if (max === r) x = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) x = (b - r) / d + 2;
  else x = (r - g) / d + 4;
  return x * 60;
}

describe('the valid/OK green', () => {
  it('is one colour in the world and in the HUD', () => {
    expect(PLACEMENT.validColor.toUpperCase()).toBe(DEFAULT_ART.hud.ok.toUpperCase());
  });

  it('sits clear of the hue knee that puts the hologram in scorecard #9', () => {
    expect(hue(PLACEMENT.validColor)).toBeGreaterThanOrEqual(155);
  });

  it('is still a green rather than a cyan', () => {
    expect(hue(PLACEMENT.validColor)).toBeLessThan(180);
  });

  it('stays distinguishable from the invalid tint', () => {
    // Nothing subtle required — these two must never be confusable at a glance.
    const dh = Math.abs(hue(PLACEMENT.validColor) - hue(PLACEMENT.invalidColor));
    expect(Math.min(dh, 360 - dh)).toBeGreaterThan(90);
  });
});

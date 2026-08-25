/**
 * ============================================================================
 * tests/infantry-legibility.spec.ts
 * ============================================================================
 * The minimum SCREEN size for infantry.
 *
 * `UNIT_DIMENSIONS` calls itself "the only defence against 'the infantry look
 * like ants'", and against the ART it is: nothing may author a rifleman at
 * half a metre. It cannot defend the thing three separate reports were
 * actually about, which is how many PIXELS the rifleman gets — a function of
 * the camera and the viewport, neither of which is in that table.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - IT DOES NOTHING UNTIL IT HAS TO, and specifically nothing at
 *     `CAMERA.defaultDistance`. A floor that crept above 1 at the zoom most
 *     play happens at would trade a real fix for a new complaint, and the
 *     constant was chosen off that row of the measurement for that reason.
 *   - IT DOES NOT RUN AWAY. Uncapped, the formula grows without bound and a
 *     rifleman ends up taller than the Proving Ground.
 *   - THERE ARE TWO FLOORS AND THE LARGER WINS. Apparent size (CSS pixels) and
 *     sample count (drawing-buffer pixels) are different failures: a 4K panel
 *     fixes the second without touching the first, and adaptive resolution
 *     wrecks the second while leaving the first alone. One lever cannot answer
 *     both, so the cases below pin each one separately.
 *   - IT SURVIVES A DEGENERATE CAMERA. This runs every frame off live numbers;
 *     a NaN here becomes a NaN in an instance matrix, which is the exact route
 *     by which this repo once got a fully black frame out of one bad index.
 *
 * The suite runs under `environment: 'node'`: the function is pure arithmetic
 * over four numbers and imports nothing, which is why it lives in
 * `core/config.ts` rather than in the render layer.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import {
  CAMERA,
  INFANTRY_LEGIBILITY,
  UNIT_DIMENSIONS,
  infantryLegibilityScale,
} from '../src/core/config';

/**
 * `CAMERA.fovDeg`, not `RENDER_CONFIG.camera.fov`. Both hold 36 and this is
 * the source — `ArtBridge.cameraPatch()` pushes core's camera block into the
 * render config at boot. Importing renderer.ts here would drag THREE and a
 * module-scope `window` into a node suite for a number core already owns.
 */
const FOV = CAMERA.fovDeg;
const H = UNIT_DIMENSIONS.infantry.h;

/** A healthy machine: device ratio 1, no adaptive-resolution drop. */
function native(distance: number, viewport: number): number {
  return infantryLegibilityScale(distance, FOV, viewport, viewport);
}

/** Height in pixels of an `h`-metre object at `d` metres. Aspect cancels. */
function pixelsFor(h: number, d: number, viewport: number): number {
  return (h * viewport) / (2 * d * Math.tan((FOV * Math.PI) / 360));
}

/* ========================================================================== */

describe('the floor does nothing until it has to', () => {
  it('leaves the DEFAULT zoom exactly untouched', () => {
    // This is the whole reason `minCssPixels` is 37 and not 40. Measured
    // through the live camera at 1366x768, a rifleman is 37.4 px tall at
    // `CAMERA.defaultDistance`, so he clears the floor on his own and the
    // shipping look at the zoom most play happens at does not move.
    expect(CAMERA.defaultDistance).toBe(55);
    for (const viewport of [768, 900, 1080, 1440, 2160]) {
      expect(native(CAMERA.defaultDistance, viewport), `viewport ${viewport}`).toBe(1);
    }
  });

  it('leaves everything closer than the default alone too', () => {
    for (let d = CAMERA.minDistance; d <= CAMERA.defaultDistance; d += 1) {
      expect(native(d, 768), `d=${d}`).toBe(1);
    }
  });

  it('never returns less than 1 — it is a floor, not a normaliser', () => {
    for (let d = 1; d <= 400; d += 3) {
      for (const v of [396, 720, 768, 1080, 1440, 2160]) {
        expect(native(d, v), `d=${d} v=${v}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('rises monotonically as the camera pulls back', () => {
    let prev = 0;
    for (let d = 10; d <= 300; d += 5) {
      const s = native(d, 768);
      expect(s, `d=${d}`).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

/* ========================================================================== */

describe('the floor bites where the report said it hurts', () => {
  it('corrects meaningfully at 90 m, the worst gameplay camera measured', () => {
    // 21.7 px tall and 9.6 px wide at 1366x768, against a Warden's 81.5 x
    // 92.2 — a 36x area difference, almost all of it width. This is the case
    // the whole change exists for, so it is asserted rather than described.
    const s = native(90, 768);
    expect(s).toBeGreaterThan(1.5);
    expect(s).toBeLessThanOrEqual(INFANTRY_LEGIBILITY.maxScale);
  });

  it('is pinned at the cap by the time the camera is all the way out', () => {
    expect(native(CAMERA.maxDistance, 768)).toBe(INFANTRY_LEGIBILITY.maxScale);
  });

  it('lands the model exactly on the floor wherever the cap is not binding', () => {
    for (let d = 56; d <= 200; d += 2) {
      const s = native(d, 768);
      if (s <= 1 || s >= INFANTRY_LEGIBILITY.maxScale) continue;
      expect(pixelsFor(H * s, d, 768), `d=${d}`)
        .toBeCloseTo(INFANTRY_LEGIBILITY.minCssPixels, 6);
    }
  });
});

/* ========================================================================== */

describe('two floors, because there are two ways to become unreadable', () => {
  it('never lets the buffer floor bind on a machine that is not cutting', () => {
    // `minBufferPixels` is deliberately the lower number. At device ratio 1
    // with no resolution drop the CSS floor is always the larger, so the
    // sample floor costs nothing on a healthy machine.
    expect(INFANTRY_LEGIBILITY.minBufferPixels)
      .toBeLessThan(INFANTRY_LEGIBILITY.minCssPixels);
    for (let d = 30; d <= 140; d += 2) {
      const both = native(d, 768);
      const cssOnly = infantryLegibilityScale(d, FOV, 0, 768);
      expect(both, `d=${d}`).toBe(cssOnly);
    }
  });

  it('asks for more scale once adaptive resolution starts cutting the buffer', () => {
    // The measured case: a 1280x720 viewport rendering at 704x396. The soldier
    // is the same SIZE on screen and a third as well SAMPLED, which is the
    // `min 0` in the report — pixels that no longer differ from the background
    // by the 10/255 the measurement counted.
    const healthy = infantryLegibilityScale(90, FOV, 720, 720);
    const cutting = infantryLegibilityScale(90, FOV, 396, 720);
    expect(cutting).toBeGreaterThan(healthy);
  });

  it('is driven by CSS pixels on a high-DPI panel, not by the extra samples', () => {
    // A 2x device ratio doubles the buffer and changes the apparent size not
    // at all. A floor computed only in buffer pixels would quietly stop
    // correcting on exactly the displays where the units are physically
    // smallest, which is backwards.
    const standard = infantryLegibilityScale(110, FOV, 768, 768);
    const retina = infantryLegibilityScale(110, FOV, 1536, 768);
    expect(retina).toBe(standard);
    expect(retina).toBeGreaterThan(1);
  });
});

/* ========================================================================== */

describe('it refuses to produce nonsense from nonsense', () => {
  it('returns exactly 1 for a degenerate camera or viewport', () => {
    const bad: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, FOV, 768, 768], [-5, FOV, 768, 768],
      [90, 0, 768, 768], [90, -1, 768, 768],
      [90, FOV, 0, 0], [90, FOV, -100, -100],
      [NaN, FOV, 768, 768], [90, NaN, 768, 768],
      [90, FOV, NaN, NaN], [Infinity, FOV, 768, 768],
    ];
    for (const a of bad) {
      const s = infantryLegibilityScale(a[0], a[1], a[2], a[3]);
      expect(Number.isFinite(s), `args ${a.join(',')}`).toBe(true);
      expect(s, `args ${a.join(',')}`).toBe(1);
    }
  });
});

/* ========================================================================== */

describe('the cap keeps a rifleman a rifleman', () => {
  it('stops him at the height of the tallest thing that already drives around', () => {
    const scaled = UNIT_DIMENSIONS.infantry.h * INFANTRY_LEGIBILITY.maxScale;
    // He is allowed to out-top a tank — RA2 and RA3 both let him, and the eye
    // reads size within a class rather than across one. He is not allowed to
    // out-top the whole roster.
    const tallest = Math.max(...Object.values(UNIT_DIMENSIONS).map((d) => d.h));
    expect(scaled).toBeLessThanOrEqual(tallest);
    expect(scaled).toBeGreaterThan(UNIT_DIMENSIONS.lightTank.h);
  });
});

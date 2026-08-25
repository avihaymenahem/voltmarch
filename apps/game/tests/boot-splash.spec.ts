/**
 * ============================================================================
 * tests/boot-splash.spec.ts — the loading curtain's key art
 * ============================================================================
 * The splash is a SUPPLIED ILLUSTRATION, one of the handful of things in this
 * product that is not generated from code, and it is the first thing the page
 * paints. Three properties are worth pinning, and each of them was got wrong
 * once while this was being written.
 *
 * 1. THE CROP GEOMETRY IS DERIVED, NOT CHOSEN. The artwork carries its own
 *    VOLTMARCH lockup, so `index.html` hides the DOM wordmark rather than draw
 *    two — but only where `object-fit: cover` actually keeps the artwork's one.
 *    The first attempt used a 4:3 threshold reasoned from an assumption about
 *    portrait crops, and a screenshot at 569x595 showed two lockups stacked
 *    down the page. The real bound is 0.676, and it follows from the measured
 *    box below. This file recomputes it so the numbers in the CSS cannot drift
 *    away from the artwork they describe.
 *
 * 2. THE PRELOAD MUST MATCH THE <img>. `imagesrcset`/`imagesizes` on the
 *    preload hint and `srcset`/`sizes` on the element are matched by the
 *    browser to decide whether the preload was used. A mismatch is not an
 *    error — it silently fetches the image TWICE, which on the one asset that
 *    blocks the first paint is the opposite of the intent.
 *
 * 3. IT MUST DEGRADE TO THE OLD CURTAIN. Every art rule keys off `.has-art`,
 *    which the boot script sets only after a real decode. A 404 or a corrupt
 *    file has to leave the curtain that shipped before this existed —
 *    wordmark included — not a black rectangle with a progress bar.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CHECK: whether the picture is nice.
 * `npm run shots` cannot see this at all — the curtain is dismissed before any
 * fixture is posed — so there is no scorecard here to lean on and no point
 * pretending otherwise.
 * ============================================================================
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const HTML = readFileSync(join(ROOT, 'apps/game/index.html'), 'utf8');

/** The derived artwork, and the natural size `tools/splash.mjs` emits. */
const SOURCE_W = 1600;
const SOURCE_H = 900;
const SOURCE_ASPECT = SOURCE_W / SOURCE_H;

/**
 * WHERE THE ARTWORK'S OWN LOCKUP SITS, as a fraction of the frame.
 *
 * Measured off `public/brand/splash-1600.webp` by cropping to these exact
 * bounds and confirming the wordmark is whole with a small margin on all four
 * sides — not estimated from looking at the full image, which is how the 4:3
 * mistake happened. If the artwork is ever replaced, re-measure and change
 * these four numbers; everything else in this file follows from them.
 */
const LOCKUP = { x0: 0.310, x1: 0.687, y0: 0.030, y1: 0.346 } as const;

/* -------------------------------------------------------------------------- */

/** `cover` on a viewport NARROWER than the source crops width to `A/S`, centred. */
function minAspectKeepingLockup(): number {
  const halfNeeded = Math.max(0.5 - LOCKUP.x0, LOCKUP.x1 - 0.5);
  return 2 * SOURCE_ASPECT * halfNeeded;
}

/** `cover` on a viewport WIDER than the source crops height; this is the top edge. */
function visibleTopAt(aspect: number, posY: number): number {
  return posY * (1 - SOURCE_ASPECT / aspect);
}

/** Pull `object-position: 50% N%` out of the `#splash-art` rule. */
function objectPositionY(): number {
  const rule = /#splash-art\s*\{[\s\S]*?\}/.exec(HTML);
  expect(rule, '#splash-art has no CSS rule in index.html').not.toBeNull();
  const m = /object-position:\s*50%\s+([\d.]+)%/.exec(rule?.[0] ?? '');
  expect(m, '#splash-art must declare `object-position: 50% N%`').not.toBeNull();
  return Number(m?.[1]) / 100;
}

/** Pull the aspect threshold guarding the duplicate-wordmark rule. */
function titleHideAspect(): number {
  const m = /@media\s*\(aspect-ratio\s*>=\s*(\d+)\s*\/\s*(\d+)\s*\)\s*\{\s*#loading\.has-art/.exec(HTML);
  expect(m, 'the duplicate-wordmark rule must sit behind an `aspect-ratio >=` media query').not.toBeNull();
  return Number(m?.[1]) / Number(m?.[2]);
}

/** The portrait branch's threshold, which must be the exact complement. */
function portraitScrimAspect(): number {
  const m = /@media\s*\(aspect-ratio\s*<\s*(\d+)\s*\/\s*(\d+)\s*\)/.exec(HTML);
  expect(m, 'the portrait scrim rule must sit behind an `aspect-ratio <` media query').not.toBeNull();
  return Number(m?.[1]) / Number(m?.[2]);
}

/* ========================================================================== */

describe('the derived splash assets', () => {
  const files = [
    // The backdrop, and the ceiling that keeps it a splash rather than a wait.
    { name: 'splash-1600.webp', maxKb: 400 },
    // The small-viewport srcset entry.
    { name: 'splash-640.webp', maxKb: 90 },
  ] as const;

  for (const f of files) {
    it(`ships ${f.name} under ${f.maxKb} kB`, () => {
      const p = join(ROOT, 'apps/game/public', 'brand', f.name);
      expect(existsSync(p), `${f.name} is missing — run \`node tools/splash.mjs\``).toBe(true);
      const kb = statSync(p).size / 1024;
      /*
       * A CEILING, NOT A TARGET. This asset is alone on screen while the 2.7 MB
       * entry chunk parses, so its weight is not amortised by anything. The
       * supplied PNG was 2.83 MB; re-encoding it at PNG or bumping the WebP
       * quality to "look nicer at 400% zoom" would put the splash behind the
       * thing it exists to cover.
       */
      expect(kb, `${f.name} is ${kb.toFixed(0)} kB`).toBeLessThan(f.maxKb);
    });
  }

  it('keeps the source out of public/ — it is an input, not a shipped file', () => {
    // The logo source lived in public/brand/ once and 2.4 MB nothing loads was
    // published on every deploy. Same trap, same directory, different image.
    expect(existsSync(join(ROOT, 'tools', 'brand-source', 'splash-source.png'))).toBe(true);
    expect(existsSync(join(ROOT, 'apps/game/public', 'brand', 'splash-source.png'))).toBe(false);
  });
});

describe('the preload hint and the <img> agree', () => {
  it('declares the same srcset in both places, or the image is fetched twice', () => {
    const preload = /imagesrcset="([^"]+)"/.exec(HTML)?.[1]?.replace(/\s+/g, ' ').trim();
    const img = /<img id="splash-art"[\s\S]*?srcset="([^"]+)"/.exec(HTML)?.[1]?.replace(/\s+/g, ' ').trim();
    expect(preload, 'no imagesrcset on the splash preload').toBeTruthy();
    expect(img, 'no srcset on #splash-art').toBeTruthy();
    expect(img).toBe(preload);
  });

  it('declares the same sizes in both places', () => {
    const preload = /imagesizes="([^"]+)"/.exec(HTML)?.[1]?.trim();
    const img = /<img id="splash-art"[\s\S]*?\ssizes="([^"]+)"/.exec(HTML)?.[1]?.trim();
    expect(img).toBe(preload);
  });
});

describe('the crop keeps the artwork\'s own wordmark', () => {
  it('hides the DOM wordmark only above the aspect where the artwork keeps its own', () => {
    const required = minAspectKeepingLockup();
    // Sanity on the derivation itself: the measured box gives 0.676, NOT the
    // 1.333 that a 4:3 threshold assumes. This assertion is the record of that.
    expect(required).toBeGreaterThan(0.6);
    expect(required).toBeLessThan(0.7);

    const threshold = titleHideAspect();

    /*
     * BOUNDED ON BOTH SIDES, because the two failures are different and both
     * were shipped for a moment while this was written.
     *
     * Too LOW and the curtain hides the <h1> on viewports where the painted
     * lockup is already cut — a title screen with no title.
     *
     * Too HIGH and it opens a band between `required` and the threshold where
     * the painted lockup is whole AND the <h1> draws over it: two VOLTMARCHes
     * down the page. That is the original defect, and padding this number
     * "for safety" is what reintroduced it at 4/5. Safety margin belongs in
     * LOCKUP, which is already measured with slack.
     */
    expect(
      threshold,
      `the artwork's lockup is only whole at viewport aspect >= ${required.toFixed(3)}; `
      + 'hiding the DOM wordmark below that leaves the curtain with no title at all',
    ).toBeGreaterThanOrEqual(required);

    expect(
      threshold,
      `the artwork keeps its lockup from aspect ${required.toFixed(3)}, but the DOM wordmark `
      + `is not hidden until ${threshold.toFixed(3)} — every viewport in between draws BOTH`,
    ).toBeLessThan(required * 1.05);
  });

  it('splits landscape and portrait at one exact threshold, with no overlap and no gap', () => {
    /*
     * `min-aspect-ratio` and `max-aspect-ratio` are BOTH inclusive, so writing
     * the pair that way makes them both match at exactly 17/25: the DOM
     * wordmark hidden AND the artwork's buried under a 96% scrim — a title
     * screen with no title, at one precise window shape. Range syntax makes
     * the split exact, and this pins the two halves to the same number.
     */
    expect(portraitScrimAspect()).toBe(titleHideAspect());
  });

  it('anchors the crop high enough to keep the lockup at 21:9', () => {
    const posY = objectPositionY();
    const top = visibleTopAt(21 / 9, posY);
    expect(
      top,
      `object-position 50% ${(posY * 100).toFixed(0)}% puts the visible top edge at `
      + `${top.toFixed(3)} on a 21:9 display, below the lockup's ${LOCKUP.y0}`,
    ).toBeLessThanOrEqual(LOCKUP.y0);
  });

  it('is a no-op at or below 16:9, where cover crops width instead of height', () => {
    /*
     * Guards against someone "fixing" the ultrawide anchor with a value that
     * quietly reframes the common case — 16:9 and 16:10 are what almost every
     * player is on, and the desktop window opens at 1600x900.
     *
     * `1 - S/A` is the fraction of source HEIGHT cover throws away. At or
     * below the source aspect it is negative, which is the formula's way of
     * saying the crop has moved to the other axis; clamped at zero, the
     * object-position term drops out entirely whatever it is set to.
     */
    for (const a of [16 / 9, 16 / 10, 4 / 3, 1, 9 / 16]) {
      const croppedFraction = Math.max(0, 1 - SOURCE_ASPECT / a);
      expect(croppedFraction * objectPositionY(), `aspect ${a.toFixed(3)}`).toBe(0);
    }
  });
});

describe('it degrades to the curtain that shipped before it', () => {
  it('gates every art rule behind .has-art', () => {
    // If any splash rule applied unconditionally, a 404 would leave the layout
    // rearranged for artwork that is not there.
    const artRules = HTML.match(/^\s*#loading\.has-art[^{]*\{/gm) ?? [];
    expect(artRules.length).toBeGreaterThan(2);
    // The layout move to a lower third is the one that would strand the
    // furniture at the bottom of a black screen.
    expect(HTML).toMatch(/#loading\.has-art\s*\{\s*justify-content:\s*flex-end/);
  });

  it('sets .has-art only on a real decode, and handles the warm-cache case', () => {
    /*
     * `naturalWidth > 0` is the difference between "loaded" and "finished
     * trying" — `complete` is true for a broken image too. And `complete` must
     * be tested BEFORE addEventListener, because this script runs after the
     * <img> in document order: on a warm cache the load event has already
     * fired, which is every launch after the first and every desktop launch.
     */
    expect(HTML).toMatch(/naturalWidth\s*>\s*0/);
    expect(HTML).toMatch(/if\s*\(art\.complete\)\s*arm\(\)/);
  });

  it('brings the wordmark back for the failure states', () => {
    // `.title img` carries the alarm blink, so hiding it in an error state
    // would delete the alarm rather than merely the logo.
    expect(HTML).toMatch(/#loading\.has-art:not\(\[data-state\]\)\s*\.title/);
    expect(HTML).toMatch(/#loading\.has-art\[data-state\]\s*#splash-art/);
  });
});

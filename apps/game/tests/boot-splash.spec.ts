/**
 * ============================================================================
 * tests/boot-splash.spec.ts — the loading curtain's key art
 * ============================================================================
 * The splash is a SUPPLIED ILLUSTRATION, one of the handful of things in this
 * product that is not generated from code, and it is the first thing the page
 * paints. Three properties are worth pinning, and each of them was got wrong
 * once while this was being written.
 *
 * 1. THE DOM WORDMARK IS CANONICAL. The replacement art contains no lettering,
 *    so no crop or media query may hide the accessible title.
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
       * Re-encoding it losslessly or bumping the WebP quality to "look nicer
       * at 400% zoom" would put the splash behind the thing it exists to cover.
       */
      expect(kb, `${f.name} is ${kb.toFixed(0)} kB`).toBeLessThan(f.maxKb);
    });
  }

  it('keeps the source out of public/ — it is an input, not a shipped file', () => {
    // The logo source lived in public/brand/ once and 2.4 MB nothing loads was
    // published on every deploy. Same trap, same directory, different image.
    expect(existsSync(join(ROOT, 'tools', 'brand-source', 'splash-source.webp'))).toBe(true);
    expect(existsSync(join(ROOT, 'apps/game/public', 'brand', 'splash-source.webp'))).toBe(false);
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

describe('the DOM wordmark remains canonical', () => {
  it('never hides the accessible title when key art decodes', () => {
    expect(HTML).toContain('<h1 class="title">');
    expect(HTML).not.toMatch(/#loading\.has-art[^\{]*\.title\s*\{\s*display:\s*none/);
  });

  it('uses a stable centred crop for the letter-free art', () => {
    expect(HTML).toMatch(/#splash-art\s*\{[\s\S]*?object-position:\s*50%\s+50%/);
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

  it('keeps failure states legible without changing title ownership', () => {
    expect(HTML).toMatch(/#loading\.has-art\[data-state\]\s*#splash-art/);
  });
});

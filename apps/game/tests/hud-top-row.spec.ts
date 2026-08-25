/**
 * ============================================================================
 * tests/hud-top-row.spec.ts — THE TOP ROW IS A CORRIDOR, AND IT WAS OVERSOLD
 * ============================================================================
 * Reported as two things that turned out to be one:
 *
 *   "The top middle main hud, its getting huge and sometimes almost
 *    overlaaping with objectives."
 *   "The objectives hud, maybe we place it on left screen?"
 *
 * IT WAS NOT "SOMETIMES" AND IT WAS NOT "ALMOST". Measured in the real game
 * (headless Chromium, `?shot=02-hud-full`, `__VM.setUiVisible(true)`) at
 * 1920x1080, on a match that had only just started:
 *
 *     --vm-u                 1.5px
 *     .vm-resources          x 369.75 .. 1550.25   (w 1180.5)
 *     .vm-objectives left    1518          -> 32.25 px of overlap
 *     .vm-dock-build left    1545          -> 5.25 px of overlap with the rail
 *
 * and the objective panel is `z-index: 5` against the strip's auto, so it
 * paints OVER the INCOME readout rather than under it.
 *
 * MOVING THE PANEL TO THE LEFT DOES NOT FIX IT. The strip is centred
 * (`left: 50%; transform: translateX(-50%)`), so the free space on each side is
 * identical: the same panel on the left edge collides by the same 32.25 px, and
 * would additionally land on `.vm-toasts`, which already sits at 10u/10u with a
 * 250u max-width and is already contended by `src/ui/perf.css`. That is why the
 * fix is in the strip and the panel did not move.
 *
 * THE ACTUAL BUG IS A UNIT MISMATCH
 * ---------------------------------
 * `--vm-u` is `computeUiScale(viewportHEIGHT)`, so every width in the HUD is
 * proportional to the viewport's HEIGHT. Both responsive rules that were meant
 * to stop the top row over-subscribing were written in viewport WIDTH:
 *
 *     @media (max-width: 1180px)   drop the three telltales
 *     @media (max-width: 1000px)   hide the objective panel
 *
 * Those two quantities are only equal at 720p. Measured, with the panel up and
 * realistic late-match content in the strip:
 *
 *     2560x1440  u=2     strip 1597 px   overlap 55 px   query cannot fire
 *     1920x1080  u=1.5   strip 1199 px   overlap 42 px   query cannot fire
 *     1600x900   u=1.25  strip 1000 px   overlap 35 px   query cannot fire
 *     1280x720   u=1     strip  802 px   overlap 29 px   query cannot fire
 *     1152x864   u=1     strip  582 px   clear +17 px    query fired anyway
 *
 * So the row overlapped at every standard 16:9 resolution — which is what the
 * report's "sometimes" actually was: a player only sees it when the progression
 * layer has published an active objective, because `ObjectivesPanel` keeps its
 * root `hidden` otherwise.
 *
 * WHAT THIS FILE PINS
 * -------------------
 * Not a margin. The geometry: for a sweep of real viewports, the strip's right
 * edge must land left of the objective panel's left edge with clearance, using
 * MEASURED strip widths rather than modelled ones. Plus the derivation that
 * produces the thresholds, and the CSS/TS wiring that carries it — because the
 * failure mode of this feature is silent (two panels overlapping looks like a
 * dense HUD, not like a bug).
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeUiScale } from '../src/ui/Chrome';
import {
  TOP_OBJECTIVE_COLUMN,
  TOP_ROW_GUTTER,
  TOP_STRIP_UNITS,
  topRowFit,
  topRowNeeds,
  type TopRowFit,
} from '../src/ui/Hud';

const ROOT = join(__dirname, '..', '..', '..');
const HUD_CSS = readFileSync(join(ROOT, 'apps/game/src/ui/hud.css'), 'utf8');
const OBJ_CSS = readFileSync(join(ROOT, 'apps/game/src/ui/objectives.css'), 'utf8');
const HUD_TS = readFileSync(join(ROOT, 'apps/game/src/ui/Hud.ts'), 'utf8');

/** Strip `/* *​/` comments so prose can never satisfy or break an assertion. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const HUD = stripComments(HUD_CSS);
const OBJ = stripComments(OBJ_CSS);

/** The `N` out of `--token: calc(N * var(--vm-u))`, in design units. */
function units(token: string): number {
  const m = new RegExp(`${token}\\s*:\\s*calc\\(\\s*([\\d.]+)\\s*\\*\\s*var\\(--vm-u\\)\\s*\\)`)
    .exec(HUD);
  expect(m, `${token} is not declared as calc(N * var(--vm-u))`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

/** The body of a named rule block. */
function ruleBody(selector: string, css = HUD): string {
  const block = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    .exec(css);
  expect(block, `no rule for ${selector}`).not.toBeNull();
  return (block as RegExpExecArray)[1];
}

/** The `N` out of `prop: calc(N * var(--vm-u))` inside a named rule block. */
function ruleUnits(selector: string, prop: string): number {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*calc\\(\\s*([\\d.]+)\\s*\\*\\s*var\\(--vm-u\\)\\s*\\)`)
    .exec(ruleBody(selector));
  expect(m, `${selector} does not set ${prop} in design units`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

/* ==========================================================================
 * THE MEASUREMENTS
 *
 * `.vm-resources`'s `getBoundingClientRect().width / --vm-u`, in Chromium with
 * Rajdhani loaded (the fallback stack is a different face and a different
 * width — measuring without the real font over-reads the strip by ~4%), with
 * the tier forced by `data-top-fit` and the worst realistic content in every
 * cell: a seven-figure bank against a seven-figure ceiling, four digits either
 * side of the power slash, an hours-long clock, three-digit telltales.
 *
 * Stable to 0.1u across `--vm-u` 1 .. 3, which is what makes them design-unit
 * facts rather than readings at one resolution.
 *
 * TO REFRESH: mount `ResourceStrip` under a bare `.vm-hud`, set `--vm-u: 1px`
 * and `data-top-fit`, and read the rect. Nothing in `npm test` can do this —
 * vitest runs in node and jsdom has no layout engine — which is exactly why the
 * numbers are written down here instead of being computed.
 * ========================================================================== */
const MEASURED_STRIP_UNITS: Readonly<Record<Exclude<TopRowFit, 'solo'>, number>> = {
  wide: 818.4,
  tight: 598.4,
  bare: 530.1,
};

/** The `solo` tier draws the same strip as `bare`; only the panel differs. */
function stripUnitsAt(fit: TopRowFit): number {
  return MEASURED_STRIP_UNITS[fit === 'solo' ? 'bare' : fit];
}

/**
 * Real viewports, not a grid. Every mainstream desktop resolution, the two
 * aspect ratios that are not 16:9 (16:10, 5:4), the ultrawides, a 4K, and four
 * arbitrary window sizes of the kind a browser actually gets dragged to.
 */
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1280, 720], [1366, 768], [1360, 768], [1440, 900], [1600, 900],
  [1680, 1050], [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440],
  [3440, 1440], [3840, 2160], [1280, 1024], [1024, 768], [1152, 864],
  [1100, 900], [1400, 1080], [1024, 1280], [1000, 1000], [800, 600],
];

/** Every standard 16:9 resolution — the case the report was actually about. */
const SIXTEEN_NINE: ReadonlyArray<readonly [number, number]> = [
  [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
];

/** Viewport width in the unit the whole stylesheet is written in. */
function designWidth(w: number, h: number): number {
  return w / computeUiScale(h);
}

/* ==========================================================================
 * 1. THE GEOMETRY — two rects either intersect or they do not
 * ========================================================================== */

describe('the resource strip clears the objective panel at every viewport', () => {
  for (const [w, h] of VIEWPORTS) {
    const u = computeUiScale(h);
    const du = designWidth(w, h);
    const fit = topRowFit(du);

    it(`${w}x${h} (u=${u}, ${du.toFixed(0)}u wide) fits as '${fit}'`, () => {
      const strip = stripUnitsAt(fit);
      // The strip is centred, so its edges are symmetric about du/2.
      const stripRight = du / 2 + strip / 2;
      const stripLeft = du / 2 - strip / 2;

      // The strip must never leave the frame, at any tier.
      expect(stripLeft, `${w}x${h}: the strip starts off-frame`).toBeGreaterThan(0);

      if (fit === 'solo') {
        // The panel is gone — there is nothing on the right to collide with.
        // That IS the tier's definition, and section 10B of hud.css states it.
        expect(HUD).toContain(".vm-hud[data-top-fit='solo'] .vm-objectives { display: none; }");
        return;
      }

      const panelLeft = du - TOP_OBJECTIVE_COLUMN;
      const clearance = panelLeft - stripRight;
      expect(
        clearance,
        `${w}x${h}: strip ends at ${stripRight.toFixed(1)}u, panel starts at `
          + `${panelLeft.toFixed(1)}u — ${(-clearance * u).toFixed(1)} px of overlap`,
      ).toBeGreaterThan(0);
    });
  }

  it('leaves real clearance everywhere, not a hairline', () => {
    // The thresholds carry one `--vm-gap` of gutter, and `TOP_STRIP_UNITS`
    // rounds the measurements UP, so the worst case is a little under a gutter.
    // Anything at or below zero is an overlap; anything at 1u is a rounding
    // accident waiting to become one.
    let worst = Number.POSITIVE_INFINITY;
    let where = '';
    for (const [w, h] of VIEWPORTS) {
      const du = designWidth(w, h);
      const fit = topRowFit(du);
      if (fit === 'solo') continue;
      const clearance = du / 2 - TOP_OBJECTIVE_COLUMN - stripUnitsAt(fit) / 2;
      if (clearance < worst) { worst = clearance; where = `${w}x${h} (${fit})`; }
    }
    expect(worst, `tightest row is ${where} at ${worst.toFixed(1)}u`).toBeGreaterThanOrEqual(4);
  });
});

/* ==========================================================================
 * 2. THE DEFECT, RECORDED
 *
 * Kept as a test rather than as prose because both halves of it look like
 * tidiness from the inside: `box-sizing` is the sort of thing a cleanup pass
 * deletes, and "just use a media query" is the sort of thing a reviewer asks
 * for. Each of those, alone, puts the overlap back.
 * ========================================================================== */

describe('the geometry that overlapped', () => {
  /** `right: 10u` + `--vm-rail-w: 240u` + 2 x 9u padding, OUTSIDE the width. */
  const CONTENT_BOX_COLUMN = 268;
  /** `wide`, realistic late-match content. Measured the same way as the rest. */
  const OLD_STRIP = 801.7;
  /** The scale curve in effect when this historical defect was captured. */
  const oldUiScale = (height: number): number =>
    Math.min(4, Math.max(1, Math.floor((height / 720) * 4) / 4));

  it('overlapped at every 16:9 resolution before this landed', () => {
    for (const [w, h] of SIXTEEN_NINE) {
      const u = oldUiScale(h);
      const du = w / u;
      const overlap = du / 2 + OLD_STRIP / 2 - (du - CONTENT_BOX_COLUMN);
      expect(overlap, `${w}x${h} did not overlap — re-measure before trusting this file`)
        .toBeGreaterThan(0);
      // 16:9 is 1280 design units wide at every one of those five resolutions,
      // because the former scale curve quantised the height by quarters. So the
      // overlap is one number in design units and five in pixels.
      expect(du).toBeCloseTo(1280, 6);
      expect(overlap * u).toBeGreaterThan(20 * u);
    }
  });

  it('overlapped by the same amount on the left, which is why the panel did not move', () => {
    // The strip is centred. Mirror the panel to the left edge and the two rects
    // intersect by exactly as much — plus `.vm-toasts`, which is already there.
    const du = 1920 / oldUiScale(1080);
    const right = du / 2 + OLD_STRIP / 2 - (du - CONTENT_BOX_COLUMN);
    const left = CONTENT_BOX_COLUMN - (du / 2 - OLD_STRIP / 2);
    expect(left).toBeCloseTo(right, 9);
  });

  it('leaves the reported left placement clear with the current density curve', () => {
    // With the fix in place the row fits — on either side. This is the check
    // that would fail first if someone shrank the corridor again while taking
    // "put objectives on the left" literally.
    const du = designWidth(1920, 1080);
    const fit = topRowFit(du);
    const gapEachSide = du / 2 - TOP_OBJECTIVE_COLUMN - stripUnitsAt(fit) / 2;
    expect(gapEachSide).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 3. THE THRESHOLDS ARE DERIVED FROM THE STYLESHEET
 * ========================================================================== */

describe('the fit thresholds are derived, not chosen', () => {
  it('the objective column is `right` + `--vm-rail-w`, read back out of hud.css', () => {
    const right = ruleUnits('.vm-hud .vm-objectives', 'right');
    const rail = units('--vm-rail-w');
    expect(TOP_OBJECTIVE_COLUMN, `right ${right}u + rail ${rail}u`).toBe(right + rail);
  });

  it('and that sum is only true because the panel is border-box', () => {
    // Without this the 9u padding lands outside the 240u width and the column
    // is 268u, not 250u — measured 1920-1518 = 402 px at u=1.5. Those 18u came
    // straight out of the corridor, and `tests/hud-layout.spec.ts` was
    // simultaneously asserting that this panel and the build rail below it are
    // "one strip — same width, same right edge". They were 18u apart.
    expect(ruleBody('.vm-hud .vm-objectives')).toMatch(/box-sizing:\s*border-box/);
    // The padding the border-box is absorbing. If this ever exceeds half the
    // rail width the panel has no content box left.
    const pad = ruleUnits('.vm-hud .vm-objectives', 'padding');
    expect(pad * 2).toBeLessThan(units('--vm-rail-w') / 2);
  });

  it('every threshold is stripWidth + 2 x (column + gutter)', () => {
    for (const tier of ['wide', 'tight', 'bare'] as const) {
      expect(topRowNeeds(TOP_STRIP_UNITS[tier]))
        .toBe(TOP_STRIP_UNITS[tier] + 2 * (TOP_OBJECTIVE_COLUMN + TOP_ROW_GUTTER));
    }
  });

  it('the gutter is one --vm-gap, so the two panels never merely touch', () => {
    expect(TOP_ROW_GUTTER).toBe(units('--vm-gap'));
  });

  it('the declared strip widths are ceilings over the measured ones', () => {
    for (const tier of ['wide', 'tight', 'bare'] as const) {
      // A declared width BELOW the measurement silently re-opens the overlap:
      // the tier would be selected for a row it does not fit in.
      expect(TOP_STRIP_UNITS[tier], `${tier} is declared narrower than it measures`)
        .toBeGreaterThanOrEqual(MEASURED_STRIP_UNITS[tier]);
      // And a width far ABOVE it is padding disguised as measurement — it drops
      // a tier of content on frames that had room for it.
      expect(TOP_STRIP_UNITS[tier], `${tier} is padded well past its measurement`)
        .toBeLessThan(MEASURED_STRIP_UNITS[tier] + 12);
    }
  });

  it('the tiers are strictly ordered, so each is a real step down', () => {
    expect(TOP_STRIP_UNITS.wide).toBeGreaterThan(TOP_STRIP_UNITS.tight);
    expect(TOP_STRIP_UNITS.tight).toBeGreaterThan(TOP_STRIP_UNITS.bare);
  });

  it('picks the widest tier that fits, exactly at the boundary', () => {
    for (const tier of ['wide', 'tight', 'bare'] as const) {
      const need = topRowNeeds(TOP_STRIP_UNITS[tier]);
      expect(topRowFit(need), `${tier} at exactly its threshold`).toBe(tier);
      expect(topRowFit(need - 0.001), `${tier} one thousandth short`).not.toBe(tier);
    }
    expect(topRowFit(0)).toBe('solo');
    expect(topRowFit(Number.MAX_SAFE_INTEGER)).toBe('wide');
  });
});

/* ==========================================================================
 * 4. THE WIRING
 *
 * The tier is useless unless something publishes it and the stylesheet reads
 * it, and both halves fail silently: an unset attribute renders the `wide`
 * layout, which is precisely the layout that overlaps.
 * ========================================================================== */

describe('the tier reaches the stylesheet', () => {
  it('Hud.resize publishes it, and does so after the no-change early return', () => {
    const body = /private resize\(force: boolean\): void \{([\s\S]*?)\n  \}/.exec(HUD_TS);
    expect(body, 'resize() is no longer shaped the way this test reads it').not.toBeNull();
    const src = (body as RegExpExecArray)[1];
    const guard = src.indexOf('if (!force &&');
    const write = src.indexOf('dataset.topFit');
    expect(guard, 'resize() lost its unchanged-size early return').toBeGreaterThanOrEqual(0);
    expect(write, 'resize() does not publish data-top-fit').toBeGreaterThan(guard);
    // `frame()` calls `resize(false)` every tick; the early return is the only
    // thing standing between this and an attribute write at 60 Hz.
    expect(HUD_TS).toContain('this.resize(false);');
  });

  it('is derived from the width in DESIGN units, never in CSS pixels', () => {
    expect(HUD_TS).toContain('topRowFit(w / this.uiScale)');
  });

  it('is written exactly once, so there is one source of truth for it', () => {
    expect(HUD_TS.split('dataset.topFit').length - 1).toBe(1);
  });

  for (const tier of ['tight', 'bare', 'solo'] as const) {
    it(`hud.css has a rule for '${tier}'`, () => {
      expect(HUD).toContain(`[data-top-fit='${tier}']`);
    });
  }

  it('drops the telltales at every tier below wide, in that order', () => {
    // The content decision is the one the old query already made: "the three
    // telltales go first because the HUD is still complete without them".
    for (const tier of ['tight', 'bare', 'solo'] as const) {
      expect(HUD).toMatch(new RegExp(`\\[data-top-fit='${tier}'\\]`));
    }
    expect(HUD).toMatch(/\.vm-res-tell[\s\S]{0,120}display:\s*none/);
    expect(HUD).toMatch(/\[data-top-fit='bare'\][\s\S]{0,200}\.vm-power-state[\s\S]{0,80}display:\s*none/);
  });

  it('the completion banner follows the panel it belongs to', () => {
    expect(OBJ).toContain("[data-top-fit='solo'] .vm-objdone-layer");
  });

  it('an absent attribute is the wide layout — no HUD must not mean no strip', () => {
    // `objectives.system.ts` falls back to `#hud-root` when there is no HUD, and
    // `?shot=` boots without one. Every tier rule keys off an explicit VALUE, so
    // nothing selects on the attribute merely being absent.
    expect(HUD).not.toMatch(/:not\(\[data-top-fit/);
    expect(OBJ).not.toMatch(/:not\(\[data-top-fit/);
    expect(HUD).not.toMatch(/\[data-top-fit\]\s*[^=]/);
  });
});

/* ==========================================================================
 * 5. THE TWO QUERIES THAT ASKED THE WRONG QUESTION
 * ========================================================================== */

describe('the viewport-pixel breakpoints are gone, not merely overridden', () => {
  it('hud.css no longer drops the telltales on a width query', () => {
    // 1180 css px against a strip whose width scales with viewport HEIGHT.
    expect(HUD).not.toContain('max-width: 1180px');
  });

  it('hud.css no longer hides the objective panel on a width query', () => {
    expect(HUD).not.toContain('max-width: 1000px');
  });

  it('objectives.css no longer hides the completion beat on one either', () => {
    expect(OBJ).not.toContain('max-width: 1000px');
  });

  it('leaves the breakpoints that are genuinely about width alone', () => {
    // `.vm-tab .vm-hk` — a keyboard badge inside a fixed-width rail. That one
    // really is a question about how much horizontal room the frame has, and it
    // is not part of the top row. Deleting it is not part of this fix.
    expect(HUD).toContain('max-width: 1080px');
  });
});

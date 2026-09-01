/**
 * ============================================================================
 * THE SELECTION PANEL MUST NOT DRAW OUTSIDE ITSELF
 * ============================================================================
 * Reported as "hud contents being cut", over a screenshot of a MIXED FORCE of
 * 17 units: the SELF-DESTRUCT button sliced by the panel's own frame, and a
 * cameo strip reading "6 TYPES SELECTED" while showing five, the fifth cut.
 *
 * Both were real and they had DIFFERENT causes, which is why this file pins
 * four separate things.
 *
 * MEASURED IN A REAL PAGE, at 1280x720, with every action group present:
 *
 *     head row wants          944 px
 *     head row has            506 px
 *     SELF-DESTRUCT right    1063 px   <- panel's right edge was 632
 *     unused dock beside it   670 px
 *
 * The cap was `calc(520 * var(--vm-u))` and `--vm-u` is derived from viewport
 * HEIGHT, so a width budget was pinned to the wrong axis and a 2560-wide frame
 * got exactly the same 520 px of room as a 1280-wide one. That is the same
 * class of defect as the HUD top row's `--vm-u`-vs-media-query mismatch.
 *
 * jsdom HAS NO LAYOUT ENGINE — `scrollWidth` is 0 for everything — so this
 * cannot measure the overflow it exists to prevent. It asserts the STRUCTURE
 * that was verified to produce zero overflow in a real browser at 1024, 1280,
 * 1600 and 1920 wide. Re-verify in a page if you change the mechanism.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../src/ui/hud.css', import.meta.url)),
  'utf8',
);
const TS = readFileSync(
  fileURLToPath(new URL('../src/ui/Sidebar.ts', import.meta.url)),
  'utf8',
);

/** The body of the first rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return CSS.slice(open + 1, close);
}

describe('the selection panel is bounded by the width it actually has', () => {
  const body = ruleBody('.vm-hud .vm-dock-selection');

  it('derives its cap from the row width, never from --vm-u alone', () => {
    const max = /max-width:([^;]+);/.exec(body)?.[1] ?? '';
    expect(max).not.toBe('');
    // The whole defect in one assertion: a width budget written in a
    // height-derived unit and nothing else.
    expect(max).toContain('100%');
    expect(max).toContain('--vm-rail-w');
    expect(max, 'a bare `calc(N * var(--vm-u))` cap is the original bug')
      .not.toMatch(/^\s*calc\(\s*\d+(\.\d+)?\s*\*\s*var\(--vm-u\)\s*\)\s*$/);
  });

  it('still sizes to its content, so the raised cap is a ceiling not a width', () => {
    // `flex: 0 1 auto` is what keeps an empty selection at its floor. With
    // `1 1 auto` the panel painted a 1300 px slab of glass for nothing, which
    // is what the cap was originally added to stop — so the cap could only be
    // raised safely because this stayed as it is.
    expect(body).toMatch(/flex:\s*0\s+1\s+auto/);
    expect(body).toMatch(/min-width:\s*calc\(265\s*\*\s*var\(--vm-u\)\)/);
  });
});

describe('the name yields before the verbs do', () => {
  it('lets .vm-sel-id shrink, or the title ellipsis can never fire', () => {
    const body = ruleBody('.vm-hud .vm-sel-id');
    // `0 0 auto` here means `text-overflow: ellipsis` on `.vm-sel-title` is
    // decorative: the name never gives up a pixel and the buttons leave the
    // panel instead.
    expect(body).toMatch(/flex:\s*0\s+1\s+auto/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it('lets the decorative rule collapse to nothing', () => {
    const body = ruleBody('.vm-hud .vm-sel-rule');
    expect(body).toMatch(/min-width:\s*0\s*;/);
  });

  it('keeps the title truncating rather than wrapping', () => {
    const body = ruleBody('.vm-hud .vm-sel-title');
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/white-space:\s*nowrap/);
  });
});

describe('the last resort drops captions, never verbs', () => {
  it('hides .vm-stance-label under .is-tight', () => {
    const body = ruleBody('.vm-hud .vm-sel-head.is-tight .vm-stance-label');
    expect(body).toMatch(/display:\s*none/);
  });

  it('never hides a button, because the button carries the verb', () => {
    // "Cargo" is the caption; "Unload 0 / 8" is the control. Dropping the
    // control to save width would make the panel narrower and useless.
    const tight = CSS.slice(CSS.indexOf('.vm-hud .vm-sel-head.is-tight'));
    const firstRule = tight.slice(0, tight.indexOf('}') + 1);
    expect(firstRule).not.toContain('.vm-stance ');
    expect(firstRule).not.toContain('.vm-destruct');
    expect(firstRule).not.toContain('.vm-cargo');
  });

  it('replaces an overflowing unit name with the compact quantity anchor', () => {
    expect(TS).toContain('const countIdentity = !this.stanceRow.hidden || tight');
    expect(TS).toContain('if (this.lastCount < 2) this.countEl.hidden = !countIdentity');
  });
});

describe('a loaded transport exposes a strong bottom-right unload action', () => {
  it('turns readiness into both semantics and an accent treatment', () => {
    expect(TS).toContain("this.cargoButton.classList.toggle('is-ready', action.enabled)");
    const ready = ruleBody('.vm-hud .vm-cargo.is-ready');
    expect(ready).toMatch(/min-width:\s*calc\(86\s*\*\s*var\(--vm-u\)\)/);
    expect(ready).toContain('var(--vm-text-scale, 1)');
    expect(ready).toContain('var(--vm-accent-hi)');
  });
});

describe('the cameo strip says when it continues', () => {
  it('has a fade for the overflow case', () => {
    const body = ruleBody('.vm-hud .vm-sel-cards.is-clipped');
    expect(body).toMatch(/mask-image:\s*linear-gradient/);
  });

  it('still scrolls, which it always did', () => {
    const body = ruleBody('.vm-hud .vm-sel-cards');
    expect(body).toMatch(/overflow-x:\s*auto/);
  });
});

describe('fitHead measures the natural width, not the tight one', () => {
  const fn = TS.slice(TS.indexOf('private fitHead('));
  const bodyText = fn.slice(0, fn.indexOf('\n  }\n'));

  it('strips is-tight BEFORE reading scrollWidth', () => {
    const strip = bodyText.indexOf("classList.remove('is-tight')");
    const read = bodyText.indexOf('scrollWidth');
    expect(strip, 'fitHead must remove is-tight').toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    // Measuring while tight reports the tight width, so the row always "fits"
    // and the class can never come back off — captionless forever after one
    // narrow moment.
    expect(strip).toBeLessThan(read);
  });

  it('keeps layout reads out of the per-tick signature', () => {
    const sig = bodyText.slice(0, bodyText.indexOf('if (sig === this.lastFitSig)'));
    // `update()` runs every HUD tick and the rows above it write text. Reading
    // any geometry to build the signature would force a synchronous reflow
    // every frame a HP readout moved.
    for (const read of ['clientWidth', 'scrollWidth', 'getBoundingClientRect', 'offsetWidth']) {
      expect(sig, `${read} in the signature forces a reflow every tick`)
        .not.toContain(read);
    }
  });

  it('is driven by a ResizeObserver that is torn down', () => {
    expect(TS).toContain('new ResizeObserver');
    // jsdom has no ResizeObserver and `tests/hud-top-row.spec.ts` builds this
    // panel, so the construction must be guarded.
    expect(TS).toMatch(/typeof ResizeObserver === 'function'/);
    expect(TS).toContain('this.fitObserver?.disconnect()');
  });
});

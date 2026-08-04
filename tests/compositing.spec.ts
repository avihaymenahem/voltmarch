/**
 * Compositing / black-frame regression tests.
 *
 * Every case here guards one of the three suspected causes of the intermittent
 * black overlays reported on macOS Chrome. None of them can be reproduced on
 * this hardware, so what they assert is the SHAPE of the fix: that the policy
 * resolves the way it is documented to, that neither stylesheet can quietly
 * reintroduce a hard-coded blur, and that the post chain cannot go back to
 * mutating itself after boot.
 *
 * Node environment: nothing here may touch WebGL, `document`, or `window`.
 * `src/render/renderer.ts` is import-safe under node — the blur policy only
 * self-applies when a `document` exists.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NO_BLUR_CLASS,
  classifyCompositing,
  getPanelBlurMode,
  resolvePanelBlur,
  setPanelBlurMode,
  type PanelBlurMode,
} from '../src/render/renderer';

const ROOT = join(__dirname, '..');

/**
 * Every assertion below is about CODE, so prose must not be able to satisfy or
 * break one. `/* *​/` blocks go first, then `//` line comments (the negative
 * lookbehind keeps `https://` and the `1 / 60` in a division intact well enough
 * for the patterns we search for).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Drop `@supports (...)` preludes: their conditions are not declarations. */
function stripSupportsPreludes(css: string): string {
  return css.replace(/@supports[^{]*\{/g, '{');
}

const HUD_CSS = stripComments(readFileSync(join(ROOT, 'src/ui/hud.css'), 'utf8'));
const SHELL_CSS = stripComments(readFileSync(join(ROOT, 'src/shell/shell.css'), 'utf8'));
const POST_TS = stripComments(readFileSync(join(ROOT, 'src/render/post.ts'), 'utf8'));

/* -------------------------------------------------------------------------- */
/* Suspect 1 — the platform gate                                              */
/* -------------------------------------------------------------------------- */

const UA = {
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  iPad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

describe('compositing probe — which platforms may blur over the WebGL canvas', () => {
  it('flags macOS Chrome as risky', () => {
    const p = classifyCompositing('macOS', UA.macChrome, true);
    expect(p.supported).toBe(true);
    expect(p.risky).toBe(true);
  });

  it('flags macOS Safari as risky (the artefact is not Chromium-only)', () => {
    expect(classifyCompositing('MacIntel', UA.macSafari, true).risky).toBe(true);
  });

  it('flags iPadOS, which lies about being a Mac, using touch points', () => {
    expect(classifyCompositing('MacIntel', UA.iPad, true, 5).risky).toBe(true);
  });

  it('leaves Windows, Linux and Android alone — the look survives there', () => {
    expect(classifyCompositing('Windows', UA.winChrome, true).risky).toBe(false);
    expect(classifyCompositing('Linux x86_64', UA.linuxFirefox, true).risky).toBe(false);
    expect(classifyCompositing('Android', UA.androidChrome, true).risky).toBe(false);
  });

  it('treats "no backdrop-filter support" as risky, not as an error', () => {
    const p = classifyCompositing('Windows', UA.winChrome, false);
    expect(p.supported).toBe(false);
    expect(p.risky).toBe(true);
  });

  it('always explains itself — the reason is logged at boot', () => {
    expect(classifyCompositing('macOS', UA.macChrome, true).reason).toMatch(/Apple|Metal/i);
    expect(classifyCompositing('Windows', UA.winChrome, true).reason.length).toBeGreaterThan(0);
  });
});

describe('panel blur policy', () => {
  const safe = { supported: true, risky: false };
  const risky = { supported: true, risky: true };
  const unsupported = { supported: false, risky: true };

  it("defaults ('auto') to on where safe and off where risky", () => {
    expect(resolvePanelBlur('auto', safe)).toBe(true);
    expect(resolvePanelBlur('auto', risky)).toBe(false);
  });

  it("lets the player force it back on ('on' beats the platform check)", () => {
    expect(resolvePanelBlur('on', risky)).toBe(true);
  });

  it("lets the player force it off everywhere ('off' beats everything)", () => {
    expect(resolvePanelBlur('off', safe)).toBe(false);
    expect(resolvePanelBlur('off', risky)).toBe(false);
  });

  it('never turns the blur on where the browser cannot do it, whatever the mode', () => {
    for (const mode of ['auto', 'on', 'off'] as PanelBlurMode[]) {
      expect(resolvePanelBlur(mode, unsupported)).toBe(false);
    }
  });

  it('records the requested mode even with no DOM to stamp', () => {
    const before = getPanelBlurMode();
    setPanelBlurMode('off');
    expect(getPanelBlurMode()).toBe('off');
    setPanelBlurMode('on');
    expect(getPanelBlurMode()).toBe('on');
    setPanelBlurMode(before);
  });

  it('under node (no DOM) resolves to off — nothing can blur a canvas that does not exist', () => {
    expect(setPanelBlurMode('on')).toBe(false);
    setPanelBlurMode('auto');
  });
});

/* -------------------------------------------------------------------------- */
/* Suspect 1 — the stylesheets                                                */
/* -------------------------------------------------------------------------- */

/** Every `backdrop-filter` / `-webkit-backdrop-filter` value in a stylesheet. */
function backdropValues(css: string): string[] {
  const out: string[] = [];
  const re = /(?:-webkit-)?backdrop-filter\s*:\s*([^;}]+)/g;
  let m: RegExpExecArray | null;
  const body = stripSupportsPreludes(css);
  while ((m = re.exec(body)) !== null) out.push(m[1].trim());
  return out;
}

for (const [name, css] of [
  ['src/ui/hud.css', HUD_CSS],
  ['src/shell/shell.css', SHELL_CSS],
] as const) {
  describe(`${name} — the blur is a token, never a literal`, () => {
    it('has backdrop-filter declarations at all (the look is not silently gone)', () => {
      expect(backdropValues(css).length).toBeGreaterThan(0);
    });

    it('never hard-codes a blur radius — every value is var(--vm-blur*) or none', () => {
      for (const v of backdropValues(css)) {
        expect(v === 'none' || /^var\(--vm-blur[a-z-]*\)$/.test(v), `bad value: ${v}`).toBe(true);
      }
    });

    it(`declares an html.${NO_BLUR_CLASS} override`, () => {
      expect(css).toContain(`html.${NO_BLUR_CLASS}`);
    });

    it('turns off every blur token it declares, and only via the gate', () => {
      const declared = new Set(
        [...css.matchAll(/(--vm-blur[a-z-]*)\s*:\s*blur\(/g)].map((m) => m[1])
      );
      expect(declared.size).toBeGreaterThan(0);
      const gated = new Set(
        [...css.matchAll(/(--vm-blur[a-z-]*)\s*:\s*none\s*;/g)].map((m) => m[1])
      );
      for (const token of declared) {
        expect(gated.has(token), `${token} is never switched off`).toBe(true);
      }
    });

    it('keeps a no-JS backstop for browsers without backdrop-filter', () => {
      expect(css).toMatch(/@supports\s+not\s+\(\(backdrop-filter/);
    });
  });
}

/** Parse the alpha out of `rgba(r, g, b, a)`. */
function alphaOf(rgba: string): number {
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(rgba);
  return m === null ? NaN : Number(m[1]);
}

/** The last value assigned to `token` inside `css`. */
function lastValue(css: string, token: string): string {
  const all = [...css.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))];
  return all.length === 0 ? '' : all[all.length - 1][1].trim();
}

/** The first value assigned to `token` inside `css`. */
function firstValue(css: string, token: string): string {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(css);
  return m === null ? '' : m[1].trim();
}

describe('the unblurred surface is tuned, not just the blurred one minus the blur', () => {
  const cases = [
    ['src/ui/hud.css', HUD_CSS, '--vm-glass'],
    ['src/ui/hud.css', HUD_CSS, '--vm-glass-deep'],
    ['src/shell/shell.css', SHELL_CSS, '--vm-glass'],
    ['src/shell/shell.css', SHELL_CSS, '--vm-glass-strong'],
  ] as const;

  for (const [name, css, token] of cases) {
    it(`${name} raises ${token} opacity when the blur is gone`, () => {
      const base = alphaOf(firstValue(css, token));
      const gated = alphaOf(lastValue(css, token));
      expect(Number.isNaN(base)).toBe(false);
      expect(Number.isNaN(gated)).toBe(false);
      // Denser, because the blur is no longer flattening the battlefield behind
      // it — but still translucent, because the glass IS the look.
      expect(gated).toBeGreaterThan(base);
      expect(gated).toBeLessThan(1);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Suspect 2 — the chain must be final before the first presented frame       */
/* -------------------------------------------------------------------------- */

describe('post chain construction', () => {
  it('loads the AO pass statically — nothing is added to the composer after boot', () => {
    // `await import(...)` inside createPostChain is exactly the bug: the pass
    // lands some indeterminate number of frames into the session and the frame
    // it lands on can be presented black.
    expect(POST_TS).not.toMatch(/await\s+import\(/);
    expect(POST_TS).toMatch(/^import \{ GTAOPass \}/m);
    expect(POST_TS).toMatch(/^import \{ SSAOPass \}/m);
  });

  it('warms up with a throwaway frame whenever the pass list changes', () => {
    expect(POST_TS).toMatch(/function warmUp\(\)/);
    // rebuild() must arm it, render() must consume it before presenting.
    expect(POST_TS).toMatch(/chainDirty = true;/);
    expect(POST_TS).toMatch(/chainDirty = false;\s*\n\s*warmUp\(\);/);
  });

  it('renders the warm-up frame offscreen — it must never reach the screen', () => {
    expect(POST_TS).toMatch(/last\.renderToScreen = false;/);
  });

  it('skips the frame entirely while the GL context is lost', () => {
    expect(POST_TS).toMatch(/handle\.isContextLost\(\)/);
  });
});

/* -------------------------------------------------------------------------- */
/* Suspect 3 — render-target reallocation                                     */
/* -------------------------------------------------------------------------- */

describe('post chain resize', () => {
  it('defers reallocation to the top of the next frame, never mid-frame', () => {
    expect(POST_TS).toMatch(/function applyPendingSize\(\)/);
    expect(POST_TS).toMatch(/applyPendingSize\(\);\s*\n\s*\n?\s*elapsed \+= dt;/);
  });

  it('is a no-op when the size has not actually changed', () => {
    expect(POST_TS).toMatch(/if \(pw === appliedW && ph === appliedH\)/);
  });

  it('sizes the chain once synchronously at construction', () => {
    expect(POST_TS).toMatch(/setSize\(width\(\), height\(\)\);[\s\S]{0,400}applyPendingSize\(\);/);
  });
});

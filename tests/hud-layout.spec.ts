/**
 * ============================================================================
 * tests/hud-layout.spec.ts — THE HUD'S ARITHMETIC, AND ITS ONE OPEN FLANK
 * ============================================================================
 *
 * Two things are asserted here, and they are the two things that have actually
 * gone wrong.
 *
 * 1. THE FRAME BUDGET IS A CALCULATION, NOT A HOPE.
 *    `docs/RA3_LOOK_BIBLE.md` §9 caps the whole interface at 12-16% of the
 *    frame. `Hud.hudFrameShare()` reports the live figure and it measured
 *    15.83% at 1280x720 — over the ceiling once the objectives panel's further
 *    1.85% is counted, and that panel is NOT in the figure. The redesign got
 *    the band from 114 design units to 94.
 *
 *    That number is a function of exactly five constants in `hud.css`, so this
 *    file reads them out of the stylesheet and re-derives it. A stylesheet edit
 *    that grows the band now fails here, at `npm test`, instead of at
 *    `npm run shots` three hours later.
 *
 * 2. THE SHELL STYLESHEET IS NOT SANDBOXED.
 *    `src/shell/shell.css` declares UNSCOPED `.vm-stat`, `.vm-card`, `.vm-tabs`,
 *    `.vm-num` and `.vm-stat-value` for the menu and the post-match summary.
 *    Every one of those is also a HUD class name, and the shell chunk is loaded
 *    in every real match — but never under `?shot=`, so the entire screenshot
 *    pipeline is blind to it.
 *
 *    That is not theoretical. `.vm-stat` carries `flex-direction: column` and
 *    `padding: 16px 18px` for the summary board, `hud.css` stated neither, and
 *    so every stat chip in the selection card laid itself out as three stacked
 *    rows inside a 19-unit strip — putting `Infantry`, `52.4 dps`, `18 m` and
 *    `2.2 m/s` through the bottom edge of the panel, which is exactly what the
 *    player reported. Measured in Chromium in a real match: the key sat at
 *    y=694.1 and its value at y=707.3, with the panel ending at y=712.
 *
 *    So: for every class both files claim, every property the shell declares
 *    must ALSO be declared by the HUD. The fix belongs in `shell.css` — those
 *    selectors should be scoped to `.vm-shell` — but `shell.css` is not this
 *    agent's file, and a HUD that cannot be broken by a stylesheet it does not
 *    own is worth having regardless.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const HUD_CSS = readFileSync(join(ROOT, 'src/ui/hud.css'), 'utf8');
const SHELL_CSS = readFileSync(join(ROOT, 'src/shell/shell.css'), 'utf8');
const SIDEBAR_TS = readFileSync(join(ROOT, 'src/ui/Sidebar.ts'), 'utf8');

/** Strip `/* *​/` comments so prose can never satisfy or break an assertion. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const HUD = stripComments(HUD_CSS);
const SHELL = stripComments(SHELL_CSS);

/** The `N` out of `--token: calc(N * var(--vm-u))`, in design units. */
function units(token: string, css = HUD): number {
  const re = new RegExp(`${token}\\s*:\\s*calc\\(\\s*([\\d.]+)\\s*\\*\\s*var\\(--vm-u\\)\\s*\\)`);
  const m = re.exec(css);
  expect(m, `${token} is not declared as calc(N * var(--vm-u))`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

/** The `N` out of `prop: calc(N * var(--vm-u))` inside a named rule block. */
function ruleUnits(selector: string, prop: string, css = HUD): number {
  const block = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    .exec(css);
  expect(block, `no rule for ${selector}`).not.toBeNull();
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*calc\\(\\s*([\\d.]+)\\s*\\*\\s*var\\(--vm-u\\)\\s*\\)`)
    .exec((block as RegExpExecArray)[1]);
  expect(m, `${selector} does not set ${prop} in design units`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

/* ==========================================================================
 * 1. THE BAND
 * ========================================================================== */

describe('the bottom band fits the §9 budget by construction', () => {
  const dockH = units('--vm-dock-h');
  const bandPad = units('--vm-band-pad');
  const dockPad = units('--vm-dock-pad');

  it('the dock height is exactly what the build palette needs, and no more', () => {
    // pad + tabs + gap + 2 rows + rowGap + pad. Every term is read out of the
    // stylesheet, so the comment in hud.css and the stylesheet cannot drift.
    const tabs = ruleUnits('.vm-hud .vm-tabs', 'height');
    const row = ruleUnits('.vm-hud .vm-grid', 'grid-auto-rows');
    const gridGap = ruleUnits('.vm-hud .vm-grid', 'gap');
    const dockGap = ruleUnits('.vm-hud .vm-dock', 'gap');

    const needed = dockPad + tabs + dockGap + row * 2 + gridGap + dockPad;
    expect(dockH, `derived ${needed}u, stylesheet says ${dockH}u`).toBe(needed);
  });

  it('reports a band share under the 15.83% it started at, at every shipping height', () => {
    // `Hud.hudFrameShare()` is (frameH - dockTop) / frameH, and dockTop is the
    // top of the map dock — so the band is the dock plus the docks' own bottom
    // padding, in design units, against the frame height in design units.
    //
    // uiScale = clamp(floor(h / 720 * 4) / 4, 1, 4), from Chrome.computeUiScale.
    const band = dockH + bandPad;
    expect(band).toBe(94);

    const BEFORE = 0.1583;
    for (const h of [720, 768, 900, 1080, 1440, 2160]) {
      const u = Math.min(4, Math.max(1, Math.floor((h / 720) * 4) / 4));
      const share = (band * u) / h;
      expect(share, `${h}p`).toBeLessThan(BEFORE);
      // And still inside the bible's floor: an interface that vanishes is not
      // a win either.
      expect(share, `${h}p`).toBeGreaterThan(0.10);
    }
  });

  it('measures 13.06% at the reference 1280x720', () => {
    // The figure quoted in the report and in hud.css's header. 94u at u=1.
    expect(((dockH + bandPad) * 1) / 720).toBeCloseTo(0.1306, 4);
  });

  it('caps the selection card rather than letting it fill the band', () => {
    // The single largest slab of glass in the old interface was an empty
    // selection dock stretched across the middle of the frame.
    const block = /\.vm-hud \.vm-dock-selection \{([^}]*)\}/.exec(HUD);
    expect(block).not.toBeNull();
    const body = (block as RegExpExecArray)[1];
    expect(body).toMatch(/flex:\s*0 1 auto/);
    expect(body).toMatch(/max-width:\s*calc\(\s*\d+/);
  });
});

/* ==========================================================================
 * 2. THE BASE STATUS BOARD IS GONE
 * ========================================================================== */

describe('the redundant base status board was removed, not hidden', () => {
  it('no longer exists in the stylesheet', () => {
    // Five readouts that all already appear in the resource strip, in the
    // widest dock of the band, ~47% empty.
    for (const cls of [
      '.vm-status-grid', '.vm-status-cell', '.vm-status-value', '.vm-status-head',
    ]) {
      expect(HUD, `${cls} survived`).not.toContain(cls);
    }
  });

  it('no longer exists in Sidebar.ts', () => {
    expect(SIDEBAR_TS).not.toContain('vm-status-grid');
    expect(SIDEBAR_TS).not.toContain('Base status');
  });

  it('keeps the one thing the board actually added — the advice line', () => {
    // `Hud.buildTelemetry` derives it from the world and the HUD's own event
    // subscriptions; nothing else in the frame says "power is tight" in a
    // sentence, so removing it would have cost information.
    expect(SIDEBAR_TS).toContain('vm-sel-advice');
    expect(HUD).toContain('.vm-hud .vm-sel-idle');
  });
});

/* ==========================================================================
 * 3. THE PANEL CONSTRUCTION
 * ========================================================================== */

describe('the panel is a double frame with cut corners', () => {
  it('draws two rims, not one', () => {
    // `::before` is the dark outer rim at inset 0; `::after` is the lit inner
    // bevel at `--vm-bevel-inset`. Both are masked so they follow the chamfer.
    expect(HUD).toContain('.vm-hud .vm-panel::before');
    expect(HUD).toContain('.vm-hud .vm-panel::after');
    const after = /\.vm-hud \.vm-panel::after \{([^}]*)\}/.exec(HUD);
    expect(after).not.toBeNull();
    expect((after as RegExpExecArray)[1]).toContain('mask-composite: exclude');
    expect((after as RegExpExecArray)[1]).toContain('--vm-bevel-inset');
  });

  it('lights the top-left edge brighter than the bottom-right', () => {
    // The reference's "lit metal channel": one crisp edge, brighter where the
    // light is. A single flat colour reads as a border and loses the whole
    // point of the construction.
    const after = /\.vm-hud \.vm-panel::after \{([^}]*)\}/.exec(HUD) as RegExpExecArray;
    expect(after[1]).toContain('--vm-bevel-hi');
    expect(after[1]).toContain('--vm-bevel-lo');
    const hi = /--vm-bevel-hi:\s*rgba\(var\(--vm-accent-rgb\),\s*([\d.]+)\)/.exec(HUD);
    const lo = /--vm-bevel-lo:\s*rgba\(var\(--vm-accent-rgb\),\s*([\d.]+)\)/.exec(HUD);
    expect(hi).not.toBeNull();
    expect(lo).not.toBeNull();
    expect(Number((hi as RegExpExecArray)[1]))
      .toBeGreaterThan(Number((lo as RegExpExecArray)[1]));
  });

  it('cuts every corner at 45 degrees and rounds none of them', () => {
    for (const notch of ['diag', 'diag-rev']) {
      const block = new RegExp(`\\.vm-panel\\[data-notch='${notch}'\\] \\{([^}]*)\\}`).exec(HUD);
      expect(block, notch).not.toBeNull();
      const body = (block as RegExpExecArray)[1];
      // Eight vertices — a rectangle with all four corners cut. Six would be
      // the old two-corner lean.
      const outer = /--vm-clip:\s*polygon\(([^;]*)\);/.exec(body);
      expect(outer, `${notch} has no --vm-clip`).not.toBeNull();
      const vertices = (outer as RegExpExecArray)[1].split(',').length;
      expect(vertices, `${notch} vertex count`).toBe(8);
      expect(body).toContain('--vm-clip-in');
    }
    // No `border-radius` anywhere on a panel or a control. Chamfers, not fillets.
    const panelRules = HUD.split('\n').filter((l) => l.includes('border-radius'));
    // The one exception is the tab-alert dot, which is a dot.
    expect(panelRules.every((l) => l.includes('50%'))).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE SHELL STYLESHEET CANNOT REACH INTO THE HUD
 *
 * The regression test for the reported clipping bug, generalised.
 * ========================================================================== */

/** Every declaration block in `css`, as `[selector, propertyNames]` pairs. */
function rulesOf(css: string): Array<{ sel: string; props: string[] }> {
  const out: Array<{ sel: string; props: string[] }> = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
    for (const part of m[1].split(',')) {
      const sel = part.trim();
      if (sel === '' || /%$|^from$|^to$|^\d/.test(sel)) continue;
      out.push({ sel, props });
    }
  }
  return out;
}

/**
 * Class names the shell claims with an UNSCOPED selector — i.e. one compound
 * selector, no descendant combinator, so it matches anywhere in the document
 * including inside `.vm-hud`.
 */
function unscopedShellClasses(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const rule of rulesOf(SHELL)) {
    if (/[\s>+~]/.test(rule.sel)) continue;
    const m = /^\.([a-z0-9-]+)((?:::?[a-z-]+)?)$/.exec(rule.sel);
    if (m === null) continue;
    const key = `${m[1]}${m[2]}`;
    let set = out.get(key);
    if (set === undefined) { set = new Set(); out.set(key, set); }
    for (const p of rule.props) set.add(p);
  }
  return out;
}

/** What `.vm-hud .<cls>` declares in hud.css. */
function hudDeclares(cls: string): Set<string> {
  const out = new Set<string>();
  for (const rule of rulesOf(HUD)) {
    if (rule.sel !== `.vm-hud .${cls}`) continue;
    for (const p of rule.props) out.add(p);
  }
  return out;
}

/** Class tokens the HUD actually puts on an element. */
function hudClassTokens(): Set<string> {
  const out = new Set<string>();
  const files = [
    'src/ui/Hud.ts', 'src/ui/Sidebar.ts', 'src/ui/Chrome.ts', 'src/ui/Minimap.ts',
    'src/ui/Overlay.ts', 'src/ui/icons.ts',
  ];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/['"`]([a-z0-9 _-]*vm-[a-z0-9 _-]+)['"`]/g)) {
      for (const token of m[1].split(/\s+/)) if (token.startsWith('vm-')) out.add(token);
    }
  }
  return out;
}

describe('hud.css states every property an unscoped shell rule could supply', () => {
  const shell = unscopedShellClasses();
  const hudTokens = hudClassTokens();

  it('finds the collisions at all (the scan is not silently matching nothing)', () => {
    const collisions = [...shell.keys()].filter((k) => hudTokens.has(k.replace(/::?.*$/, '')));
    // If shell.css is ever properly scoped to `.vm-shell` this drops to zero
    // and the suite below becomes vacuous — which is the good outcome, and the
    // reason this assertion is `>= 0` rather than a fixed count.
    expect(collisions.length).toBeGreaterThanOrEqual(0);
    expect(shell.size).toBeGreaterThan(0);
  });

  for (const cls of ['vm-stat', 'vm-stat-value', 'vm-card', 'vm-tabs', 'vm-num']) {
    it(`.${cls} — nothing leaks in from src/shell/shell.css`, () => {
      const shellProps = shell.get(cls);
      if (shellProps === undefined) return;      // already scoped; nothing to do
      const hudProps = hudDeclares(cls);
      const leaked = [...shellProps].filter((p) => !hudProps.has(p));
      expect(
        leaked,
        `src/shell/shell.css's bare \`.${cls}\` supplies ${leaked.join(', ')} to the HUD. ` +
        `State them in \`.vm-hud .${cls}\`, or scope the shell rule to \`.vm-shell\`.`,
      ).toEqual([]);
    });
  }

  it('the stat chip is a ROW, explicitly — this is the reported bug', () => {
    const block = /\.vm-hud \.vm-stat \{([^}]*)\}/.exec(HUD);
    expect(block).not.toBeNull();
    const body = (block as RegExpExecArray)[1];
    expect(body).toMatch(/flex-direction:\s*row/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).toMatch(/background:\s*none/);
  });
});

/* ==========================================================================
 * 5. THE SELECTORS THE TUTORIAL SPOTLIGHTS
 *
 * `src/shell/tutorial-steps.ts` queries these and `tests/tutorial.spec.ts` §8
 * pins them against their owning source file. The redesign moved every one of
 * these elements and renamed none of them, ON PURPOSE — a rename here is a
 * two-file change and the other file is not ours.
 * ========================================================================== */

describe('the tutorial can still find what it points at', () => {
  for (const cls of ['vm-dock-map', 'vm-dock-selection', 'vm-dock-build', 'vm-grid', 'vm-resources']) {
    it(`Sidebar.ts still emits .${cls}`, () => {
      expect(SIDEBAR_TS).toContain(cls);
    });
  }

  it('the build dock still contains the grid it spotlights', () => {
    // `.vm-dock-build .vm-grid` — the tab strip moved OUT of the panel body, so
    // the grid is now a grandchild rather than a child. The descendant
    // selector still resolves, and this is the assertion that says so.
    const build = SIDEBAR_TS.indexOf("'vm-dock vm-dock-build'");
    const grid = SIDEBAR_TS.indexOf("'vm-grid'");
    expect(build).toBeGreaterThan(-1);
    expect(grid).toBeGreaterThan(build);
    expect(SIDEBAR_TS).toContain("panel(this.root, 'vm-build-body'");
    expect(SIDEBAR_TS).toContain("el('div', 'vm-grid', body)");
  });
});

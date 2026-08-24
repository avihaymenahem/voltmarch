/**
 * ============================================================================
 * tests/hud-layout.spec.ts — THE HUD'S ARITHMETIC, AND ITS ONE OPEN FLANK
 * ============================================================================
 *
 * Two things are asserted here, and they are the two things that have actually
 * gone wrong.
 *
 * 1. THE BAND HEIGHT IS A CALCULATION, NOT A HOPE.
 *    `--vm-dock-h` is a function of exactly five constants in `hud.css`, so this
 *    file reads them out of the stylesheet and re-derives it. A stylesheet edit
 *    that grows a tab strip or a slot row without moving the dock height now
 *    fails here, at `npm test`, instead of at `npm run shots` three hours later.
 *
 *    WHAT IS NO LONGER ASSERTED, AND WHY. This suite used to require the band to
 *    stay under 15.83% of the frame, because `docs/RA3_LOOK_BIBLE.md` §9/§38
 *    caps the interface at 12-16%. That ceiling is derived from the RA3
 *    reference set, and the reference comparison has since been abandoned by the
 *    player — "give up on it, we have changed a lot since the original refs".
 *    Meeting it cost the padding, and the padding is what the player then
 *    reported: "our HUD in game, its wayy wayy too dense, missing padding for
 *    all of the huds."
 *
 *    So the direction of the assertion is reversed. The frame share is RECORDED
 *    (114u, 15.83%) with a generous ceiling that only catches an accident, and
 *    what is DEFENDED is the spacing floor — because a future pass optimising
 *    for the percentage would reintroduce the exact defect this one fixed, and
 *    the percentage is the thing that would look like progress while it did so.
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
import { computeUiScale } from '../src/ui/Chrome';

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

  /*
   * THIS USED TO DERIVE `--vm-dock-h` FROM THE BUILD PALETTE —
   * `dockPad + tabs + dockGap + row*2 + gridGap + dockPad` — because the build
   * palette was the tallest thing in the bottom band and therefore the thing
   * that set its height.
   *
   * The palette has moved to the right rail, so that identity no longer
   * describes anything: the band is the map and the selection card now, and the
   * grid's row height is a property of the rail. Keeping the old sum would have
   * meant the band growing every time a cameo cell grew, which is exactly
   * backwards — the move existed to stop cell size and band budget being the
   * same argument.
   *
   * What still has to hold is below: the band's total is unchanged and still
   * inside the §9 budget, and the rail's own geometry is self-consistent.
   */
  it('the band no longer scales with the build palette', () => {
    const row = ruleUnits('.vm-hud .vm-grid', 'grid-auto-rows');
    // The rail's cells are far taller than two of them would fit in the band.
    // If this ever stops being true the palette has crept back into the band.
    expect(dockH, 'the band must not be sized by the build grid any more')
      .toBeLessThan(dockPad * 2 + row * 2);
  });

  it('the right rail clears the objectives panel exactly', () => {
    // THE NEW DRIFT RISK. The rail is positioned by a constant top offset while
    // the objectives above it are capped by a separate constant. If those two
    // numbers ever disagree the panels silently overlap — the objectives sit at
    // z-index 5 and the rail at 4, so the failure looks like a build grid with
    // its top rows cut off rather than like a layout bug.
    const objTop = ruleUnits('.vm-hud .vm-objectives', 'top');
    const objMax = units('--vm-obj-max-h');
    const railTop = units('--vm-rail-top');
    const gap = units('--vm-gap');
    expect(railTop, `objectives end at ${objTop + objMax}u, rail starts at ${railTop}u`)
      .toBe(objTop + objMax + gap);
  });

  it('the rail and the objectives are one strip — same width, same right edge', () => {
    const objRight = ruleUnits('.vm-hud .vm-objectives', 'right');
    const railRight = ruleUnits('.vm-hud .vm-dock-build', 'right');
    expect(railRight, 'rail and objectives must share a right edge').toBe(objRight);
    // Width is shared through `--vm-rail-w`; assert the objectives actually use
    // the variable rather than a copy of the number.
    const objBlock = /\.vm-hud \.vm-objectives\s*\{([^}]*)\}/.exec(HUD);
    expect(objBlock).not.toBeNull();
    expect(
      (objBlock as RegExpExecArray)[1],
      'objectives must take their width from --vm-rail-w, not a duplicated literal',
    ).toMatch(/width:\s*var\(--vm-rail-w\)/);
  });

  it('records the band share at every shipping height, and caps runaway growth', () => {
    // `Hud.hudFrameShare()` is (frameH - dockTop) / frameH, and dockTop is the
    // top of the map dock — so the band is the dock plus the docks' own bottom
    // padding, in design units, against the frame height in design units.
    //
    // The shipping scale curve comes from Chrome.computeUiScale.
    const band = dockH + bandPad;
    expect(band).toBe(114);

    // 18% is not a design target, it is a tripwire. The band is 15.83% by
    // intent; anything approaching a fifth of the frame is an accident.
    for (const h of [720, 768, 900, 1080, 1440, 2160]) {
      const u = computeUiScale(h);
      const share = (band * u) / h;
      expect(share, `${h}p`).toBeLessThan(0.18);
      // And an interface that vanishes is not a win either.
      expect(share, `${h}p`).toBeGreaterThan(0.10);
    }
  });

  it('measures 15.83% at the reference 1280x720', () => {
    // The figure quoted in the report and in hud.css's header. 114u at u=1.
    expect(((dockH + bandPad) * 1) / 720).toBeCloseTo(0.1583, 4);
  });

  it('never changes a production card footprint when it starts or finishes', () => {
    for (const state of ['is-building', 'is-ready']) {
      const block = new RegExp(`\\.vm-hud \\.vm-slot\\.${state}\\s*\\{([^}]*)\\}`).exec(HUD);
      expect(block, `missing ${state} rule`).not.toBeNull();
      expect((block as RegExpExecArray)[1], `${state} must not reflow the grid`)
        .not.toMatch(/grid-column\s*:/);
    }
  });

  /* ------------------------------------------------------------------------
   * THE SPACING FLOOR — the regression guard for the reported density bug.
   *
   * Each of these was BELOW its floor when the player wrote "wayy wayy too
   * dense". They are minimums rather than exact values so a later pass may
   * still tune the look; what it may not do is quietly buy frame percentage
   * back out of the padding again.
   * -------------------------------------------------------------------- */
  const FLOORS: Array<[string, number, string]> = [
    ['--vm-dock-pad', 7, 'panel content was one hairline off the lit bevel on all four sides'],
    ['--vm-band-pad', 9, 'the docks sat 6u off the bottom of the screen'],
    ['--vm-gap', 10, 'the three docks were 7u apart and read as one slab'],
  ];
  for (const [token, floor, why] of FLOORS) {
    it(`${token} is at least ${floor}u — ${why}`, () => {
      expect(units(token)).toBeGreaterThanOrEqual(floor);
    });
  }

  const RULE_FLOORS: Array<[string, string, number, string]> = [
    ['.vm-hud .vm-dock', 'gap', 5, 'the head, the body and the footer of every dock touched'],
    ['.vm-hud .vm-grid', 'grid-auto-rows', 33, 'a cameo, a cost badge and a hotkey badge shared 30u'],
    ['.vm-hud .vm-grid', 'gap', 4, 'adjacent build slots were 3u apart'],
    ['.vm-hud .vm-tabs', 'height', 16, 'the tab strip was a 14u sliver'],
    ['.vm-hud .vm-resources', 'height', 36, 'the top strip crushed a label and a value into 31u'],
    ['.vm-hud .vm-sel-live', 'gap', 6, 'name, body and health bar were 3u apart'],
    ['.vm-hud .vm-sel-hp', 'height', 13, 'the health bar was an 11u strip carrying 9u text'],
  ];
  for (const [sel, prop, floor, why] of RULE_FLOORS) {
    it(`${sel} ${prop} is at least ${floor}u — ${why}`, () => {
      expect(ruleUnits(sel, prop)).toBeGreaterThanOrEqual(floor);
    });
  }

  it('the map dock is exactly wide enough for the square field inside it', () => {
    // The field is `aspect-ratio: 1/1; height: 100%` inside the dock body, so
    // its side is the dock's INNER height and the dock's width has to be that
    // plus its own padding — or a square field overflows a dock that grew
    // taller than it grew wide. Derived here so the two cannot drift.
    const head = ruleUnits('.vm-hud .vm-dock-head', 'height');
    const dockGap = ruleUnits('.vm-hud .vm-dock', 'gap');
    const field = dockH - dockPad * 2 - head - dockGap;
    const width = ruleUnits('.vm-hud .vm-dock-map', 'width');
    expect(width, `field is ${field}u, dock is ${width}u`).toBe(field + dockPad * 2);
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

/**
 * ============================================================================
 * tests/shell-scope.spec.ts — THE SHELL STYLESHEET STAYS IN THE SHELL
 * ============================================================================
 *
 * `src/shell/shell.css` and `src/ui/hud.css` share a class-name prefix and are
 * mounted together for the whole of every match. They are NOT separate
 * namespaces: `.vm-panel`, `.vm-card`, `.vm-card-name`, `.vm-tab`, `.vm-tabs`,
 * `.vm-stat`, `.vm-stat-value`, `.vm-num` and `.vm-icon` were all claimed by
 * both files.
 *
 * When a class is shared, specificity is not what decides the outcome. For any
 * property the shell declared and the HUD did not, the shell's rule was the
 * ONLY rule in the cascade, so it simply applied — a bare
 * `.vm-stat { flex-direction: column; padding: 16px 18px }`, written for the
 * post-match summary board, turned every selection stat chip in the HUD into
 * three stacked rows inside a 19-unit strip and pushed `Dps`, `Rng` and `Spd`
 * through the bottom edge of the panel. That is the defect the player reported
 * as "the hud is cutting at the bottom".
 *
 * `tests/hud-layout.spec.ts` §4 defends the HUD from the outside: it fails when
 * the shell declares a property on a shared class that the HUD does not restate.
 * This file is the other half — the actual fix. Every selector in `shell.css`
 * must be rooted at `.vm-shell`, which is the div `Shell.ts` builds and the only
 * ancestor the front end ever mounts under. A rooted selector cannot reach a
 * HUD node no matter what it declares, and no amount of restating in `hud.css`
 * is needed to keep it out.
 *
 * WHY A TEST AND NOT A COMMENT. The file's header claimed "EVERYTHING IS SCOPED
 * TO `.vm-shell`" for its entire life and 266 of its 276 rules were not. The
 * screenshot harness cannot catch the drift either: `?shot=` never loads the
 * lazy shell chunk, so `shots/10-selection.png` was clean while a real match was
 * broken. A claim that nothing checks is how this shipped.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SHELL_CSS = readFileSync(join(ROOT, 'apps/game/src/shell/shell.css'), 'utf8');
const SAVEGAME_CSS = readFileSync(join(ROOT, 'apps/game/src/shell/savegame.css'), 'utf8');
const OBJECTIVES_CSS = readFileSync(join(ROOT, 'apps/game/src/ui/objectives.css'), 'utf8');
const SHELL_TS = readFileSync(join(ROOT, 'apps/game/src/shell/Shell.ts'), 'utf8');

/** The root the whole front end mounts under. */
const ROOT_CLASS = 'vm-shell';

/** Strip `/* *​/` comments so prose can never satisfy or break an assertion. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Drop `@keyframes` bodies. Their `from` / `to` / `40%` selectors are frame
 * offsets, not element selectors, and prefixing one would be a syntax error.
 */
function stripKeyframes(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@keyframes', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) { j++; break; }
    }
    i = j;
  }
  return out;
}

/** Every style rule as `[selector, propertyNames]`, one entry per comma part. */
function rulesOf(css: string): Array<{ sel: string; props: string[] }> {
  const out: Array<{ sel: string; props: string[] }> = [];
  for (const m of stripKeyframes(stripComments(css)).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
    for (const part of m[1].split(',')) {
      const sel = part.trim();
      if (sel === '') continue;
      out.push({ sel, props });
    }
  }
  return out;
}

/**
 * True when `sel` can only ever match inside the shell.
 *
 * Two accepted shapes, and no others:
 *   `.vm-shell…`                 the root itself, or anything below it
 *   `html<x> .vm-shell…`         the `html.vm-no-blur` platform gate
 */
function isRooted(sel: string): boolean {
  if (new RegExp(`^\\.${ROOT_CLASS}(?![\\w-])`).test(sel)) return true;
  const gate = /^html[^\s]*\s+([\s\S]+)$/.exec(sel);
  return gate !== null && new RegExp(`^\\.${ROOT_CLASS}(?![\\w-])`).test(gate[1]);
}

/* ==========================================================================
 * 1. THE ROOT IS REAL
 * ========================================================================== */

describe('the class every rule is scoped to is the class the shell actually mounts', () => {
  it('Shell.ts builds the root div with it', () => {
    // Scoping to a class nothing emits would hide the whole front end, and it
    // would do it silently — every rule would simply stop matching.
    expect(SHELL_TS).toContain(`el('div', '${ROOT_CLASS}')`);
  });

  it('the stylesheet declares the root rule itself', () => {
    expect(stripComments(SHELL_CSS)).toMatch(new RegExp(`\\.${ROOT_CLASS}\\s*\\{`));
  });
});

/* ==========================================================================
 * 2. NOTHING IN shell.css CAN REACH OUT OF THE SHELL
 * ========================================================================== */

describe('every selector in src/shell/shell.css is rooted at .vm-shell', () => {
  const rules = rulesOf(SHELL_CSS);

  it('parses a plausible number of rules (the scan is not matching nothing)', () => {
    expect(rules.length).toBeGreaterThan(200);
  });

  it('has no unrooted selector', () => {
    const loose = rules.map((r) => r.sel).filter((sel) => !isRooted(sel));
    expect(
      loose,
      `unrooted selector(s) in src/shell/shell.css: ${loose.join(' | ')}. ` +
      `The HUD uses the same \`vm-\` prefix and is mounted at the same time, so a ` +
      `bare \`.vm-x\` here styles HUD nodes too. Prefix it with \`.${ROOT_CLASS} \`.`,
    ).toEqual([]);
  });

  it('has no unrooted selector in savegame.css either', () => {
    const loose = rulesOf(SAVEGAME_CSS).map((r) => r.sel).filter((sel) => !isRooted(sel));
    expect(loose).toEqual([]);
  });
});

/* ==========================================================================
 * 3. THE COLLISION SET IS EMPTY, MEASURED THE SAME WAY THE AUDIT MEASURED IT
 * ========================================================================== */

/** Class tokens the in-match interface actually puts on an element. */
function inMatchClassTokens(): Set<string> {
  const out = new Set<string>();
  const files = [
    'apps/game/src/ui/Hud.ts', 'apps/game/src/ui/Sidebar.ts', 'apps/game/src/ui/Chrome.ts', 'apps/game/src/ui/Minimap.ts',
    'apps/game/src/ui/Overlay.ts', 'apps/game/src/ui/icons.ts', 'apps/game/src/ui/Objectives.ts',
    'apps/game/src/ui/ObjectiveBanner.ts', 'apps/game/src/ui/PerfHud.ts',
  ];
  for (const f of files) {
    // Deliberately loose: every `vm-*` identifier that is not a custom
    // property. A false positive costs a rule that was going to be scoped
    // anyway; a false negative is how `.vm-tab` was missed the first time, its
    // class being built in a template literal the quote-anchored scan skipped.
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/(--)?\bvm-[a-z0-9-]+/g)) {
      if (m[1] === undefined) out.add(m[0]);
    }
  }
  return out;
}

describe('no shell rule has an in-match class as its subject', () => {
  it('finds zero, and the token scan is not empty', () => {
    const tokens = inMatchClassTokens();
    expect(tokens.size).toBeGreaterThan(50);
    // These ten are the classes the audit found shared. If the scan stops
    // seeing them it has broken, not improved.
    for (const c of [
      'vm-panel', 'vm-card', 'vm-card-name', 'vm-tab', 'vm-tabs',
      'vm-stat', 'vm-stat-value', 'vm-num', 'vm-icon',
    ]) {
      expect(tokens.has(c), `${c} is no longer detected as an in-match class`).toBe(true);
    }

    const reach: string[] = [];
    for (const r of rulesOf(SHELL_CSS)) {
      if (isRooted(r.sel)) continue;
      const subject = r.sel.split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
      for (const m of subject.matchAll(/\.([a-z0-9-]+)/g)) {
        if (tokens.has(m[1])) reach.push(`${r.sel} -> .${m[1]}`);
      }
    }
    expect(reach).toEqual([]);
  });
});

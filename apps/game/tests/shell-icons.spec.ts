/* ==========================================================================
 * VOLTMARCH — tests/shell-icons.spec.ts
 * ==========================================================================
 * EVERY `iconName` THE SHELL ASKS FOR MUST BE AN ICON THE SHELL HAS.
 *
 * `Shell.icon()` ends in `ICON_PATHS[name] ?? ICON_PATHS.info`. That fallback
 * is correct — a missing glyph must not throw in front of a player — and it is
 * also completely silent: a typo, or a name borrowed from `src/ui/icons.ts`
 * (a DIFFERENT set of 67 icons that shares neither its names nor its
 * geometry), renders the little "i" and nothing anywhere says so.
 *
 * **THAT IS NOT HYPOTHETICAL AND IT IS WHY THIS FILE EXISTS.** The pause
 * menu's Minimize button was written with `iconName: 'minus'` — a name from no
 * set at all — and `npm run typecheck` was clean, because `ButtonOptions.iconName`
 * is `string` rather than `keyof typeof ICON_PATHS`. It was caught by reading
 * the icon table by hand, which is not a mechanism.
 *
 * ── WHY NOT JUST TYPE THE FIELD ─────────────────────────────────────────────
 * Because `icon()` deliberately accepts `keyof typeof ICON_PATHS | string`, so
 * a caller holding a name computed at runtime — `iconForBuildable` produces
 * exactly that — can still ask. Narrowing the parameter would refuse a legal
 * caller to catch an illegal literal. This checks the LITERALS, which is where
 * every real mistake has been, and leaves the computed path alone.
 * ========================================================================== */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHELL = join(__dirname, '..', 'src', 'shell');

/** Every key of `ICON_PATHS`, read out of the table itself. */
function iconNames(): Set<string> {
  const src = readFileSync(join(SHELL, 'Shell.ts'), 'utf8');
  const at = src.indexOf('ICON_PATHS');
  expect(at, 'Shell.ts no longer declares ICON_PATHS — this spec reads it').toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf('\n};', at));
  return new Set([...body.matchAll(/^\s{2}([A-Za-z][\w-]*):/gm)].map((m) => m[1] ?? ''));
}

/** Every `iconName: '...'` literal across the shell, with the file it is in. */
function requested(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const f of readdirSync(SHELL)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(join(SHELL, f), 'utf8');
    for (const m of src.matchAll(/iconName:\s*'([^']+)'/g)) out.push({ file: f, name: m[1] ?? '' });
  }
  return out;
}

describe('the shell asks for icons it actually has', () => {
  const names = iconNames();
  const asked = requested();

  it('found both halves — the table and the call sites', () => {
    // THE VACUITY GUARD, and it is the one that matters here: an empty `asked`
    // makes the assertion below pass for the one reason that is not the code
    // being right. An empty `names` would make it fail loudly instead, which is
    // the safe direction, but it is worth saying which is which.
    expect(names.size, 'ICON_PATHS came back empty — the scan is broken').toBeGreaterThan(20);
    expect(asked.length, 'no iconName literal was found anywhere in src/shell')
      .toBeGreaterThan(10);
    // Sanity on the scan itself, against a name that has been there for ages.
    expect(names.has('play'), "ICON_PATHS should contain 'play'").toBe(true);
  });

  it('every literal names a real icon', () => {
    const missing = asked.filter((a) => !names.has(a.name));
    expect(missing.map((a) => `${a.file}: '${a.name}'`),
      "these render Shell.icon()'s `?? ICON_PATHS.info` fallback — the little 'i' — silently, "
      + 'and typecheck cannot see it because ButtonOptions.iconName is `string`. Note that '
      + '`src/ui/icons.ts` is a DIFFERENT set of 67 names; borrowing one from there lands here.')
      .toEqual([]);
  });

  it("and the fallback is still an `info` default rather than a throw", () => {
    // The rule above is only worth having while the failure is SILENT. If
    // `icon()` ever starts throwing on an unknown name, this file is redundant
    // and should say so rather than sit there looking useful.
    const src = readFileSync(join(SHELL, 'Shell.ts'), 'utf8');
    expect(src, 'Shell.icon() no longer falls back to ICON_PATHS.info — re-read this file')
      .toContain('ICON_PATHS[name] ?? ICON_PATHS.info');
  });
});

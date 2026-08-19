/**
 * ============================================================================
 * CAMPAIGN BUNDLE ISOLATION — a skirmish player must not download the campaign.
 * ============================================================================
 * `src/game/Systems.ts` globs `'../**\/*.system.ts'` with `eager: true`, and it
 * does that FROM THE ENTRY CHUNK. So every module statically reachable from any
 * of the fifty system modules — `src/game/campaign.system.ts` among them, but
 * `src/progression/progression.system.ts` just as much — is fetched, parsed and
 * executed before the first paint: by a player who opens a skirmish, by a player
 * who opens the main menu and quits, and by `npm run shots`, thirteen times.
 *
 * The campaign is the largest body of authored content in the product after the
 * manual: a Director, an operation table, a validator, 37 layouts and every word
 * of dialogue. `campaign-install.ts` exists solely to keep it on the far side of
 * one `await import()`. Nothing about that boundary is enforced by the language
 * — it is one accidental `import { runDirector } from '../campaign/Director'`
 * away from being gone, and NOTHING ELSE WOULD FAIL. The build stays green, the
 * types stay sound, every campaign test still passes, and the only symptom is
 * that first paint got slower for everyone.
 *
 * ── THE ROOT SET IS THE WHOLE ENTRY CHUNK, NOT ONE MODULE ───────────────────
 * MEASURED 2026-08-19, AND THIS FILE FAILED IT. Adding
 * `import { CAMPAIGNS } from './index'` to `src/campaign/campaign-store.ts` —
 * which IS entry-chunk-reachable, because `src/progression/progression.system.ts`
 * statically imports `recordOperation` from it — left every source tier here
 * GREEN at 26/26. Three structural reasons, all now closed:
 *
 *   1. §1's sweep skipped every file under `campaign/`, which exempted the one
 *      campaign file that is on the wrong side of the boundary.
 *   2. §1 rooted its transitive closure at `campaign.system.ts` ALONE.
 *      `progression.system.ts` is the counterexample: it is in the entry chunk
 *      for exactly the same reason and `campaign.system.ts` never reaches it.
 *   3. Only §4 could see it, and §4 is `runIf(distIsCurrent())`.
 *
 * So the closure is rooted at `src/main.ts` — the real entry — and expands
 * EAGER `import.meta.glob` as the static import it is, which is what pulls all
 * fifty `*.system.ts` in through `src/game/Systems.ts`. Measured 2026-08-19 it
 * holds 228 of the 267 `.ts` files under `src/` (plus 7 ids for the `.css`
 * imports, which resolve to no file and are counted by nothing), with the
 * campaign's heavy half, `gpu-path-install` and every `*-nodes.ts`,
 * `manual-corpus.ts`, `TurnRelay.ts`, `textureWorker.ts` and the two modules
 * nothing in `src/` imports at all — `art/Wrecks.ts`, `sim/LandRoutes.ts` —
 * outside it. And the rule stopped being about where a file LIVES: a static
 * edge into the heavy half is legal only from a module that is under
 * `src/campaign/` **and** outside that closure.
 *
 * **IT IS AN OVER-APPROXIMATION OF THE SHIPPED ENTRY CHUNK, NOT A MODEL OF
 * IT**, and a draft of this header claimed it "reproduces the shipped chunk
 * boundaries exactly". It does not, by its own next sentence: the closure
 * follows `import type`, so `main.ts`'s `import type { Shell }` is erased at
 * build time and still drags the whole shell graph in here — `shell/Shell.ts`
 * and `data/Defs.ts` are both in this closure and both ship as their own
 * chunks (`Shell-*.js` 193 kB, `Defs-*.js` 54 kB). That is the SAFE direction
 * for a rule that FORBIDS things: a module wrongly believed to be in the entry
 * chunk is refused a heavy edge it might have been allowed. Do not read
 * `ENTRY` as an answer to "what does a player download" — §4 is that answer.
 * Every failure prints the witness path, so a type-only first hop is visible
 * rather than mysterious.
 *
 * ── WHY BOTH A SOURCE SCAN AND A `dist/` SCAN ───────────────────────────────
 * `tests/webgpu-bundle-isolation.spec.ts` is the in-tree precedent and this
 * file is deliberately its shape. `npm test` does not build, and a test that
 * silently passes when `dist/` is absent is worse than none — that is the shape
 * of half the defects `docs/SPEC_DRIFT_AUDIT.md` catalogues. So §1–§3 check the
 * INVARIANTS that produce the property, in source, where they are always
 * checkable; §4 reads the real emitted chunks when a CURRENT `dist/` happens to
 * be on disk, which is the measurement rather than a substitute for the rule.
 *
 * **§4 IS STILL THE ONLY TIER THAT CAN SEE ONE CLASS OF VIOLATION, AND IT
 * SKIPS ON MOST TREES.** §1–§3 read what the SOURCE declares; they cannot
 * predict what rollup DOES with it. A dynamic `import()` that the bundler
 * decides to inline, or campaign code hoisted into a shared chunk that the
 * entry statically pulls in, is invisible to every source rule in this file and
 * shows up only in §4 — which runs `runIf(distIsCurrent())` and therefore skips
 * for the whole of any session in which somebody is editing `src/`. **This file
 * is a complete guard against the DECLARATIONS and a best-effort one against
 * the emitted graph.** If a chunking change is what you are worried about,
 * build first, then run this.
 *
 * ── THE HALF THAT MAKES THIS WORTH WRITING ──────────────────────────────────
 * Every assertion here is an ABSENCE, and an absence assertion passes just as
 * happily when the thing was deleted. So §4 requires the fingerprints to be
 * present in some OTHER chunk, §1 runs its own forbidden-import rule against a
 * file that genuinely violates it and requires a hit, and §0 requires every
 * fingerprint string to exist in `src/campaign/**` before it may be used to
 * prove anything. A typo'd fingerprint FAILS here rather than quietly
 * certifying an empty bundle.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/* ==========================================================================
 * 0. MACHINERY — AN IMPORT PARSER, NOT A GREP
 *
 * A grep cannot do this job and the campaign source is the proof: five separate
 * files carry the literal text `await import('./campaign-install')` INSIDE A
 * BANNER COMMENT, describing the boundary. A loose scan reports five dynamic
 * importers and one static one where there are two and none. Comments are
 * stripped first, string bodies are preserved, and the import forms are matched
 * as statements.
 *
 * Measured against `typescript`'s own parser over all 259 files in `src/`: zero
 * missed and zero spurious edges, static and dynamic. A loose scan of the same
 * tree reports SIX dynamic importers of `campaign-install` where there are two,
 * and no static ones either way — the static forms never appear in prose here.
 *
 * WHAT IT CANNOT SEE IS `import.meta.glob`, WHICH IS ALSO A STATIC IMPORT.
 * §0b parses that form — the entry-chunk closure in §0c cannot be computed
 * without it — and §3b holds the rule about where one may be written.
 * ========================================================================== */

const BACKSLASH = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const rel = (p: string): string => relative(SRC, p).split(sep).join('/');

/**
 * Remove `//` and block comments while keeping every string and template
 * literal intact, so a specifier inside a comment cannot be read as an edge and
 * a specifier inside real code cannot be eaten.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== NEWLINE) i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === BACKSLASH) {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        const ch = src[i];
        out += ch;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `import ... from 'x'` and `export ... from 'x'` — a re-export is an edge too. */
const FROM_EDGE = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t\r\n]*['"]([^'"]+)['"]/g;
/** Side-effect `import 'x'`. */
const BARE_EDGE = /(?:^|\n)[ \t]*import[ \t\r\n]*['"]([^'"]+)['"]/g;
/** `import('x')` in expression position. */
const DYNAMIC_EDGE = /import[ \t\r\n]*\([ \t\r\n]*['"]([^'"]+)['"][ \t\r\n]*\)/g;

const SOURCE = new Map<string, string>(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const STRIPPED = new Map<string, string>(FILES.map((f) => [f, stripComments(SOURCE.get(f)!)]));

function staticSpecifiers(file: string): string[] {
  const s = STRIPPED.get(file)!;
  const out: string[] = [];
  for (const m of s.matchAll(FROM_EDGE)) out.push(m[1]);
  for (const m of s.matchAll(BARE_EDGE)) out.push(m[1]);
  return out;
}

function dynamicSpecifiers(file: string): string[] {
  const out: string[] = [];
  for (const m of STRIPPED.get(file)!.matchAll(DYNAMIC_EDGE)) out.push(m[1]);
  return out;
}

/**
 * Resolve a specifier the way the bundler does. Bare package ids answer null.
 *
 * **`@/x` IS `src/x` AND A RELATIVE-ONLY RESOLVER IS A RULE ONE KEYSTROKE
 * WIDE.** The alias is declared TWICE — `resolve.alias` in `vite.config.ts`
 * and `paths` in `tsconfig.json` — so an aliased import builds and typechecks
 * exactly like a relative one. MEASURED 2026-08-19: with
 * `import { CAMPAIGNS } from '@/campaign/index'` USED in `campaign-store.ts`,
 * `campaign-install-*.js` collapsed 48.94 kB -> 9.08 kB, the entry chunk grew
 * 2730.99 kB -> 2825.08 kB, and every fingerprint in §4 turned up in the entry
 * chunk — while §1-§3 stayed green at 31/31, because the resolver returned
 * null for the specifier and the edge never existed. The relative spelling of
 * the same import fails §1 by name. Nothing in `src/` uses the alias today,
 * which is exactly why the resolver has to know about it before something
 * does.
 */
function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const cand of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return `${base}.ts`;
}

/** Every `src/` module statically reachable from `entry`, as `src`-relative ids. */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    for (const spec of staticSpecifiers(f)) {
      const r = resolveSpecifier(f, spec);
      if (r === null) continue;
      const id = rel(r);
      if (seen.has(id)) continue;
      seen.add(id);
      if (SOURCE.has(r)) stack.push(r);
    }
  }
  return seen;
}

/* --------------------------------------------------------------------------
 * 0b. THE SECOND STATIC IMPORT FORM — `import.meta.glob`
 *
 * Lives here rather than beside its own rule in §3b because the entry-chunk
 * closure below CANNOT BE COMPUTED WITHOUT IT: `src/game/Systems.ts` reaches
 * all fifty `*.system.ts` by an eager glob and by nothing else, so a closure
 * that ignores globs stops at `Systems.ts` and never sees a system module at
 * all. §3b keeps the rule; §0b owns the parsing.
 * -------------------------------------------------------------------------- */

/** Regex metacharacters that can appear in a path or a glob and must be literal. */
const REGEX_SPECIALS = '^$+?.()|[]{}';

/**
 * Pattern -> matcher, with vite's semantics for the two wildcards: `*` stays
 * inside one segment, `/**\/` spans any number of segments INCLUDING ZERO.
 *
 * THE ZERO CASE IS ASSERTED ON THIS FUNCTION AND NOT THROUGH THE TREE, and the
 * reason is worth a line: every operation today sits one directory down
 * (`operations/soviets/01-first-tap.ts`), so a naive `/.*\/` matches all of
 * them and every tree-shaped control below stays green. Measured — swapping the
 * zero case out fails nothing here. It would first be felt as a silent miss the
 * day an operation is added directly under `operations/`.
 */
function globToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('/**/', i)) { out += '/(?:.*/)?'; i += 4; continue; }
    if (pattern.startsWith('**', i)) { out += '.*'; i += 2; continue; }
    const c = pattern[i];
    if (c === '*') out += '[^/]*';
    else if (REGEX_SPECIALS.includes(c)) out += `${BACKSLASH}${c}`;
    else out += c;
    i++;
  }
  return new RegExp(`^${out}$`);
}

/** Every `.ts` file under `src/` that `pattern`, written in `file`, pulls in. */
function globMatches(file: string, pattern: string): string[] {
  // Resolved to an ABSOLUTE pattern first. Matching relative paths is wrong:
  // `Systems.ts`'s `'../**\/*.system.ts'` covers its own directory, and a
  // sibling reached by `relative()` carries no `../` for the pattern to meet.
  const abs = resolve(dirname(file), pattern).split(sep).join('/');
  const re = globToRegExp(abs);
  return FILES.filter((f) => re.test(f.split(sep).join('/'))).map(rel);
}

/**
 * `{ pattern, eager }` for every `import.meta.glob` call in `file`.
 *
 * **EAGERNESS IS NOT COSMETIC AND IT IS NOT A COMMENT.** `{ eager: true }` is a
 * static import of every match; without it the call is a record of loaders and
 * the matches SPLIT into their own chunks. `game/Scenarios.ts` globs
 * `../data/**\/*.ts` lazily and `game/Systems.ts` globs `../**\/*.system.ts`
 * eagerly, and reading those two the same way is the difference between a
 * closure of 235 modules and one of 141.
 */
function globSites(file: string): { pattern: string; eager: boolean }[] {
  const s = STRIPPED.get(file)!;
  const out: { pattern: string; eager: boolean }[] = [];
  const needle = 'import.meta.glob';
  let at = s.indexOf(needle);
  while (at !== -1) {
    // The call's `(` may sit past a type argument — `glob<Record<string, unknown>>(`.
    const open = s.indexOf('(', at);
    if (open !== -1) {
      const m = /^[ \t\r\n]*(['"])([^'"]+)\1/.exec(s.slice(open + 1));
      if (m !== null) {
        // The options object is the rest of the call, so scan to the matching
        // `)` rather than to the end of the line — `campaign/index.ts` puts
        // `{ eager: true }` two lines below its pattern.
        let depth = 0;
        let end = s.length;
        for (let j = open; j < s.length; j++) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') { depth--; if (depth === 0) { end = j; break; } }
        }
        out.push({ pattern: m[2], eager: /\beager[ \t\r\n]*:[ \t\r\n]*true\b/.test(s.slice(open, end)) });
      }
    }
    at = s.indexOf(needle, at + needle.length);
  }
  return out;
}

function globPatterns(file: string): string[] {
  return globSites(file).map((g) => g.pattern);
}

const GLOB_SITES: readonly { readonly file: string; readonly pattern: string; readonly eager: boolean }[] =
  FILES.flatMap((f) => globSites(f).map((g) => ({ file: f, ...g })));

/* --------------------------------------------------------------------------
 * 0c. THE ENTRY CHUNK, AS A SET OF MODULES WITH A WITNESS PATH FOR EACH
 * -------------------------------------------------------------------------- */

/** `index.html` loads exactly one module, and this is it. */
const ENTRY_ROOT = join(SRC, 'main.ts');

/**
 * Every module in the entry chunk, mapped to the shortest path that puts it
 * there. Breadth-first, so the recorded path is the shortest one and a failure
 * message names the edge worth deleting rather than a random detour.
 *
 * ROOTED AT `main.ts` AND NOWHERE ELSE. Rooting at `campaign.system.ts` is what
 * this file used to do and it is the bug in the header: a system module is only
 * ONE of the fifty things the entry chunk holds, and the file that actually
 * leaked — `campaign-store.ts`, reached through `progression.system.ts` — is
 * not reachable from it. Everything a `*.system.ts` contributes arrives here
 * anyway, because `main.ts` reaches `game/Systems.ts` and its glob is expanded
 * below.
 */
function entryClosure(): Map<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>([[rel(ENTRY_ROOT), [rel(ENTRY_ROOT)]]]);
  const queue: string[] = [ENTRY_ROOT];
  for (let head = 0; head < queue.length; head++) {
    const f = queue[head];
    const here = paths.get(rel(f))!;
    const reached: string[] = [];
    for (const spec of staticSpecifiers(f)) {
      const r = resolveSpecifier(f, spec);
      if (r !== null) reached.push(r);
    }
    for (const { pattern, eager } of globSites(f)) {
      if (!eager) continue;
      for (const id of globMatches(f, pattern)) reached.push(join(SRC, id));
    }
    for (const r of reached) {
      const id = rel(r);
      if (paths.has(id)) continue;
      paths.set(id, [...here, id]);
      if (SOURCE.has(r)) queue.push(r);
    }
  }
  return paths;
}

const ENTRY = entryClosure();

/** `main.ts -> game/Bootstrap.ts -> ...`, for a failure message. */
const witness = (id: string): string => (ENTRY.get(id) ?? [id]).join(' -> ');

const SYSTEM_FILES = FILES.filter((f) => f.endsWith('.system.ts')).sort();

describe('the import parser can be trusted with the rest of this file', () => {
  it('never loses an import statement to the comment stripper', () => {
    /*
     * THE FALSIFIER FOR EVERY OTHER TEST HERE. A stripper that ate a real
     * import would make every absence assertion below pass for the wrong
     * reason, silently and permanently. Column-zero `import` is a statement in
     * this tree — banner comments are indented by ` * ` — so the raw count is a
     * lower bound the parser must meet or beat on every file in `src/`.
     */
    const short: string[] = [];
    for (const f of FILES) {
      const naive = (SOURCE.get(f)!.match(/^import\b/gm) ?? []).length;
      if (staticSpecifiers(f).length < naive) short.push(`${rel(f)} (${naive} raw)`);
    }
    expect(short, `the parser under-counted imports in: ${short.join(', ')}`).toEqual([]);
    // And it must be finding a real graph, not zero edges everywhere.
    expect(FILES.length).toBeGreaterThan(200);
    expect(staticSpecifiers(join(SRC, 'campaign/campaign-install.ts')).length).toBeGreaterThan(8);
  });

  it('resolves the `@/` alias, which is a second spelling of every path here', () => {
    /*
     * FALSIFIER FOR THE ALIAS BRANCH IN `resolveSpecifier`. Nothing in `src/`
     * writes `@/` today, so the branch has no live case in the tree and would
     * rot silently — and it is the branch that decides whether the whole rule
     * below can be evaded by typing eight characters differently. Both
     * spellings of the SAME edge must resolve to the same file.
     */
    const store = join(SRC, 'campaign/campaign-store.ts');
    expect(resolveSpecifier(store, './index')).toBe(join(SRC, 'campaign/index.ts'));
    expect(resolveSpecifier(store, '@/campaign/index')).toBe(join(SRC, 'campaign/index.ts'));
    expect(resolveSpecifier(store, '@/campaign/Director')).toBe(join(SRC, 'campaign/Director.ts'));
    // A bare package id is still not an edge into `src/`.
    expect(resolveSpecifier(store, 'three')).toBeNull();
    expect(resolveSpecifier(store, 'three/webgpu')).toBeNull();
    // Nothing in `src/` writes `@/` today, which is why this test asserts the
    // FUNCTION rather than pointing at a file. It is deliberately not a rule
    // against using the alias — an aliased `@/core/types` is perfectly fine,
    // and the sweep below now sees it either way.
  });

  it('reads a specifier written inside a banner comment as prose, not as an edge', () => {
    /*
     * NOT HYPOTHETICAL. `session.ts`, `types.ts`, `campaign.system.ts`,
     * `index.ts` and `runtime.ts` all name `campaign-install` in their headers.
     * `types.ts` writes it as a complete expression — "behind one
     * `await import('./campaign-install')`" — which a grep counts as a call.
     */
    const types = join(SRC, 'campaign/types.ts');
    expect(SOURCE.get(types)!).toContain("await import('./campaign-install')");
    expect(dynamicSpecifiers(types)).toEqual([]);
    /*
     * BOTH OF THESE ARE `import type`, AND BOTH ARE LISTED ON PURPOSE. The
     * closure follows type-only edges by design — the header says why, and it
     * is the conservative direction — so this fixture has to list them too or
     * it would be asserting a parser that behaves differently from the one the
     * rules use.
     *
     * `../world/Biomes` arrived when `OperationMap.biome` stopped being
     * `string` and became `BiomeName`. It costs nothing: the import is erased
     * at build time, and `Biomes.ts` is already in the entry chunk because the
     * terrain generator is. Verified against the build — `campaign-install`
     * stayed 112.33 kB across the change.
     */
    expect(staticSpecifiers(types)).toEqual(['../core/types', '../world/Biomes']);
  });
});

/* ==========================================================================
 * 1. THE SYSTEM MODULE IMPORTS THE LIGHT SEAM AND NOTHING ELSE
 * ========================================================================== */

const CAMPAIGN_SYSTEM = join(SRC, 'game/campaign.system.ts');

/**
 * The heavy half. Every one of these is either the evaluator, the operation
 * table, the validator or authored content, and a static edge from the entry
 * chunk to any of them puts the whole campaign in front of first paint.
 */
const HEAVY = [
  'campaign/Director.ts',
  'campaign/runtime.ts',
  'campaign/index.ts',
  'campaign/campaign-install.ts',
  'campaign/validate.ts',
  'campaign/layout.ts',
];

const isHeavy = (id: string): boolean =>
  HEAVY.includes(id) || id.startsWith('campaign/layouts/') || id.startsWith('campaign/operations/');

/** Every static edge anywhere in `src/` that lands on the heavy half. */
const HEAVY_EDGES: readonly { readonly from: string; readonly to: string }[] = FILES.flatMap((f) =>
  [...new Set(
    staticSpecifiers(f)
      .map((s) => resolveSpecifier(f, s))
      .filter((p): p is string => p !== null)
      .map(rel)
      .filter(isHeavy),
  )].sort().map((to) => ({ from: rel(f), to })),
);

/**
 * THE RULE, AND IT IS A CONJUNCTION RATHER THAN A PREFIX SKIP.
 *
 * A static edge into the heavy half is legal only from a module that is BOTH
 * under `src/campaign/` AND outside the entry-chunk closure — i.e. one that
 * already lives on the far side of `await import('./campaign-install')`, where
 * the whole point is that these files import each other freely.
 *
 * The version this replaced was `if (id.startsWith('campaign/')) continue`,
 * which is the first half alone. That reads as "intra-campaign imports are
 * fine", which is true of every campaign file EXCEPT the ones the entry chunk
 * can already reach — `campaign-store.ts`, `policy.ts`, `session.ts` and
 * `types.ts`, four files that are deliberately light precisely so a system
 * module may import them. Exempting them by the directory they sit in is
 * exempting the only four that matter.
 */
const mayImportHeavy = (id: string): boolean => id.startsWith('campaign/') && !ENTRY.has(id);

describe('campaign.system.ts reaches only the light seam', () => {
  const direct = staticSpecifiers(CAMPAIGN_SYSTEM)
    .map((s) => resolveSpecifier(CAMPAIGN_SYSTEM, s))
    .filter((p): p is string => p !== null)
    .map(rel);

  it('imports core, game/context and campaign/{policy,session} — and that is the whole list', () => {
    /*
     * A RULE, NOT A ROSTER. New `core/` imports are free — `core/**` is in the
     * entry chunk under every configuration — and so is `game/context.ts`,
     * which every system module already holds. Anything else has to be argued
     * for here, in this list, rather than added in a diff nobody reads.
     */
    const allowed = (id: string): boolean =>
      id.startsWith('core/')
      || id === 'game/context.ts'
      || id === 'campaign/policy.ts'
      || id === 'campaign/session.ts'
      || id === 'campaign/types.ts';
    const offenders = [...new Set(direct)].filter((id) => !allowed(id)).sort();
    expect(
      offenders,
      'campaign.system.ts is globbed eagerly from the entry chunk, so these ride into first '
      + `paint for every player: ${offenders.join(', ')}. Reach them through `
      + "`await import('../campaign/campaign-install')` instead.",
    ).toEqual([]);
    // Non-vacuity: the parse found the real imports, not an empty list.
    expect(direct).toContain('campaign/session.ts');
    expect(direct).toContain('campaign/policy.ts');
    expect(direct).toContain('core/loop.ts');
  });

  it('names none of the Director, the table, the validator or any layout', () => {
    const heavy = [...new Set(direct)].filter(isHeavy).sort();
    expect(heavy, `campaign.system.ts statically imports: ${heavy.join(', ')}`).toEqual([]);
  });

  it('and nothing it imports reaches them either — the transitive half', () => {
    /*
     * THE DIRECT CHECK ALONE IS NOT THE PROPERTY. `policy.ts` importing
     * `Director.ts` would put the Director in the entry chunk just as surely,
     * and `campaign.system.ts`'s own import list would still read clean. The
     * closure below is over EVERY static edge including `import type`, which is
     * the conservative direction: a type-only edge is erased and costs nothing,
     * so a hit here is a warning one commit before it becomes a value import.
     */
    const closure = [...staticClosure(CAMPAIGN_SYSTEM)]
      .filter((id) => id.startsWith('campaign/'))
      .sort();
    expect(closure).toEqual(['campaign/policy.ts', 'campaign/session.ts', 'campaign/types.ts']);
  });

  it('has a forbidden-import rule that a real violator actually trips', () => {
    /*
     * THE FALSIFIER. Three green absence assertions above prove nothing unless
     * the predicate they use can go red. `campaign-install.ts` is the module
     * that legitimately imports the whole heavy half, so running the same rule
     * against it must find the Director, the table and the evaluator. If this
     * ever returns an empty list, `isHeavy` has stopped matching and the tests
     * above are decorative.
     */
    const install = join(SRC, 'campaign/campaign-install.ts');
    const hits = [...new Set(
      staticSpecifiers(install)
        .map((s) => resolveSpecifier(install, s))
        .filter((p): p is string => p !== null)
        .map(rel)
        .filter(isHeavy),
    )].sort();
    expect(hits).toEqual(['campaign/Director.ts', 'campaign/index.ts', 'campaign/runtime.ts']);
  });

  it('lets nothing name a heavy campaign file except the lazy half of the campaign itself', () => {
    /*
     * THE SWEEP, over every file in `src/` with no directory exempt from it.
     * Two ways to fail and the message says which:
     *
     *   - the importer is in the entry chunk, so the campaign is in front of
     *     first paint for everyone. This is what `campaign-store.ts` did.
     *   - the importer is outside `src/campaign/` and lazy, so the campaign
     *     lands in whatever chunk holds it — the shell chunk, usually. Smaller
     *     than the entry-chunk failure and still not the design.
     */
    const offenders = HEAVY_EDGES.filter(({ from }) => !mayImportHeavy(from));
    const lines = offenders.map(({ from, to }) => (
      ENTRY.has(from)
        ? `${from} -> ${to}  [IN THE ENTRY CHUNK: ${witness(from)}]`
        : `${from} -> ${to}  [outside src/campaign, so it rides in that file's chunk]`
    ));
    expect(
      lines,
      "static edges into the campaign's heavy half. Reach it through "
      + "`await import('../campaign/campaign-install')` instead, or make the importing module "
      + `lazy: ${NEWLINE}  ${lines.join(`${NEWLINE}  `)}`,
    ).toEqual([]);
  });

  it('applies that rule to campaign-store.ts, which the old prefix skip exempted', () => {
    /*
     * THE FALSIFIER FOR THE SWEEP ABOVE, and the permanent record of the defect
     * that motivated it. Three named files, one per branch of the conjunction —
     * so the predicate cannot quietly become "true" or "false" everywhere and
     * leave an absence assertion certifying nothing.
     *
     * `campaign-store.ts` is the interesting one: it is under `campaign/`, so
     * the old rule waved it through, and it IS in the entry chunk, because
     * `progression.system.ts` imports `recordOperation` from it and
     * `game/Systems.ts` globs every `*.system.ts` eagerly from there. Its own
     * header says an `import { CAMPAIGNS } from './index'` here puts the whole
     * campaign in front of every player's first paint; this is the line that
     * makes that a build failure instead of a promise.
     */
    expect(mayImportHeavy('campaign/campaign-store.ts'), witness('campaign/campaign-store.ts')).toBe(false);
    // The measured route, 2026-08-19: main.ts -> game/Bootstrap.ts ->
    // game/Systems.ts -> progression/progression.system.ts ->
    // campaign/campaign-store.ts. Only the two ends and the system module are
    // pinned — a second importer would legitimately shift the tie-break, and a
    // spec that failed for that would be pinning the search, not the finding.
    const route = ENTRY.get('campaign/campaign-store.ts') ?? [];
    expect(route[0]).toBe('main.ts');
    expect(route[route.length - 1]).toBe('campaign/campaign-store.ts');
    expect(route).toContain('progression/progression.system.ts');
    // Under `campaign/` and lazy — the one shape that is allowed.
    expect(mayImportHeavy('campaign/campaign-install.ts')).toBe(true);
    // Lazy but not under `campaign/` — refused, because it would take the
    // campaign into whatever chunk it lands in.
    expect(ENTRY.has('shell/manual-corpus.ts')).toBe(false);
    expect(mayImportHeavy('shell/manual-corpus.ts')).toBe(false);
    // And the sweep above is reading a real graph, not an empty one: the
    // campaign's own internals are full of heavy edges and every one of them is
    // legal, which is the state the rule has to permit.
    expect(HEAVY_EDGES.length).toBeGreaterThan(5);
    expect([...new Set(HEAVY_EDGES.map(({ to }) => to))].length).toBeGreaterThan(2);
  });
});

/* ==========================================================================
 * 1b. THE ENTRY CHUNK THE RULE ABOVE IS ARGUED FROM
 * ========================================================================== */

describe('the entry-chunk closure is the real one', () => {
  it('reaches every *.system.ts, which is only true if eager globs are expanded', () => {
    /*
     * THE FALSIFIER FOR `mayImportHeavy`'s SECOND HALF. `!ENTRY.has(id)` is an
     * absence test, so a closure that came back small — an eager-detector stuck
     * on false, a glob matcher answering `[]` on Windows separators — would make
     * the sweep pass green while checking almost nothing.
     *
     * MEASURED 2026-08-19: with glob expansion switched off, 44 of the 50 are
     * unreachable and this fails loudly. **It is 44 and not 50, and that is
     * worth knowing rather than rounding.** Six system modules have a SECOND
     * route, by ordinary static import off the shell — `game/replay.system.ts`,
     * `net/net.system.ts`, `progression/progression.system.ts`,
     * `render/adaptive-res.system.ts`, `render/calibration.system.ts` and
     * `shell/unlockall.system.ts`. `progression/progression.system.ts` is on
     * that list, so the leak at the top of this file was reachable from
     * `main.ts` WITHOUT the glob at all
     * (`main.ts -> shell/Shell.ts -> shell/Settings.ts ->
     * shell/unlockall.system.ts -> progression/progression.system.ts ->
     * campaign/campaign-store.ts`). Expanding the glob is what makes the rule
     * TOTAL over the other 44; do not credit it with catching that one.
     */
    expect(ENTRY.has('main.ts')).toBe(true);
    expect(ENTRY.has('game/Systems.ts')).toBe(true);
    const missing = SYSTEM_FILES.map(rel).filter((id) => !ENTRY.has(id));
    expect(missing, `system modules missing from the entry closure: ${missing.join(', ')}`).toEqual([]);
    expect(SYSTEM_FILES.length).toBeGreaterThanOrEqual(48);
  });

  it('stops at every dynamic boundary in the tree, so it is not just every file', () => {
    /*
     * THE OTHER FALSIFIER. A closure that swallowed the whole tree would answer
     * false from `mayImportHeavy` for everything, the sweep would fail loudly on
     * the campaign's own internals, and somebody would "fix" it by putting the
     * prefix skip back. These are the shipped lazy boundaries — the
     * campaign, the WebGPU node graph, the manual, the relay and the texture
     * worker — and each is documented in CLAUDE.md as its own chunk.
     */
    for (const id of [
      'campaign/campaign-install.ts', 'campaign/index.ts', 'campaign/Director.ts',
      'campaign/layout.ts', 'campaign/runtime.ts', 'campaign/validate.ts',
      'render/gpu-path-install.ts', 'shell/manual-corpus.ts',
      'net/TurnRelay.ts', 'core/workers/textureWorker.ts',
    ]) {
      expect(ENTRY.has(id), `${id} should be behind a dynamic import, not in the entry chunk`).toBe(false);
    }
    expect(ENTRY.size).toBeLessThan(FILES.length);
    expect(ENTRY.size).toBeGreaterThan(FILES.length / 2);
  });

  it('holds exactly the four campaign modules that are deliberately light', () => {
    /*
     * A ROSTER RATHER THAN A RULE, and deliberately so: this is the whole
     * surface the entry chunk is allowed to see of the campaign, it is four
     * files, and each one is light BY DESIGN with its reason in its own header.
     * A fifth arriving is the event this file exists to report, whether or not
     * it happens to carry a heavy edge on the day it lands.
     */
    expect([...ENTRY.keys()].filter((id) => id.startsWith('campaign/')).sort()).toEqual([
      'campaign/campaign-store.ts',
      'campaign/policy.ts',
      'campaign/session.ts',
      'campaign/types.ts',
    ]);
  });
});

/* ==========================================================================
 * 2. NO SYSTEM MODULE STATICALLY IMPORTS THE SHELL
 * ========================================================================== */

/**
 * DECLARED LEAKS — and this table is NOT empty, which is the finding.
 *
 * The same shape as `OVER_BAND` in `tests/emplacement-band.spec.ts` and
 * `UNFIRED_ROWS` in `tests/content-truthful.spec.ts`, for the same reason: an
 * exception belongs typed out next to its cause, in a place that is read. Both
 * directions are checked below — a NEW leak fails the first test, and repairing
 * a declared one fails the second, so a stale exemption cannot outlive its
 * cause.
 */
const DECLARED_SHELL_LEAKS: Readonly<Record<string, string>> = {
  /*
   * MEASURED, NOT SUSPECTED: `src/shell/tutorial-steps.ts` is 33 kB of authored
   * step prose, and it is in the entry chunk today. Two of its own strings —
   * "Slide the view across the field" and "Zoom the camera in and out" — appear
   * in `dist/assets/index-*.js` and in no other emitted chunk, so every player
   * downloads the tutorial script before first paint whether or not they ever
   * open the tutorial.
   *
   * This is the exact failure the campaign's whole `campaign-install.ts`
   * boundary exists to prevent, already shipped once by the neighbouring
   * feature, which is why this file asserts the rule across ALL fifty system
   * modules rather than only the campaign's one. It is declared rather than
   * fixed because `src/shell/tutorial.system.ts` is not this change's file; the
   * repair is `Tutorial.ts`-shaped — the director half loads its steps through
   * a dynamic import the way `Manual.ts#loadManual` loads the wiki corpus.
   */
  'shell/tutorial.system.ts -> shell/tutorial-steps.ts':
    '33 kB of tutorial step prose, confirmed in the entry chunk',
};

function shellEdgesOf(file: string): string[] {
  const out: string[] = [];
  for (const spec of staticSpecifiers(file)) {
    const r = resolveSpecifier(file, spec);
    if (r === null) continue;
    const id = rel(r);
    if (id.startsWith('shell/') && !id.endsWith('.system.ts')) out.push(`${rel(file)} -> ${id}`);
  }
  return [...new Set(out)];
}

const ALL_SHELL_EDGES = SYSTEM_FILES.flatMap(shellEdgesOf).sort();

describe('a system module never drags the front end into first paint', () => {
  it('finds every *.system.ts in the tree, not a subdirectory of them', () => {
    // `Systems.ts` globs `'../**\/*.system.ts'` from `src/game/`, so the rule
    // has to be checked over the same set — every directory, not just `game/`.
    expect(SYSTEM_FILES.length).toBeGreaterThanOrEqual(48);
    for (const id of ['game/campaign.system.ts', 'shell/tutorial.system.ts', 'sim/ai.system.ts']) {
      expect(SYSTEM_FILES.map(rel)).toContain(id);
    }
  });

  it('has no undeclared static edge from any system module into src/shell', () => {
    const undeclared = ALL_SHELL_EDGES.filter((e) => DECLARED_SHELL_LEAKS[e] === undefined);
    expect(
      undeclared,
      'these put a shell module in the entry chunk, because `src/game/Systems.ts` globs every '
      + `*.system.ts with \`eager: true\` from there: ${undeclared.join(', ')}. Load it through a `
      + 'dynamic import, or add the edge to DECLARED_SHELL_LEAKS with what it costs.',
    ).toEqual([]);
  });

  it('still finds every declared leak genuinely present', () => {
    // The other direction. A list of excuses nobody re-checks is how a fixed
    // defect goes on being described as unfixed for three releases.
    const gone = Object.keys(DECLARED_SHELL_LEAKS).filter((e) => !ALL_SHELL_EDGES.includes(e));
    expect(
      gone,
      `declared as a shell leak but no longer present: ${gone.join(', ')}. `
      + 'Delete its DECLARED_SHELL_LEAKS entry.',
    ).toEqual([]);
  });

  it('detects a shell edge at all — the scanner is not answering empty', () => {
    /*
     * FALSIFIER for the two tests above. If `shellEdgesOf` matched nothing —
     * a resolver change, a path-separator slip on Windows — both would pass
     * green forever while the rule checked nothing. The one edge that exists is
     * the proof it can see one.
     */
    expect(shellEdgesOf(join(SRC, 'shell/tutorial.system.ts')))
      .toEqual(['shell/tutorial.system.ts -> shell/tutorial-steps.ts']);
    expect(ALL_SHELL_EDGES.length).toBe(Object.keys(DECLARED_SHELL_LEAKS).length);
  });

  it('leaves the campaign system clean of the shell entirely', () => {
    // It talks to the shell through the duck-typed `globalThis.__vmShell`
    // precisely so it needs no import, and its own header says so.
    expect(shellEdgesOf(CAMPAIGN_SYSTEM)).toEqual([]);
    expect(SOURCE.get(CAMPAIGN_SYSTEM)!).toContain('__vmShell');
  });
});

/* ==========================================================================
 * 3. ONE DYNAMIC BOUNDARY, AND IT IS A DECLARATION
 * ========================================================================== */

/**
 * Every FILE that reaches `campaign-install` by dynamic import, pinned.
 *
 * More than one is not a defect — each `import()` splits the same chunk, and
 * `Campaign.ts#loadCampaign` memoises the promise so the second caller pays
 * nothing. What must not happen is the list growing by accident: a boundary
 * crossed from four places is a boundary nobody owns. Adding a CALL SITE inside
 * a file already on this list is free; adding a new FILE fails here and has to
 * be argued for.
 *
 * Today: `shell/Campaign.ts` x1 (the memoised loader), `shell/Shell.ts` x2
 * (`startOperation` and the retry path). Three sites, two files.
 */
const DYNAMIC_IMPORTERS: readonly string[] = ['shell/Campaign.ts', 'shell/Shell.ts'];

describe('campaign-install is reached only by dynamic import, only from the shell', () => {
  const importers = FILES
    .filter((f) => dynamicSpecifiers(f).some((s) => s.endsWith('campaign-install')))
    .map(rel)
    .sort();

  it('is imported dynamically by exactly the declared files', () => {
    expect(
      importers,
      'the set of files crossing the campaign chunk boundary changed. If that is intended, '
      + 'update DYNAMIC_IMPORTERS and say why the new one needs its own crossing.',
    ).toEqual([...DYNAMIC_IMPORTERS]);
  });

  it('is crossed only from src/shell — never from a system module or the sim', () => {
    /*
     * The layering rule, which survives the pin above being edited. `src/game/`
     * and `src/sim/` may not reach the front end's content at all, and a
     * `*.system.ts` doing this would be arming an operation from inside the
     * fixed step.
     */
    const wrongSide = importers.filter((id) => !id.startsWith('shell/') || id.endsWith('.system.ts'));
    expect(wrongSide, `campaign-install imported from: ${wrongSide.join(', ')}`).toEqual([]);
    expect(importers.length).toBeGreaterThan(0);
  });

  it('is imported statically by nobody', () => {
    // A single static edge here collapses the whole feature into the chunk that
    // holds it, and `Shell.ts` is in the shell chunk — so this would not even
    // show up as an entry-chunk regression. It would show up as the campaign
    // arriving with the main menu.
    const bad: string[] = [];
    for (const f of FILES) {
      for (const spec of staticSpecifiers(f)) {
        if (spec.endsWith('campaign-install')) bad.push(rel(f));
      }
    }
    expect(bad, `static importers of campaign-install: ${bad.join(', ')}`).toEqual([]);
  });
});

/* ==========================================================================
 * 3b. THE OTHER STATIC IMPORT FORM, WHICH §0's PARSER CANNOT SEE
 *
 * `import.meta.glob(pattern, { eager: true })` is a static import of every file
 * it matches. §0's parser is exact for `import` and `export` — checked against
 * `typescript`'s own parse of all 259 files — and reads NO edge from a glob at
 * all. That gap is load-bearing in this directory rather than theoretical:
 * `src/campaign/index.ts` reaches every operation and every layout by exactly
 * this route, which is why nothing in `src/` names a layout or an operation by
 * path and why `isHeavy`'s `campaign/layouts/` and `campaign/operations/`
 * prefixes have nothing to match. `src/game/Systems.ts` — quoted at the top of
 * this file — is the other one, and it is why the entry chunk holds every
 * `*.system.ts` in the first place.
 *
 * MEASURED, NOT SUSPECTED. One line added to `campaign.system.ts`:
 *
 *     const LEAK = import.meta.glob('../campaign/operations/**\/*.ts',
 *                                   { eager: true });
 *
 * puts every operation in the entry chunk and left §1, §2 and §3 GREEN — all
 * twenty-two of them at the time. Only §4 saw it, and §4 is
 * `runIf(distIsCurrent())`, which skips for the whole of any session in which
 * somebody is editing `src/`. So the second import mechanism gets a rule of its
 * own, in source, where it is always checkable. The parsing moved to §0b once
 * the entry-chunk closure came to depend on it; the RULE is still here.
 * ========================================================================== */

/**
 * Every `import.meta.glob` in `src/`, keyed `<file> <pattern>`, with whether it
 * is eager and what it costs. Pinned for the same reason `DYNAMIC_IMPORTERS`
 * is: this is the one import form §0's parser cannot see, so a new one is
 * declared here rather than merged in silence.
 *
 * `eager` is checked against the source rather than taken on trust, because
 * §0c's closure follows the eager ones and nothing else in this file would
 * notice a detector that had stopped answering true.
 */
const DECLARED_GLOBS: Readonly<Record<string, { readonly eager: boolean; readonly why: string }>> = {
  'campaign/index.ts ./operations/**/*.ts': {
    eager: true,
    why: 'the operation table. Eager, but `index.ts` is reachable only through `campaign-install`, '
      + 'so the cost lands in the campaign chunk',
  },
  'campaign/index.ts ./layouts/*.ts': { eager: true, why: 'the layouts, same chunk and same reason' },
  'game/Scenarios.ts ../data/**/*.ts': {
    eager: false,
    why: 'NOT eager — a record of loaders, so it splits rather than inlines',
  },
  'game/Systems.ts ../**/*.system.ts': { eager: true, why: 'EAGER, and the premise of this entire file' },
  'shell/manual-corpus.ts ../../wiki/*.md': {
    eager: true,
    why: 'eager over the wiki, but `manual-corpus.ts` is itself behind a dynamic import — '
      + 'the ~320 kB manual chunk `tests/manual.spec.ts` gates',
  },
};

describe('import.meta.glob is fenced too, because the parser above is blind to it', () => {
  it('finds every glob in src/, so a new one cannot arrive unannounced', () => {
    const found = GLOB_SITES.map(({ file, pattern }) => `${rel(file)} ${pattern}`).sort();
    expect(
      found,
      'an `import.meta.glob` was added or removed. It is a STATIC import of every file it '
      + 'matches and no other test in this file can see one, so declare it in DECLARED_GLOBS '
      + 'with what it costs and which chunk pays.',
    ).toEqual(Object.keys(DECLARED_GLOBS).sort());
  });

  it('reads eagerness off the call, and the two answers are both present in the tree', () => {
    /*
     * THE FALSIFIER FOR §0c. `{ eager: true }` is what makes a glob a static
     * import, so a detector stuck on `false` shrinks the entry closure from 235
     * modules to 141 — no system modules in it at all — and every absence test
     * built on `ENTRY` goes quietly green. A detector stuck on `true` would pull
     * `data/**` in and is caught by the same table from the other side.
     *
     * `Scenarios.ts` is the only lazy glob in the tree and it is the control:
     * without it, "eager" could be a constant and this table would agree.
     */
    const wrong = GLOB_SITES
      .map(({ file, pattern, eager }) => ({ key: `${rel(file)} ${pattern}`, eager }))
      .filter(({ key, eager }) => DECLARED_GLOBS[key] !== undefined && DECLARED_GLOBS[key].eager !== eager)
      .map(({ key, eager }) => `${key} reads eager=${String(eager)}`);
    expect(wrong, `eagerness disagrees with DECLARED_GLOBS: ${wrong.join(', ')}`).toEqual([]);
    expect(GLOB_SITES.some(({ eager }) => eager)).toBe(true);
    expect(GLOB_SITES.some(({ eager }) => !eager)).toBe(true);
    // The options object sits two lines below the pattern in `campaign/index.ts`,
    // so a line-scoped read would answer false here.
    expect(globSites(join(SRC, 'campaign/index.ts')).map((g) => g.eager)).toEqual([true, true]);
    expect(globSites(join(SRC, 'game/Scenarios.ts')).map((g) => g.eager)).toEqual([false]);
  });

  it('reads a glob written inside a banner comment as prose, not as a site', () => {
    /*
     * FALSIFIER, and a natural one. `shell/tutorial.system.ts` quotes
     * `Systems.ts`'s own glob in its header to explain why it does not import
     * `Tutorial.ts`. A stripper that missed it would report a sixth site and
     * fail the pin above for a file that globs nothing.
     */
    const tutorial = join(SRC, 'shell/tutorial.system.ts');
    expect(SOURCE.get(tutorial)!).toContain('import.meta.glob(');
    expect(globPatterns(tutorial)).toEqual([]);
    // And it does read a real one, generic type argument and all.
    expect(globPatterns(join(SRC, 'campaign/index.ts')))
      .toEqual(['./operations/**/*.ts', './layouts/*.ts']);
    expect(globPatterns(join(SRC, 'game/Systems.ts'))).toEqual(['../**/*.system.ts']);
  });

  it('resolves a glob to the files it really pulls in, not to an empty set', () => {
    /*
     * THE FALSIFIER FOR THE RULE BELOW, which is an absence assertion over
     * `globMatches`. If the matcher answered `[]` — a separator slip on
     * Windows, a `**` that cannot span zero directories — the rule would pass
     * green forever while checking nothing. `Systems.ts` is the exact control:
     * its glob is the one whose answer is independently known, because §2
     * enumerated the same set by walking the tree.
     */
    // The wildcards themselves, because the tree cannot exercise all of them:
    // `/**\/` must span ZERO segments, and `*` must not cross one.
    expect(globToRegExp('/a/**/b.ts').test('/a/b.ts')).toBe(true);
    expect(globToRegExp('/a/**/b.ts').test('/a/x/y/b.ts')).toBe(true);
    expect(globToRegExp('/a/*.ts').test('/a/x/b.ts')).toBe(false);
    expect(globToRegExp('/a/*.ts').test('/a/b.ts')).toBe(true);
    expect(globMatches(join(SRC, 'game/Systems.ts'), '../**/*.system.ts').sort())
      .toEqual(SYSTEM_FILES.map(rel).sort());
    const ops = globMatches(join(SRC, 'campaign/index.ts'), './operations/**/*.ts');
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((id) => id.startsWith('campaign/operations/'))).toBe(true);
    const layouts = globMatches(join(SRC, 'campaign/index.ts'), './layouts/*.ts');
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts.every((id) => id.startsWith('campaign/layouts/'))).toBe(true);
  });

  it('lets no glob outside src/campaign reach a campaign file', () => {
    /*
     * The rule. A glob from `src/game/**` or `src/shell/**` that matches
     * campaign content is a static edge into whatever chunk holds the globbing
     * file, and from a `*.system.ts` that chunk is the entry chunk.
     *
     * `*.system.ts` is excluded because `Systems.ts` legitimately globs those
     * wherever they live: a `campaign/*.system.ts` would be a system module,
     * which is in the entry chunk by design and governed by §1 and §2 instead.
     * There are none today.
     */
    const bad: string[] = [];
    for (const { file, pattern } of GLOB_SITES) {
      if (rel(file).startsWith('campaign/')) continue;
      for (const id of globMatches(file, pattern)) {
        if (!id.startsWith('campaign/') || id.endsWith('.system.ts')) continue;
        bad.push(`${rel(file)} ${pattern} -> ${id}`);
      }
    }
    expect(
      bad,
      'campaign files pulled in by a glob written outside src/campaign. `{ eager: true }` makes '
      + `that a static import of every match: ${bad.join('; ')}`,
    ).toEqual([]);
  });
});

/* ==========================================================================
 * 4. THE MEASUREMENT, WHEN dist/ IS CURRENT
 * ========================================================================== */

const DIST = join(ROOT, 'dist', 'assets');

/**
 * Fingerprints: strings that survive minification and cannot appear by
 * accident. Symbol names cannot be used — everything the campaign exports is
 * renamed by the minifier — so these are ids, authored prose and the vocabulary
 * tables, all of which ship as string literals.
 *
 * EACH ONE IS CHECKED AGAINST THE SOURCE FIRST. A fingerprint that no longer
 * exists in `src/campaign/**` — a rewritten line of dialogue, a renamed
 * operation — fails the first test below rather than quietly certifying an
 * empty entry chunk, which is how an absence test rots.
 */
const FINGERPRINTS: readonly { readonly text: string; readonly why: string }[] = [
  { text: 'soviets.01.first-tap', why: 'the operation id' },
  { text: 'soviets-first-tap', why: 'the layout id' },
  { text: 'Hold the Seam', why: "the chapter title, from index.ts's CHAPTER_META" },
  { text: 'The survey says the seam runs under that town.', why: 'authored dialogue' },
  // REQUOTED 2026-08-19, and the requote is what this table is FOR. The old
  // string was 'Take the seam with all three derricks standing', and it was
  // renamed when `t.derricksLost` migrated to `ownerCount` — the trigger has
  // always tested OWNERSHIP while the title said STANDING, so a captured
  // derrick failed the objective with a line accusing the player of breaking
  // one they had taken intact. The first test below caught the drift on the
  // same run as the rename.
  { text: 'Take the seam and leave the town its three derricks', why: 'an objective title' },
  { text: 'elapsedSinceArmed', why: "a condition kind from types.ts's runtime vocabulary" },
  { text: 'capture-hold', why: "a primary type from types.ts's runtime vocabulary" },
];

/**
 * A STALE `dist/` MUST SKIP, NOT FAIL — the reasoning is
 * `tests/webgpu-bundle-isolation.spec.ts`'s and it is quoted rather than
 * re-derived: `npm test` does not build, so a red suite whose cause is which
 * build happens to be on disk breaks CLAUDE.md's "`npm test` has no known
 * flake". Freshness, not existence: the entry chunk must be newer than every
 * `.ts` under `src/`. §1–§3 are the gate and run unconditionally.
 */
function distIsCurrent(): boolean {
  if (!existsSync(DIST)) return false;
  const entry = readdirSync(DIST).find((f) => /^index-.*\.js$/.test(f));
  if (entry === undefined) return false;
  const built = statSync(join(DIST, entry)).mtimeMs;
  let newestSource = 0;
  for (const f of FILES) {
    const m = statSync(f).mtimeMs;
    if (m > newestSource) newestSource = m;
  }
  return built >= newestSource;
}

const haveDist = distIsCurrent();

describe('every fingerprint is a real string in the campaign source', () => {
  // Runs WITHOUT dist/. It is what stops §4 from being able to pass vacuously
  // on a typo, and it is cheap enough to check every time.
  const campaignSource = FILES
    .filter((f) => rel(f).startsWith('campaign/'))
    .map((f) => SOURCE.get(f)!)
    .join(NEWLINE);

  for (const { text, why } of FINGERPRINTS) {
    it(`still finds "${text}" — ${why}`, () => {
      expect(
        campaignSource.includes(text),
        `no campaign source file contains "${text}". It was renamed or rewritten; requote the `
        + 'fingerprint from the file it now lives in rather than deleting the entry.',
      ).toBe(true);
    });
  }
});

describe.runIf(haveDist)('the built entry chunk carries no campaign', () => {
  const chunks = haveDist ? readdirSync(DIST).filter((f) => f.endsWith('.js')) : [];
  const entry = chunks.find((f) => /^index-.*\.js$/.test(f));
  const read = (f: string): string => readFileSync(join(DIST, f), 'utf8');

  /**
   * The first-paint payload: the entry chunk plus every chunk it pulls in with
   * a STATIC edge, transitively. Today rollup gives the entry no static edges
   * at all — `Defs`, `Shell` and `gpu-path-install` are all `import()` — so the
   * closure is the entry alone. It is computed rather than assumed because a
   * chunking change that moved the campaign into a statically-imported shared
   * chunk would cost every player the same bytes while an entry-only scan went
   * on reporting clean.
   */
  const firstPaintClosure = (): string[] => {
    const seen = new Set<string>([entry!]);
    const stack = [entry!];
    const edge = /(?:from|import)["']\.\/([A-Za-z0-9_.-]+\.js)["']/g;
    while (stack.length > 0) {
      const f = stack.pop()!;
      for (const m of read(f).matchAll(edge)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        if (chunks.includes(m[1])) stack.push(m[1]);
      }
    }
    return [...seen];
  };

  it('emits the campaign as its own chunk', () => {
    expect(entry, 'no index-*.js in dist/assets — rebuild').toBeDefined();
    expect(
      chunks.find((f) => /^campaign-install-.*\.js$/.test(f)),
      'the campaign did not split into its own chunk — the dynamic boundary collapsed',
    ).toBeDefined();
  });

  it('is the right file, and it does hold the light seam', () => {
    /*
     * A CONTROL, so an absence result is a reading rather than a constant. If
     * the path were wrong or the read empty, everything below would pass.
     * `annihilationWin` is `policy.ts`'s SKIRMISH literal and it is SUPPOSED to
     * be in the entry chunk — `outcome.system.ts` imports `campaignRunning`
     * statically, which is the whole reason `policy.ts` imports nothing but a
     * type. Its presence is the boundary working, not leaking.
     */
    const src = read(entry!);
    expect(src.length).toBeGreaterThan(500_000);
    expect(src.includes('annihilationWin'), 'policy.ts is missing from the entry chunk').toBe(true);
  });

  it('carries no operation id, no authored line and no campaign vocabulary', () => {
    const payload = firstPaintClosure();
    const leaked: string[] = [];
    for (const f of payload) {
      const src = read(f);
      for (const { text } of FINGERPRINTS) if (src.includes(text)) leaked.push(`${text} in ${f}`);
    }
    expect(
      leaked,
      `the campaign reached the first-paint payload (${payload.join(', ')}): ${leaked.join('; ')}`,
    ).toEqual([]);
  });

  it('and some other chunk carries all of them — the non-vacuity half', () => {
    /*
     * WITHOUT THIS THE TEST ABOVE PASSES BY THE CAMPAIGN HAVING BEEN DELETED,
     * which is the failure mode of every absence assertion and the reason this
     * file exists in the shape it does. Each fingerprint has to be somewhere in
     * `dist/`, outside the first-paint payload.
     */
    const payload = new Set(firstPaintClosure());
    const lazy = chunks.filter((f) => !payload.has(f));
    expect(lazy.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const { text } of FINGERPRINTS) {
      if (!lazy.some((f) => read(f).includes(text))) missing.push(text);
    }
    expect(
      missing,
      `absent from the entry chunk AND from every lazy chunk: ${missing.join(', ')}. `
      + 'The campaign is not in the build at all, so the isolation above proves nothing.',
    ).toEqual([]);
  });

  it('puts them in the campaign chunk specifically, not scattered', () => {
    // One chunk, so the cost of opening the campaign is one fetch. If a
    // fingerprint turned up in the shell chunk instead, the boundary moved and
    // the main menu started paying for the operation table.
    const campaign = chunks.find((f) => /^campaign-install-.*\.js$/.test(f))!;
    const src = read(campaign);
    const elsewhere = FINGERPRINTS.filter(({ text }) => !src.includes(text)).map((f) => f.text);
    expect(elsewhere, `not in the campaign chunk: ${elsewhere.join(', ')}`).toEqual([]);
  });
});

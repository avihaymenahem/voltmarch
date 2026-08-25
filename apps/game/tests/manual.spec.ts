/**
 * ============================================================================
 * tests/manual.spec.ts — the in-game manual: not in the entry chunk, and whole
 * ============================================================================
 * Options -> Manual renders `wiki/*.md` — 17 pages, 306 kB — through
 * `src/shell/markdown.ts` and `src/shell/Manual.ts`. Two properties have to
 * hold, and neither is visible in a code review:
 *
 *   1. A PLAYER WHO NEVER OPENS IT NEVER DOWNLOADS IT. The corpus reaches the
 *      bundle through exactly one `await import('./manual-corpus')`. Statically
 *      importing that module would put 306 kB of prose into the 2.71 MB entry
 *      chunk that gates first paint for everyone. Nothing would fail; the game
 *      would simply get 11% heavier and no test would notice. This is the same
 *      discipline, and the same test shape, as
 *      `tests/webgpu-bundle-isolation.spec.ts`.
 *
 *   2. EVERY PAGE RENDERS, AND NOTHING IS SILENTLY LOST. A markdown subset
 *      renderer fails by DROPPING things — a table whose divider it did not
 *      recognise, a list item it swallowed into a paragraph — and the result
 *      still looks like a page. So §3 does not merely assert "it parsed": it
 *      re-extracts every word of four letters or more from the source and
 *      requires all of them to survive into the tree.
 *
 * §4 is the other half of the brief: the corpus keeps its GitHub-shaped links
 * and the reader adapts. `wiki/*.md` is not edited to suit the game, because
 * `tests/wiki-links.spec.ts` requires an absolute
 * `/avihaymenahem/voltmarch/wiki/<Page>` for GitHub's renderer and would break
 * if it were. That spec and `markdown.ts` therefore share a literal and a slug
 * rule, and this file compares both against it directly rather than trusting
 * that two files got the same string right twice.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  WIKI_LINK_PREFIX,
  parseInline,
  parseMarkdown,
  slugify,
  documentSections,
  documentTitle,
  inlineText,
  type Block,
  type Inline,
} from '../src/shell/markdown';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'apps/game/src');
const WIKI = join(ROOT, 'wiki');

const PAGES = readdirSync(WIKI).filter((f) => f.endsWith('.md')).sort();
const SLUGS = new Set(PAGES.map((f) => f.slice(0, -3)));
const SOURCE = new Map(PAGES.map((f) => [f.slice(0, -3), readFileSync(join(WIKI, f), 'utf8')]));
const PARSED = new Map([...SOURCE].map(([slug, src]) => [slug, parseMarkdown(src)]));

/* ==========================================================================
 * 1. THE SOURCE INVARIANT — one dynamic import, and nothing else
 * ========================================================================== */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const TS_FILES = walk(SRC);
const rel = (p: string): string => relative(SRC, p).split(sep).join('/');

describe('the manual corpus is behind one dynamic import', () => {
  it('is never imported statically, from anywhere in src/', () => {
    /*
     * The whole property in one assertion. A static import here does not fail
     * the build, does not warn, and does not change a single pixel — it just
     * moves 306 kB into the chunk every player downloads. Nothing else can
     * catch it.
     */
    const bad: string[] = [];
    for (const f of TS_FILES) {
      const src = readFileSync(f, 'utf8');
      if (/^\s*import\s[^;]*?\sfrom\s+['"][^'"]*manual-corpus['"]/m.test(src)) bad.push(rel(f));
    }
    expect(bad, `static importers of manual-corpus: ${bad.join(', ')}`).toEqual([]);
  });

  it('is reached by Manual.ts, by dynamic import, and memoised', () => {
    const src = readFileSync(join(SRC, 'shell/Manual.ts'), 'utf8');
    expect(src).toMatch(/import\(['"]\.\/manual-corpus['"]\)/);
    // Memoised, or every re-entry to the tab re-parses 306 kB.
    expect(src).toMatch(/pending/);
  });

  it('globs wiki/ from exactly one module', () => {
    const globbers = TS_FILES.filter((f) => /import\.meta\.glob\([^)]*wiki\//.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(globbers).toEqual(['shell/manual-corpus.ts']);
  });

  it('does not copy the wiki into public/ — there is one set of these files', () => {
    // A `public/` copy would also break the `file://` case that `base: './'`
    // exists for, and would be a second thing to keep in step. See
    // `manual-corpus.ts`.
    const pub = join(ROOT, 'apps/game/public');
    const copied = existsSync(join(pub, 'wiki'));
    expect(copied, 'wiki/ has been duplicated into public/').toBe(false);
  });
});

/* ==========================================================================
 * 2. THE MEASUREMENT, WHEN dist/ IS CURRENT
 *
 * Same rule as `webgpu-bundle-isolation.spec.ts` §4: a stale or absent `dist/`
 * SKIPS rather than fails. `npm test` does not build, and a test whose result
 * depends on which bundle happens to be on disk would break CLAUDE.md's "no
 * known flake" promise. The invariants above are the real gate; this is the
 * measurement, taken when it is available.
 *
 * Freshness here includes `wiki/**` as well as `src/**`, because the corpus is
 * an input to the build — a wiki edit after a build makes the phrases below
 * describe a chunk that no longer exists.
 * ========================================================================== */

const DIST = join(ROOT, 'apps/game/dist', 'assets');

function newestInput(): number {
  let newest = 0;
  for (const f of [...TS_FILES, ...PAGES.map((p) => join(WIKI, p))]) {
    const m = statSync(f).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

function distIsCurrent(): boolean {
  if (!existsSync(DIST)) return false;
  const entry = readdirSync(DIST).find((f) => /^index-.*\.js$/.test(f));
  if (entry === undefined) return false;
  return statSync(join(DIST, entry)).mtimeMs >= newestInput();
}

/**
 * A phrase from one page that is long enough to be unique to it and simple
 * enough to survive JavaScript string escaping verbatim: letters, spaces and a
 * comma only, so no quote, backslash or newline is involved.
 */
function fingerprint(markdown: string): string | null {
  let best = '';
  for (const m of markdown.matchAll(/[A-Za-z][A-Za-z, ]{44,}[A-Za-z]/g)) {
    if (m[0].length > best.length) best = m[0];
  }
  return best === '' ? null : best.trim();
}

const haveDist = distIsCurrent();

describe.runIf(haveDist)('the built entry chunk carries no manual', () => {
  const files = haveDist ? readdirSync(DIST).filter((f) => f.endsWith('.js')) : [];
  const entryName = files.find((f) => /^index-.*\.js$/.test(f));
  const entry = entryName === undefined ? '' : readFileSync(join(DIST, entryName), 'utf8');
  const others = files
    .filter((f) => f !== entryName)
    .map((f) => ({ name: f, text: readFileSync(join(DIST, f), 'utf8') }));

  it('emits the corpus as its own chunk', () => {
    expect(entryName, 'no index-*.js in dist/assets — rebuild').toBeDefined();
    const chunk = others.find((c) => /^manual-corpus-.*\.js$/.test(c.name));
    expect(chunk, `the manual did not split out. chunks: ${others.map((c) => c.name).join(', ')}`)
      .toBeDefined();
  });

  it('has no page of the wiki in the entry chunk', () => {
    const leaked: string[] = [];
    for (const [slug, src] of SOURCE) {
      const phrase = fingerprint(src);
      if (phrase === null) continue;
      if (entry.includes(phrase)) leaked.push(slug);
    }
    expect(leaked, `these wiki pages are in the entry chunk: ${leaked.join(', ')}`).toEqual([]);
  });

  it('and one other chunk carries every one of them — the non-vacuity half', () => {
    // Without this, the assertion above would pass just as happily if the
    // manual had been deleted. That is the failure mode of every absence test.
    const missing: string[] = [];
    for (const [slug, src] of SOURCE) {
      const phrase = fingerprint(src);
      if (phrase === null) continue;
      if (!others.some((c) => c.text.includes(phrase))) missing.push(slug);
    }
    expect(missing, `these wiki pages are in no chunk at all: ${missing.join(', ')}`).toEqual([]);
  });
});

/* ==========================================================================
 * 3. EVERY PAGE IS REACHABLE AND NOTHING IS DROPPED
 * ========================================================================== */

/** Every visible character the renderer would put on screen, per page. */
function renderedText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  const walkBlocks = (bs: readonly Block[]): void => {
    for (const b of bs) {
      switch (b.kind) {
        case 'heading': case 'para': parts.push(inlineText(b.children)); break;
        case 'list': for (const item of b.items) parts.push(inlineText(item)); break;
        case 'code': parts.push(b.text); break;
        case 'quote': walkBlocks(b.blocks); break;
        case 'table':
          for (const c of b.head) parts.push(inlineText(c));
          for (const r of b.rows) for (const c of r) parts.push(inlineText(c));
          break;
        default: break;
      }
    }
  };
  walkBlocks(blocks);
  return parts.join('\n');
}

describe('every wiki page parses into something a reader can use', () => {
  it('has a corpus to check at all', () => {
    // Guards the whole file against passing vacuously if `wiki/` moves.
    expect(PAGES.length).toBeGreaterThan(10);
    expect(SLUGS.has('Home')).toBe(true);
  });

  for (const slug of SLUGS) {
    describe(slug, () => {
      const blocks = PARSED.get(slug) as readonly Block[];

      it('has a title and real content', () => {
        expect(documentTitle(blocks), 'no level-1 heading').not.toBeNull();
        expect(blocks.length).toBeGreaterThan(5);
      });

      it('keeps every word of the source', () => {
        /*
         * THE DROPPED-CONTENT TEST, and the reason this file exists in the
         * shape it does. A subset parser fails by losing a block silently: an
         * unrecognised table divider turns twelve rows into twelve paragraphs
         * of pipes, a mis-scoped list swallows the paragraph after it. Both
         * still LOOK like a page.
         *
         * Link targets are stripped first — a URL is not visible text — and so
         * are the two backslash escapes, whose whole job is to not appear.
         */
        const src = (SOURCE.get(slug) as string)
          .replace(/\]\([^)\n]*\)/g, ']')
          .replace(/\\(.)/g, '$1');
        const rendered = renderedText(blocks);
        const lost: string[] = [];
        for (const m of src.matchAll(/[A-Za-z]{4,}/g)) {
          if (!rendered.includes(m[0])) lost.push(m[0]);
        }
        expect([...new Set(lost)].slice(0, 12), 'words that never reached the tree').toEqual([]);
      });

      it('emits no empty paragraph, list item or table row', () => {
        // The other way a line-oriented parser fails: it keeps the content and
        // adds furniture around it.
        const empties: string[] = [];
        const check = (bs: readonly Block[]): void => {
          for (const b of bs) {
            if (b.kind === 'para' && inlineText(b.children).trim() === '') empties.push('para');
            if (b.kind === 'list') {
              for (const i of b.items) if (inlineText(i).trim() === '') empties.push('list item');
              if (b.items.length === 0) empties.push('empty list');
            }
            if (b.kind === 'table' && b.head.length === 0) empties.push('headless table');
            if (b.kind === 'quote') check(b.blocks);
          }
        };
        check(blocks);
        expect(empties.slice(0, 6)).toEqual([]);
      });
    });
  }

  it('finds the tables, lists, quotes and code the corpus is known to contain', () => {
    /*
     * Non-vacuity for the whole of §3. Every assertion above would also pass on
     * a parser that turned all 17 files into one paragraph each — the words
     * would all be there. These counts were measured over the corpus on
     * 2026-08-18 and are floors, not equalities, so the third agent editing
     * `wiki/` cannot make this fail by writing more documentation.
     */
    let tables = 0;
    let lists = 0;
    let quotes = 0;
    let code = 0;
    let rules = 0;
    let headings = 0;
    const count = (bs: readonly Block[]): void => {
      for (const b of bs) {
        if (b.kind === 'table') tables++;
        if (b.kind === 'list') lists++;
        if (b.kind === 'code') code++;
        if (b.kind === 'rule') rules++;
        if (b.kind === 'heading') headings++;
        if (b.kind === 'quote') { quotes++; count(b.blocks); }
      }
    };
    for (const blocks of PARSED.values()) count(blocks);

    expect(tables, 'tables').toBeGreaterThanOrEqual(100);
    expect(lists, 'lists').toBeGreaterThanOrEqual(60);
    expect(quotes, 'blockquotes').toBeGreaterThanOrEqual(10);
    expect(code, 'fenced code blocks').toBeGreaterThanOrEqual(2);
    expect(rules, 'horizontal rules').toBeGreaterThanOrEqual(100);
    expect(headings, 'headings').toBeGreaterThanOrEqual(200);
  });

  it('gives every page a section list the rail can draw', () => {
    for (const [slug, blocks] of PARSED) {
      const sections = documentSections(blocks);
      // Home is short enough to have few; nothing may have none.
      expect(sections.length, `${slug} has no level-2 headings`).toBeGreaterThan(0);
      for (const s of sections) expect(s.slug, `${slug}: empty slug for "${s.text}"`).not.toBe('');
    }
  });
});

/* ==========================================================================
 * 4. LINKS ARE REWRITTEN, AND THE MARKDOWN IS NOT
 * ========================================================================== */

/** Every link in a tree, in document order. */
function allLinks(blocks: readonly Block[]): Extract<Inline, { kind: 'link' }>[] {
  const out: Extract<Inline, { kind: 'link' }>[] = [];
  const inlines = (nodes: readonly Inline[]): void => {
    for (const n of nodes) {
      if (n.kind === 'link') { out.push(n); inlines(n.children); }
      else if (n.kind === 'strong' || n.kind === 'em') inlines(n.children);
    }
  };
  const walkBlocks = (bs: readonly Block[]): void => {
    for (const b of bs) {
      switch (b.kind) {
        case 'heading': case 'para': inlines(b.children); break;
        case 'list': for (const i of b.items) inlines(i); break;
        case 'quote': walkBlocks(b.blocks); break;
        case 'table':
          for (const c of b.head) inlines(c);
          for (const r of b.rows) for (const c of r) inlines(c);
          break;
        default: break;
      }
    }
  };
  walkBlocks(blocks);
  return out;
}

describe('internal links become navigation, not dead hrefs', () => {
  it('agrees with wiki-links.spec.ts on the prefix, character for character', () => {
    /*
     * The coupling, checked rather than commented. `wiki-links.spec.ts` is what
     * forces the corpus into this shape for GitHub; `markdown.ts` is what turns
     * that shape back into in-game navigation. If one moved and the other did
     * not, every link in the manual would quietly become plain text.
     */
    const spec = readFileSync(join(ROOT, 'apps/game/tests/wiki-links.spec.ts'), 'utf8');
    const m = /const WIKI_PREFIX = '([^']+)'/.exec(spec);
    expect(m, 'wiki-links.spec.ts no longer declares WIKI_PREFIX this way').not.toBeNull();
    expect(WIKI_LINK_PREFIX).toBe(m?.[1]);
  });

  it('resolves every internal link to a page that is in the corpus', () => {
    const dangling: string[] = [];
    let internal = 0;
    for (const [slug, blocks] of PARSED) {
      for (const link of allLinks(blocks)) {
        if (link.target.kind !== 'page') continue;
        internal++;
        if (!SLUGS.has(link.target.page)) dangling.push(`${slug} -> ${link.target.page}`);
      }
    }
    expect(dangling).toEqual([]);
    // Non-vacuity: the corpus really does cross-link, and we really did find it.
    expect(internal, 'no internal links were classified at all').toBeGreaterThan(80);
  });

  it('classifies every same-page anchor onto a heading that exists there', () => {
    const missing: string[] = [];
    for (const [slug, blocks] of PARSED) {
      const heads = new Set<string>();
      const collect = (bs: readonly Block[]): void => {
        for (const b of bs) {
          if (b.kind === 'heading') heads.add(b.slug);
          if (b.kind === 'quote') collect(b.blocks);
        }
      };
      collect(blocks);
      for (const link of allLinks(blocks)) {
        if (link.target.kind === 'anchor' && !heads.has(link.target.anchor)) {
          missing.push(`${slug}#${link.target.anchor}`);
        }
        if (link.target.kind === 'page' && link.target.anchor !== '' && link.target.page === slug
            && !heads.has(link.target.anchor)) {
          missing.push(`${slug}#${link.target.anchor}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('leaves no link classified as plain — that would render as dead text', () => {
    const plain: string[] = [];
    for (const [slug, blocks] of PARSED) {
      for (const link of allLinks(blocks)) {
        if (link.target.kind === 'plain') plain.push(`${slug}: ${link.target.raw}`);
      }
    }
    expect(plain, 'a link the reader cannot follow').toEqual([]);
  });

  it('slugs a heading the way GitHub does, against an independent copy of the rule', () => {
    // THE LAST HAND-WRITTEN COPY OF THE SLUG RULE, AND IT IS KEPT ON PURPOSE.
    //
    // This used to be named after `tests/wiki-links.spec.ts` and described as
    // copied from it. That spec imports `slugify` now, so there is nothing left
    // to mirror — and if this test were rewritten to import it too, all three
    // consumers would agree with each other and nothing would be checking the
    // rule itself. An independent re-implementation is the only thing that
    // catches `slugify` being changed to something self-consistently wrong,
    // which is the one failure mode a single definition cannot see.
    //
    // If GitHub's rule ever changes, BOTH sides change and this test is where
    // the disagreement surfaces first.
    const independent = (h: string): string =>
      h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    let checked = 0;
    for (const src of SOURCE.values()) {
      for (const [, h] of src.matchAll(/^#{1,6}\s+(.+)$/gm)) {
        expect(slugify(h)).toBe(independent(h));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('routes an external link out of the game rather than into the reader', () => {
    // Nothing in the corpus is external today, so this is the unit, not a scan.
    const nodes = parseInline('[the repo](https://example.test/x)');
    expect(nodes[0].kind).toBe('link');
    expect(nodes[0].kind === 'link' ? nodes[0].target : null).toEqual({
      kind: 'external',
      url: 'https://example.test/x',
    });
  });
});

/* ==========================================================================
 * 5. THE PARSER, AT THE EDGES THE CORPUS ACTUALLY HAS
 * ========================================================================== */

describe('markdown subset', () => {
  it('reads a heading and its anchor', () => {
    const [b] = parseMarkdown('### The resource strip (top centre)');
    expect(b).toEqual({
      kind: 'heading',
      level: 3,
      text: 'The resource strip (top centre)',
      slug: 'the-resource-strip-top-centre',
      children: [{ kind: 'text', text: 'The resource strip (top centre)' }],
    });
  });

  it('joins wrapped lines into one paragraph', () => {
    // 295 lines of the corpus are continuations of the line above. Treating one
    // as an indented code block would shred every page.
    const [b] = parseMarkdown('Damage dealt is a product of\n  four separate numbers.');
    expect(b.kind).toBe('para');
    expect(b.kind === 'para' ? inlineText(b.children) : '')
      .toBe('Damage dealt is a product of four separate numbers.');
  });

  it('builds a table from a header, a divider and its rows', () => {
    const [b] = parseMarkdown('| Faction | Vehicle |\n| --- | --- |\n| Allied Forces | MCV |');
    expect(b.kind).toBe('table');
    if (b.kind !== 'table') return;
    expect(b.head.map(inlineText)).toEqual(['Faction', 'Vehicle']);
    expect(b.rows.map((r) => r.map(inlineText))).toEqual([['Allied Forces', 'MCV']]);
  });

  it('accepts the tight divider the corpus also uses', () => {
    const [b] = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(b.kind).toBe('table');
  });

  it('accepts alignment markers and drops the alignment', () => {
    // Not used anywhere in the corpus. Accepting the syntax means a table
    // written with it is still a table; see the header of markdown.ts.
    const [b] = parseMarkdown('| a | b |\n| :-- | --: |\n| 1 | 2 |');
    expect(b.kind).toBe('table');
  });

  it('does not mistake a rule for a table divider, or the reverse', () => {
    const blocks = parseMarkdown('text\n\n---\n\nmore');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'rule', 'para']);
  });

  it('keeps bullet and numbered runs apart', () => {
    const blocks = parseMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'list']);
    expect(blocks[0].kind === 'list' ? blocks[0].ordered : true).toBe(false);
    expect(blocks[1].kind === 'list' ? blocks[1].ordered : false).toBe(true);
  });

  it('folds a wrapped list item back into that item', () => {
    const [b] = parseMarkdown('- **Credits** — a rolling counter that travels\n  toward the balance.');
    expect(b.kind).toBe('list');
    expect(b.kind === 'list' ? b.items.length : 0).toBe(1);
    expect(b.kind === 'list' ? inlineText(b.items[0]) : '')
      .toBe('Credits — a rolling counter that travels toward the balance.');
  });

  it('re-parses a blockquote, so a quote can hold bold and its own breaks', () => {
    const [b] = parseMarkdown('> **There is no chain.**\n>\n> It is fully playable.');
    expect(b.kind).toBe('quote');
    if (b.kind !== 'quote') return;
    expect(b.blocks.map((x) => x.kind)).toEqual(['para', 'para']);
    expect(inlineText(b.blocks[0].kind === 'para' ? b.blocks[0].children : [])).toBe('There is no chain.');
  });

  it('takes a fenced block verbatim, spaces and all', () => {
    const [b] = parseMarkdown('```\n ┌────┐\n │ MAP│\n```');
    expect(b).toEqual({ kind: 'code', text: ' ┌────┐\n │ MAP│' });
  });

  it('does not read markdown inside a fence', () => {
    const [b] = parseMarkdown('```\n# not a heading\n- not a list\n```');
    expect(b.kind).toBe('code');
  });

  it('nests emphasis and links the way the corpus does', () => {
    const nodes = parseInline('**Small Arms** and *(see §6)*');
    expect(nodes.map((n) => n.kind)).toEqual(['strong', 'text', 'em']);
    expect(inlineText(nodes)).toBe('Small Arms and (see §6)');
  });

  it('leaves an unmatched asterisk as an asterisk', () => {
    expect(inlineText(parseInline('3 * 4 and a lone *'))).toBe('3 * 4 and a lone *');
    expect(parseInline('3 * 4').every((n) => n.kind === 'text')).toBe(true);
  });

  it('never italicises a SCREAMING_SNAKE identifier', () => {
    /*
     * The one omission from the subset that is a decision rather than an
     * accounting: `_underscore_` emphasis is not implemented. The corpus is
     * full of `VITE_RELAY_URL`, `NAVAL_MIN_SEA_CELLS`, `VM_REQUIRE_BUILD`, and
     * a parser that honoured it would put a phantom italic through the middle
     * of half of them.
     */
    const nodes = parseInline('Set VM_REQUIRE_BUILD and VITE_RELAY_URL before launch.');
    expect(nodes).toEqual([{ kind: 'text', text: 'Set VM_REQUIRE_BUILD and VITE_RELAY_URL before launch.' }]);
  });

  it('reads a code span before anything else — Controls.md documents a backtick', () => {
    // `wiki/Controls.md` renders the speed-cycle key as a code span whose only
    // content is a backslash. Any rule that ran before code spans would eat it.
    const nodes = parseInline('| `\\` | Cycle game speed |');
    expect(nodes[1]).toEqual({ kind: 'code', text: '\\' });
  });

  it('leaves a backslash before a space alone — Combat.md heads a column with one', () => {
    // `| Warhead \ Armour |`. A space is not punctuation, so this is a literal
    // backslash under CommonMark and must stay one here.
    expect(inlineText(parseInline('Warhead \\ Armour'))).toBe('Warhead \\ Armour');
    // And a real escape is consumed.
    expect(inlineText(parseInline('a \\* b'))).toBe('a * b');
    expect(parseInline('a \\* b').every((n) => n.kind === 'text')).toBe(true);
  });

  it('treats an angle-bracket placeholder as text, not as markup', () => {
    /*
     * `Base-Building.md` says `<Name> is your last way to build` inside an
     * italic run. The renderer builds DOM nodes and never a markup string, so
     * this cannot become an element — this pins that the parser does not try to
     * interpret it either.
     */
    const nodes = parseInline('*"<Name> is your last way to build"*');
    expect(nodes.length).toBe(1);
    expect(nodes[0].kind).toBe('em');
    expect(inlineText(nodes)).toBe('"<Name> is your last way to build"');
  });

  it('handles an empty document without inventing blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });

  it('terminates on an unclosed fence rather than looping', () => {
    const [b] = parseMarkdown('```\nnever closed');
    expect(b).toEqual({ kind: 'code', text: 'never closed' });
  });
});

/* ==========================================================================
 * 6. THE WIRING
 * ========================================================================== */

describe('the options screen offers it', () => {
  const SETTINGS = readFileSync(join(SRC, 'shell/Settings.ts'), 'utf8');

  it('carries a fifth tab, and renders it', () => {
    expect(SETTINGS).toMatch(/type TabId =[^;]*'manual'/);
    expect(SETTINGS).toMatch(/id: 'manual', label: 'Manual'/);
    expect(SETTINGS).toMatch(/case 'manual': this\.renderManual\(body\); break;/);
  });

  it('does not hand the Manual tab id to SettingsStore.reset', () => {
    /*
     * `reset` takes `keyof Omit<Settings, 'version'>`, and the settings-backed
     * tab ids happen to be exactly those keys — which is why the button could
     * pass `this.tab` straight through. `manual` is not one, so the guard is the
     * thing that keeps a content-only tab from being a type error and a crash.
     *
     * MATCHED LOOSELY BECAUSE THE GUARD GREW A SECOND TAB. `credits` joined it
     * when the credits moved off the main menu, and pinning the exact one-tab
     * spelling made this fail on a change that was the guard working rather
     * than breaking. What must hold is that `manual` is refused before the
     * `reset` call, not the shape of the condition around it.
     */
    expect(SETTINGS).toMatch(/if \(tab === 'manual'[^)]*\) return;/);
  });

  it('leaves the keybind reference alone — this is additive', () => {
    // `HelpPanel` is the live view of THIS machine's bindings. The manual is
    // seventeen static pages about the game. Folding one into the other would
    // bury the screen that answers "which key did I put Attack Move on".
    expect(SETTINGS).toMatch(/const help = button\('All Commands'/);
    expect(SETTINGS).toMatch(/this\.helpButton\.hidden = this\.tab !== 'controls'/);
    expect(SETTINGS).toMatch(/new HelpPanel\(/);
  });

  it('tears the view down when the tab changes and when the screen unmounts', () => {
    // A view left behind still holds a subtree and a promise callback.
    const disposals = SETTINGS.match(/this\.manual\?\.dispose\(\);/g) ?? [];
    expect(disposals.length).toBeGreaterThanOrEqual(2);
  });
});

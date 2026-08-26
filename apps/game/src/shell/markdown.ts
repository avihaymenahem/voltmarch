/**
 * ============================================================================
 * src/shell/markdown.ts — the markdown subset the in-game Manual reads
 * ============================================================================
 * `wiki/` is 19 pages and 345 KiB of hand-written markdown, published to the
 * GitHub wiki. The Manual tab in Options renders the SAME files, unmodified, so
 * there is exactly one copy of the player documentation and no second thing to
 * keep in step.
 *
 * WHY A PARSER AND NOT A DEPENDENCY
 * ---------------------------------
 * The project has one runtime dependency — `three` — and a stated ethos that
 * everything is generated from code. Pulling in a CommonMark implementation to
 * read seventeen files we wrote ourselves would be the largest dependency in
 * the product after the engine, and 95% of it would be for syntax the corpus
 * does not contain.
 *
 * THE SUBSET IS MEASURED, NOT GUESSED
 * -----------------------------------
 * Everything below was derived by scanning all 19 files rather than by
 * imagining what a wiki might use. Counts are from that scan (2026-08-18):
 *
 *   SUPPORTED, because the corpus uses it
 *     ATX headings `#`..`######`   255   (h1 17, h2 156, h3 82; no h4+ yet)
 *     tables                      across all 19 pages
 *     bullet lists                 286
 *     numbered lists                44
 *     bold `**x**`                 989
 *     italic `*x*`                 152
 *     inline code                   91
 *     fenced code blocks             2
 *     blockquotes                  116
 *     horizontal rules             120   (always `---`)
 *     links                        106   (all internal; see LINK REWRITING)
 *     backslash escapes              2
 *
 *   DELIBERATELY ABSENT, because the corpus contains ZERO of each
 *     images, autolinks (`<https://…>`), raw HTML, reference links,
 *     strikethrough, task lists, footnotes, setext headings (`===` under a
 *     line), nested lists (every list marker in the corpus is at indent 0),
 *     4-space indented code blocks, and `_underscore_` emphasis.
 *
 * `_underscore_` is the one omission that is a decision rather than an
 * accounting. The corpus is full of `SCREAMING_SNAKE` identifiers —
 * `VITE_RELAY_URL`, `NAVAL_MIN_SEA_CELLS`, `VM_REQUIRE_BUILD` — and a parser
 * that honoured underscore emphasis would render half of them with a phantom
 * italic in the middle. GitHub gets away with it via intraword rules that are
 * fiddly to reproduce; not implementing the syntax at all is simpler and, for
 * this corpus, produces identical output.
 *
 * Table alignment markers (`:---`, `---:`, `:-:`) are ACCEPTED so a table
 * written with them still parses, and then ignored — the corpus uses plain
 * `---` in all 19 files, and a column that silently right-aligns is a smaller
 * surprise than a table that fails to be a table.
 *
 * IT EMITS AN AST, NOT HTML, AND THAT IS THE ESCAPING STORY
 * --------------------------------------------------------
 * Nothing here produces a string of markup, so nothing downstream can be asked
 * to interpolate one. `Manual.ts` walks these nodes with `createElement` and
 * `createTextNode`; there is no `innerHTML` on the path at all. The corpus is
 * ours today, but `Base-Building.md` already contains the literal text
 * `<Name> is your last way to build` inside an italic run, and a renderer whose
 * safety depends on who wrote the input is a renderer that is one contribution
 * away from being wrong.
 *
 * LINK REWRITING — AND WHY THE MARKDOWN MUST NOT BE "FIXED"
 * --------------------------------------------------------
 * Every internal link in the corpus is an ABSOLUTE
 * `/avihaymenahem/voltmarch/wiki/<Page>`. That form is not a style choice:
 * `tests/wiki-links.spec.ts` requires it, because GitHub's wiki renderer
 * resolves a bare `[x](Economy)` relative to the current URL and silently
 * re-serves the front page from `/wiki/Home`. In the game those hrefs address
 * nothing, so they are CLASSIFIED HERE into `{ kind: 'page' }` targets that the
 * Manual turns into internal navigation. The files are never edited to suit the
 * game; the reader adapts to the files.
 *
 * `WIKI_LINK_PREFIX` is therefore load-bearing in two places at once, and
 * `tests/manual.spec.ts` compares it against the literal in `wiki-links.spec`
 * so the two cannot drift apart in silence.
 *
 * **`slugify` IS the heading-slug rule; it no longer reproduces one.** This
 * paragraph used to read the other way round, and pointed at a copy in
 * `tests/wiki-links.spec.ts` that has since been deleted — that spec imports
 * this function now, so there is one definition and the wiki gate and the
 * in-game manual cannot disagree about where an anchor lands. The property
 * that mattered is unchanged: an anchor which scrolls nowhere in the game
 * while passing the wiki gate is a defect only a player finds.
 *
 * ONE HAND-WRITTEN COPY SURVIVES, in `tests/manual.spec.ts`'s "slugs a heading
 * exactly the way wiki-links.spec.ts does", and its comment names a literal
 * that is no longer there. It is kept deliberately: a test that re-implements
 * the rule is the only thing that can catch this function being changed to
 * something self-consistently wrong. **Its name and comment should say that,
 * rather than naming a file it no longer mirrors.**
 * ============================================================================
 */

/** The absolute prefix every internal wiki link carries. */
export const WIKI_LINK_PREFIX = '/avihaymenahem/voltmarch/wiki/';

/* ==========================================================================
 * 1. THE TREE
 * ========================================================================== */

export type LinkTarget =
  /** Another wiki page. `anchor` is '' when the link has no fragment. */
  | { readonly kind: 'page'; readonly page: string; readonly anchor: string }
  /** A heading on the page being read. */
  | { readonly kind: 'anchor'; readonly anchor: string }
  /** `https:`, `http:` or `mailto:` — opens outside the game. */
  | { readonly kind: 'external'; readonly url: string }
  /**
   * Anything else. Rendered as plain text rather than as a link that goes
   * nowhere. `wiki-links.spec.ts` forbids the only form this can take today (a
   * bare relative page name), so reaching this is a sign the corpus changed.
   */
  | { readonly kind: 'plain'; readonly raw: string };

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly target: LinkTarget; readonly children: readonly Inline[] };

export type Block =
  | {
      readonly kind: 'heading';
      readonly level: number;
      /** The raw heading text, which is what `slug` is computed from. */
      readonly text: string;
      readonly slug: string;
      readonly children: readonly Inline[];
    }
  | { readonly kind: 'para'; readonly children: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | {
      readonly kind: 'table';
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly kind: 'rule' };

/* ==========================================================================
 * 2. SLUGS
 * ========================================================================== */

/**
 * GitHub's heading slug, to the letter of `tests/wiki-links.spec.ts`.
 *
 * lowercase, drop anything that is not a word character / space / hyphen, then
 * spaces to hyphens. Deliberately NOT "close enough but improved": the point is
 * that an anchor the wiki gate has already validated resolves here too.
 */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

/* ==========================================================================
 * 3. INLINE
 * ========================================================================== */

/**
 * ASCII punctuation, i.e. the characters a backslash may escape.
 *
 * A backslash before anything else — including a space — is a literal
 * backslash, which is CommonMark's rule and is what makes `| Warhead \ Armour |`
 * in `Combat.md` render the way its author intended.
 */
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|<>~"\'/:;=&$@%^,?'.split(''));

/**
 * Emphasis and links may nest (`**[Page](…)**`, `*(see §6)*`), but nothing in
 * the corpus goes past two levels. The cap is a stop against a pathological
 * input rather than a feature limit.
 */
const MAX_INLINE_DEPTH = 6;

const LINK_RE = /^\[([^\]\n]*)\]\(([^)\n]*)\)/;

/** Split a link target into its page part and its fragment. */
export function classifyTarget(raw: string): LinkTarget {
  const hash = raw.indexOf('#');
  const base = hash < 0 ? raw : raw.slice(0, hash);
  const anchor = hash < 0 ? '' : raw.slice(hash + 1);

  if (base === '') {
    return anchor === '' ? { kind: 'plain', raw } : { kind: 'anchor', anchor };
  }
  if (base.startsWith(WIKI_LINK_PREFIX)) {
    return { kind: 'page', page: base.slice(WIKI_LINK_PREFIX.length), anchor };
  }
  if (/^(https?:|mailto:)/i.test(base)) return { kind: 'external', url: raw };
  return { kind: 'plain', raw };
}

/**
 * Find the delimiter run that closes an emphasis span opened at `from`.
 *
 * Returns the index of the closer, or -1 when there is none — in which case the
 * asterisk is literal text, which is the behaviour a reader expects from a
 * stray `*`. Two rules keep it honest: a run cannot open on whitespace and
 * cannot close on it, and a single `*` never closes on half of a `**`.
 */
function closingRun(src: string, from: number, mark: string): number {
  if (from >= src.length || /\s/.test(src[from])) return -1;
  let i = from;
  while (i < src.length) {
    const at = src.indexOf(mark, i);
    if (at < 0) return -1;
    if (mark === '*' && src[at + 1] === '*') { i = at + 2; continue; }
    if (at === from) return -1;
    if (/\s/.test(src[at - 1])) { i = at + mark.length; continue; }
    return at;
  }
  return -1;
}

function scanInline(src: string, depth: number): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') { out.push({ kind: 'text', text }); text = ''; }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '\\' && i + 1 < src.length && ESCAPABLE.has(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    // CODE FIRST, ALWAYS. `Controls.md` documents the speed-cycle key as a
    // backtick inside a code span, and every other rule has to keep its hands
    // off the contents of one.
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (c === '[' && depth < MAX_INLINE_DEPTH) {
      const m = LINK_RE.exec(src.slice(i));
      if (m !== null) {
        flush();
        out.push({
          kind: 'link',
          target: classifyTarget(m[2].trim()),
          children: scanInline(m[1], depth + 1),
        });
        i += m[0].length;
        continue;
      }
    }

    if (c === '*' && depth < MAX_INLINE_DEPTH) {
      const mark = src.startsWith('**', i) ? '**' : '*';
      const end = closingRun(src, i + mark.length, mark);
      if (end >= 0) {
        flush();
        out.push({
          kind: mark === '**' ? 'strong' : 'em',
          children: scanInline(src.slice(i + mark.length, end), depth + 1),
        });
        i = end + mark.length;
        continue;
      }
    }

    text += c;
    i++;
  }

  flush();
  return out;
}

/** Parse one run of inline markdown. Exported for tests. */
export function parseInline(src: string): Inline[] {
  return scanInline(src, 0);
}

/** Flatten a tree back to its visible text. Used for search and for tests. */
export function inlineText(nodes: readonly Inline[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text' || n.kind === 'code') out += n.text;
    else out += inlineText(n.children);
  }
  return out;
}

/* ==========================================================================
 * 4. BLOCKS
 * ========================================================================== */

/**
 * `^#{1,6}\s+(.+)$` — CHARACTER FOR CHARACTER the pattern `wiki-links.spec.ts`
 * harvests heading text with, and it must stay that way. Trailing `#` closers
 * are deliberately NOT stripped: the spec does not strip them either, so
 * stripping here would slug `## Foo ##` as `foo` while the gate that validated
 * the corpus's anchors slugged it `foo-`. There are none in the corpus; the
 * point is that there cannot be a divergence if one appears.
 */
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;

/** `| a | b |` -> `['a', 'b']`, with the outer pipes dropped. */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * True for the `| --- | --- |` row under a table header.
 *
 * `:---` / `---:` / `:-:` are accepted so a table written with alignment still
 * parses; the alignment itself is dropped. See the header.
 */
function isTableDivider(line: string | undefined): boolean {
  if (line === undefined || !/^\s*\|/.test(line)) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** True when `line` begins a block, i.e. cannot be swallowed by a paragraph. */
function startsBlock(line: string, next: string | undefined): boolean {
  if (line.trim() === '') return true;
  if (HEADING_RE.test(line)) return true;
  if (RULE_RE.test(line)) return true;
  if (FENCE_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (LIST_RE.test(line)) return true;
  if (/^\s*\|/.test(line) && isTableDivider(next)) return true;
  return false;
}

/**
 * Parse a document into blocks.
 *
 * Line-oriented, single pass, no backtracking. Indented continuation lines are
 * joined onto whatever paragraph or list item they follow, which is how the
 * corpus wraps at 100 columns — 295 lines in it are continuations, and treating
 * them as anything else (a nested list, an indented code block) would shred
 * every page.
 */
export function parseMarkdown(src: string): Block[] {
  return parseLines(src.replace(/\r\n?/g, '\n').split('\n'));
}

function parseLines(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    /* -- fenced code ---------------------------------------------------- */
    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      const marker = fence[1][0];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_RE.exec(lines[i]);
        if (close !== null && close[1][0] === marker) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    /* -- heading -------------------------------------------------------- */
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const text = heading[2];
      out.push({
        kind: 'heading',
        level: heading[1].length,
        text,
        slug: slugify(text),
        children: scanInline(text, 0),
      });
      i++;
      continue;
    }

    /* -- horizontal rule ------------------------------------------------ */
    if (RULE_RE.test(line)) {
      out.push({ kind: 'rule' });
      i++;
      continue;
    }

    /* -- blockquote ------------------------------------------------------ *
     * Gathered whole and re-parsed, so a quote can hold bold, lists and its
     * own paragraph breaks — `Campaign.md` has one with four of each.        */
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]);
        if (m === null) break;
        inner.push(m[1]);
        i++;
      }
      out.push({ kind: 'quote', blocks: parseLines(inner) });
      continue;
    }

    /* -- table ----------------------------------------------------------- */
    if (/^\s*\|/.test(line) && isTableDivider(lines[i + 1])) {
      const head = tableCells(line).map((c) => scanInline(c, 0));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(tableCells(lines[i]).map((c) => scanInline(c, 0)));
        i++;
      }
      out.push({ kind: 'table', head, rows });
      continue;
    }

    /* -- list ------------------------------------------------------------ */
    const first = LIST_RE.exec(line);
    if (first !== null) {
      const ordered = /\d/.test(first[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m !== null) {
          // A marker of the other kind starts a new list rather than joining
          // this one — an ordered run under a bulleted one is two lists.
          if (items.length > 0 && /\d/.test(m[2]) !== ordered) break;
          items.push(m[3]);
          i++;
          continue;
        }
        if (lines[i].trim() === '' || !/^\s+\S/.test(lines[i])) break;
        items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push({ kind: 'list', ordered, items: items.map((t) => scanInline(t, 0)) });
      continue;
    }

    /* -- paragraph -------------------------------------------------------- */
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ kind: 'para', children: scanInline(para.join(' '), 0) });
  }

  return out;
}

/* ==========================================================================
 * 5. PAGE SUMMARY
 * ========================================================================== */

/**
 * The page's own title — its first `#` heading — or null when it has none.
 *
 * Read off the parsed tree rather than by a second regex over the source, so
 * the Manual's rail and its content pane can never disagree about what a page
 * is called.
 */
export function documentTitle(blocks: readonly Block[]): string | null {
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === 1) return inlineText(b.children);
  }
  return null;
}

/** Every `##` heading, in order — the "on this page" list. */
export function documentSections(blocks: readonly Block[]): { text: string; slug: string }[] {
  const out: { text: string; slug: string }[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === 2) out.push({ text: inlineText(b.children), slug: b.slug });
  }
  return out;
}

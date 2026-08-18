/**
 * ============================================================================
 * tests/wiki-links.spec.ts — the player wiki's internal links must resolve
 * ============================================================================
 * Every internal link on the wiki's FRONT PAGE was dead, and the markup was
 * correct. GitHub's wiki renderer rewrites a bare page-name link — `[x](Economy)`
 * — into a RELATIVE href, and computes it as though the front page lived at
 * `/wiki`. That holds when you arrive at `/wiki`, and fails at `/wiki/Home`,
 * where the emitted `wiki/Economy` resolves to `/wiki/wiki/Economy`. GitHub does
 * not 404 that: it silently serves the front page again. So the links did not
 * look broken, they looked inert, which is why they shipped.
 *
 * Measured before the fix, resolving all 142 body links across all 17 live
 * pages: 15 distinct broken targets, every one of them on Home. Measured after:
 * 448 links resolved from every URL GitHub serves each page at, 0 broken.
 *
 * THE `.md` SUFFIX IS NOT THE FIX, and that was tested rather than reasoned
 * about. With `.md` in the source GitHub still emits `wiki/Economy.md`
 * relatively on the front page — the failure is unchanged — and on a subpage it
 * emits `Economy.md`, which resolves to `/wiki/Economy.md`, a page that does not
 * exist. It would have left Home broken and broken the 127 links that worked.
 *
 * An absolute path is resolved against nothing, so it is correct from every URL.
 * It is also the form GitHub's own wiki sidebar emits.
 *
 * WHY A TEST AND NOT JUST A FIX. Same reasoning as `credits-truthful.spec.ts`:
 * the failure was invisible from inside the repo. The markdown reads perfectly;
 * you only find it by resolving hrefs against a live URL. Nothing in a code
 * review of `wiki/*.md` would ever catch the reintroduction, so a reviewer
 * noticing is not the mechanism. This checks the SHAPE, offline, in CI.
 *
 * It also catches the other half — a link to a page nobody wrote. That target
 * renders as an ordinary link and leads to GitHub's "create this page" stub,
 * which for a reader is indistinguishable from the wiki being broken.
 *
 * AND THE THIRD HALF: A FRAGMENT THAT SCROLLS NOWHERE
 * --------------------------------------------------
 * `/…/wiki/Economy#ore-regrowth` is TWO claims — that `Economy.md` exists, and
 * that it carries a heading GitHub slugs as `ore-regrowth`. Only the first was
 * checked for cross-page links, on both sides: this file resolved the page and
 * threw the fragment away, and `tests/manual.spec.ts` resolves an anchor only
 * when it points at the page the reader is already on. So a heading that got
 * reworded took every OTHER page's deep link with it, in silence — GitHub
 * serves the page and simply does not scroll, which reads as a link that "did
 * nothing" rather than as a broken one. That is the same failure mode as the
 * original defect this file was written for, one level down.
 *
 * THE SLUG RULE IS IMPORTED, NOT RESTATED
 * ---------------------------------------
 * `slugify` comes from `src/shell/markdown.ts` — the parser the in-game Manual
 * reads these same files with. It used to be a private copy here and the game
 * copied it back, which is two copies of one rule and exactly the drift
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues: an anchor validated under one spelling
 * and resolved under another is a defect only a player finds. There is now ONE
 * definition, in the shipped module, and this gate is one of its callers.
 *
 * (`WIKI_PREFIX` stays a LITERAL here rather than an import of
 * `markdown.ts#WIKI_LINK_PREFIX`, because `tests/manual.spec.ts` reads this
 * file as text and greps that declaration out of it to prove the two agree
 * character for character. Importing it would make that check compare a value
 * with itself.)
 * ============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { slugify } from '../src/shell/markdown';

const WIKI = join(import.meta.dirname, '..', 'wiki');

/** The absolute form every internal link must take. */
const WIKI_PREFIX = '/avihaymenahem/voltmarch/wiki/';

const files = readdirSync(WIKI).filter((f) => f.endsWith('.md')).sort();
const pages = new Set(files.map((f) => f.slice(0, -3)));

/** Every page's source, read once. Keyed by file name (`Economy.md`). */
const SOURCE: ReadonlyMap<string, string> = new Map(
  files.map((f) => [f, readFileSync(join(WIKI, f), 'utf8')]),
);

/**
 * Fenced code blocks are gone before anything else looks at the text. A shell
 * snippet or a chunk of markdown quoted as an EXAMPLE is neither a link nor a
 * heading, and matching one would make this gate fire on documentation about
 * itself. Split out from `prose` because the heading scan must NOT also strip
 * inline code — `## The `ctx()` seam` slugs off the whole heading text, and
 * removing the code span first would slug it as if the words were not there.
 */
function withoutFences(src: string): string {
  return src.replace(/```[\s\S]*?```/g, '');
}

function prose(src: string): string {
  return withoutFences(src).replace(/`[^`\n]*`/g, '');
}

/** Every `](target)` in the file, with its fragment split off. */
function links(src: string): { raw: string; target: string; frag: string }[] {
  const out: { raw: string; target: string; frag: string }[] = [];
  for (const m of prose(src).matchAll(/\]\(([^)\s]*?)(#[^)\s]*)?\)/g)) {
    out.push({ raw: m[0], target: m[1] ?? '', frag: m[2] ?? '' });
  }
  return out;
}

/**
 * The anchors one page offers, by page NAME (`Economy`, not `Economy.md`).
 *
 * The heading pattern is `^#{1,6}\s+(.+)$`, which `markdown.ts` records as
 * being character-for-character this one; the slug itself is that module's
 * `slugify`. Computed for every page up front so a cross-page fragment is
 * resolved against the same table a same-page one is.
 */
const ANCHORS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  files.map((f) => [
    f.slice(0, -3),
    new Set(
      [...withoutFences(SOURCE.get(f)!).matchAll(/^#{1,6}\s+(.+)$/gm)]
        .map(([, h]) => slugify(h)),
    ) as ReadonlySet<string>,
  ]),
);

describe('the player wiki links to pages that exist', () => {
  it('has pages to check at all', () => {
    // Guards the whole file against passing vacuously if `wiki/` moves.
    expect(files.length).toBeGreaterThan(10);
  });

  it('never uses a bare relative page name — the form GitHub breaks on Home', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const { raw, target } of links(readFileSync(join(WIKI, f), 'utf8'))) {
        if (target === '') continue;                       // same-page anchor
        if (/^(https?:|mailto:)/.test(target)) continue;   // external
        if (target.startsWith('/')) continue;              // absolute — the correct form
        offenders.push(`${f}: ${raw}`);
      }
    }
    expect(
      offenders,
      'A bare relative link renders as a relative href, which GitHub resolves '
      + `against the current URL. On /wiki/Home that yields /wiki/wiki/<Page>, `
      + `which silently serves the front page. Use ${WIKI_PREFIX}<Page> instead.`
      + `\n  ${offenders.slice(0, 8).join('\n  ')}`,
    ).toEqual([]);
  });

  it('points every internal link at a page file that is actually here', () => {
    const dangling: string[] = [];
    for (const f of files) {
      for (const { raw, target } of links(readFileSync(join(WIKI, f), 'utf8'))) {
        if (!target.startsWith(WIKI_PREFIX)) continue;
        const page = target.slice(WIKI_PREFIX.length);
        if (!pages.has(page)) dangling.push(`${f}: ${raw}`);
      }
    }
    expect(
      dangling,
      'These link to wiki pages that do not exist. GitHub renders them as '
      + 'ordinary links to a "create this page" stub, which a reader cannot tell '
      + `apart from a broken wiki.\n  ${dangling.slice(0, 8).join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not carry the .md suffix, which resolves to a non-page', () => {
    const suffixed: string[] = [];
    for (const f of files) {
      for (const { raw, target } of links(readFileSync(join(WIKI, f), 'utf8'))) {
        if (target.startsWith(WIKI_PREFIX) && target.endsWith('.md')) suffixed.push(`${f}: ${raw}`);
      }
    }
    expect(
      suffixed,
      '/wiki/<Page>.md is not a page — GitHub serves a "create this page" stub. '
      + `The page name alone is the address.\n  ${suffixed.slice(0, 8).join('\n  ')}`,
    ).toEqual([]);
  });

  it('harvested a heading from every page, so the anchor tables are not empty', () => {
    /*
     * The vacuity guard for BOTH fragment tests below. `ANCHORS` is what they
     * resolve against; a heading scan that silently matched nothing would make
     * every fragment resolve to an empty set — which fails loudly — but a scan
     * that matched nothing on ONE page while the fragments pointed elsewhere
     * would pass while checking less than it claims.
     */
    const empty = [...ANCHORS].filter(([, s]) => s.size === 0).map(([p]) => p);
    expect(empty, 'these pages yielded no headings at all, so the heading pattern '
      + `stopped matching: ${empty.join(', ')}`).toEqual([]);
    const total = [...ANCHORS.values()].reduce((n, s) => n + s.size, 0);
    expect(total, 'the whole corpus yielded suspiciously few headings — `markdown.ts` '
      + 'counted 255 of them when the parser was written').toBeGreaterThanOrEqual(200);
  });

  it('resolves a same-page anchor to a heading that exists on that page', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of files) {
      const slugs = ANCHORS.get(f.slice(0, -3))!;
      for (const { raw, target, frag } of links(SOURCE.get(f)!)) {
        if (target !== '' || frag === '') continue;        // only same-page anchors
        checked++;
        if (!slugs.has(frag.slice(1))) missing.push(`${f}: ${raw}`);
      }
    }
    expect(checked, 'the corpus has always carried same-page anchors; parsing none of '
      + 'them means the link pattern stopped matching, not that the wiki is clean')
      .toBeGreaterThanOrEqual(3);
    expect(
      missing,
      `A same-page anchor with no matching heading scrolls nowhere.\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('resolves a CROSS-PAGE fragment to a heading on the page it names', () => {
    /*
     * `/…/wiki/Units-and-Verbs#superweapons` is only half-checked by the page
     * test above: GitHub serves `Units-and-Verbs` whether or not that heading
     * is still called that, and simply does not scroll. Nothing anywhere was
     * looking at the other half — `manual.spec.ts` resolves an anchor only when
     * the link points at the page being read.
     */
    const missing: string[] = [];
    let checked = 0;
    for (const f of files) {
      for (const { raw, target, frag } of links(SOURCE.get(f)!)) {
        if (!target.startsWith(WIKI_PREFIX) || frag === '') continue;
        checked++;
        const page = target.slice(WIKI_PREFIX.length);
        const anchor = frag.slice(1);
        if (anchor === '') {
          missing.push(`${f}: ${raw} — the fragment is a bare "#"`);
          continue;
        }
        const slugs = ANCHORS.get(page);
        if (slugs === undefined) {
          // The page test reports this too; recording it here as well is
          // deliberate, because skipping it is how a parser goes quiet.
          missing.push(`${f}: ${raw} — there is no ${page}.md to hold that heading`);
          continue;
        }
        if (!slugs.has(anchor)) {
          missing.push(`${f}: ${raw} — ${page}.md has no heading that slugs as "${anchor}"`);
        }
      }
    }
    expect(checked, 'no cross-page fragments were examined at all. The corpus has carried '
      + 'ten of them since the deep links landed, so this is a broken parser rather than a '
      + 'wiki with no deep links.').toBeGreaterThanOrEqual(8);
    expect(
      missing,
      'A cross-page fragment naming a heading that is not there does NOT 404 — GitHub '
      + 'serves the page and leaves the reader at the top, which reads as a link that did '
      + `nothing.\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('examined the whole corpus of links, not a subset of it', () => {
    // The outermost non-vacuity guard: every test above walks `links()`, and if
    // that pattern stops matching they all pass by checking nothing.
    let total = 0;
    let internal = 0;
    let fragments = 0;
    for (const f of files) {
      for (const { target, frag } of links(SOURCE.get(f)!)) {
        total++;
        if (target.startsWith(WIKI_PREFIX)) internal++;
        if (frag !== '') fragments++;
      }
    }
    expect(total, 'the wiki has carried 150+ links since it was written').toBeGreaterThanOrEqual(120);
    expect(internal, 'almost every link in the corpus is an internal wiki link')
      .toBeGreaterThanOrEqual(100);
    expect(fragments, 'links carrying a #fragment, same-page and cross-page together')
      .toBeGreaterThanOrEqual(11);
  });
});

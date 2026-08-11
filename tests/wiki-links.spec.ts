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
 * ============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WIKI = join(import.meta.dirname, '..', 'wiki');

/** The absolute form every internal link must take. */
const WIKI_PREFIX = '/avihaymenahem/voltmarch/wiki/';

const files = readdirSync(WIKI).filter((f) => f.endsWith('.md')).sort();
const pages = new Set(files.map((f) => f.slice(0, -3)));

/**
 * Fenced code blocks are stripped before scanning. A shell snippet or a chunk of
 * markdown quoted as an EXAMPLE is not a link, and matching one would make this
 * gate fire on documentation about itself.
 */
function prose(src: string): string {
  return src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Every `](target)` in the file, with its fragment split off. */
function links(src: string): { raw: string; target: string; frag: string }[] {
  const out: { raw: string; target: string; frag: string }[] = [];
  for (const m of prose(src).matchAll(/\]\(([^)\s]*?)(#[^)\s]*)?\)/g)) {
    out.push({ raw: m[0], target: m[1] ?? '', frag: m[2] ?? '' });
  }
  return out;
}

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

  it('resolves a same-page anchor to a heading that exists on that page', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(WIKI, f), 'utf8');
      // GitHub's slug: lowercase, strip anything that is not a word char, space
      // or hyphen, then spaces to hyphens. Close enough to catch a real typo.
      const slugs = new Set(
        [...src.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, h]) =>
          h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')),
      );
      for (const { raw, target, frag } of links(src)) {
        if (target !== '' || frag === '') continue;        // only same-page anchors
        if (!slugs.has(frag.slice(1))) missing.push(`${f}: ${raw}`);
      }
    }
    expect(
      missing,
      `A same-page anchor with no matching heading scrolls nowhere.\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});

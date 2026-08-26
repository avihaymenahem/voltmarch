/**
 * ============================================================================
 * src/shell/Manual.ts — the player wiki, in the game, from the same files
 * ============================================================================
 * Options -> Manual. Nineteen pages, a rail on the left, the rendered page on
 * the right, and internal links that navigate instead of pointing at github.com.
 *
 * WHAT MAKES IT WORTH HAVING
 * --------------------------
 * The documentation existed and was good; it was 345 KiB of markdown that a
 * player could only read by leaving the game, in a browser tab, on a site that
 * needs a network. It is now reachable from the title screen AND from the pause
 * menu's Options, over a frozen frame, mid-match — which is when somebody
 * actually wants to know what a warhead multiplier is.
 *
 * ONE COPY OF THE TEXT. `wiki/*.md` is read verbatim. Nothing is duplicated
 * into `src/`, nothing is copied into `public/`, and — this is the part worth
 * defending — the markdown is NEVER edited to suit this reader. Its internal
 * links are absolute `/avihaymenahem/voltmarch/wiki/<Page>` hrefs because
 * `tests/wiki-links.spec.ts` requires exactly that shape for GitHub's renderer,
 * and `markdown.ts` classifies them into internal navigation at parse time
 * instead. See that file's header for why the shape is load-bearing on both
 * ends.
 *
 * THE CORPUS IS NOT IN THE ENTRY CHUNK
 * ------------------------------------
 * `manual-corpus.ts` is reached through one `await import`, taken the first
 * time the tab is opened and cached in a module-level promise for the rest of
 * the session. A player who never opens the manual never downloads it. That is
 * the whole reason this file is split in two, and `tests/manual.spec.ts` pins
 * it — see the header there and in `manual-corpus.ts`.
 *
 * NO `innerHTML`, ANYWHERE
 * ------------------------
 * Every node here is `createElement` / `createTextNode` over the AST that
 * `markdown.ts` produces. There is no HTML string on the path, so there is no
 * escaping step to forget. The corpus is ours, but it already contains literal
 * `<Name>` in prose, and a renderer that is safe because of who wrote its input
 * is one contribution away from not being.
 *
 * READING ORDER COMES FROM THE FRONT PAGE
 * ---------------------------------------
 * The rail is ordered by the links in `Home.md`'s own contents table, in the
 * order they appear there, with Home first. That table is maintained anyway —
 * it is what a wiki reader sees — so the game's ordering cannot rot separately.
 * Any page it does not mention is appended alphabetically rather than dropped,
 * which is what makes adding a wiki page a zero-code change.
 * ============================================================================
 */

import {
  documentSections,
  documentTitle,
  parseMarkdown,
  type Block,
  type Inline,
  type LinkTarget,
} from './markdown';

import { button, el, focusable, icon } from './Shell';

/* ==========================================================================
 * 1. THE CORPUS, LOADED ONCE
 * ========================================================================== */

export interface ManualPage {
  readonly slug: string;
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly sections: readonly { text: string; slug: string }[];
}

/**
 * The one dynamic import, memoised.
 *
 * A rejected promise is NOT cached — a failed chunk fetch is usually a network
 * hiccup or a stale service worker, and permanently poisoning the manual for
 * the rest of the session over one would be worse than trying again when the
 * player next opens the tab.
 */
let pending: Promise<readonly ManualPage[]> | null = null;

export function loadManual(): Promise<readonly ManualPage[]> {
  if (pending === null) {
    pending = import('./manual-corpus')
      .then((m) => buildPages(m.manualSources()))
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

function buildPages(
  sources: readonly { slug: string; markdown: string }[],
): readonly ManualPage[] {
  const parsed = new Map<string, ManualPage>();
  for (const s of sources) {
    const blocks = parseMarkdown(s.markdown);
    parsed.set(s.slug, {
      slug: s.slug,
      // A page with no `#` heading falls back to its filename with the hyphens
      // taken out, which is what GitHub's wiki calls it.
      title: documentTitle(blocks) ?? s.slug.replace(/-/g, ' '),
      blocks,
      sections: documentSections(blocks),
    });
  }
  return orderPages(parsed);
}

/** Every internal page link in a tree, in document order, with repeats. */
function collectPageLinks(blocks: readonly Block[], out: string[]): void {
  const inlines = (nodes: readonly Inline[]): void => {
    for (const n of nodes) {
      if (n.kind === 'link') {
        if (n.target.kind === 'page') out.push(n.target.page);
        inlines(n.children);
      } else if (n.kind === 'strong' || n.kind === 'em') {
        inlines(n.children);
      }
    }
  };
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': case 'para': inlines(b.children); break;
      case 'list': for (const item of b.items) inlines(item); break;
      case 'quote': collectPageLinks(b.blocks, out); break;
      case 'table':
        for (const c of b.head) inlines(c);
        for (const r of b.rows) for (const c of r) inlines(c);
        break;
      default: break;
    }
  }
}

/** Home, then the contents table's order, then whatever it forgot. */
function orderPages(parsed: ReadonlyMap<string, ManualPage>): readonly ManualPage[] {
  const out: ManualPage[] = [];
  const seen = new Set<string>();
  const take = (slug: string): void => {
    const page = parsed.get(slug);
    if (page === undefined || seen.has(slug)) return;
    seen.add(slug);
    out.push(page);
  };

  const home = parsed.get('Home');
  if (home !== undefined) {
    take('Home');
    /*
     * THE CONTENTS TABLE FIRST, then any other link on the front page.
     *
     * Two passes rather than one because the front page's opening paragraph
     * carries a see-also — today it is Multiplayer — and a single pass in
     * document order put a niche page second in the rail, ahead of How to
     * Play. The `## Contents` table is the running order the wiki publishes to
     * its own readers, and it is the one the manual should use.
     */
    const fromTables: string[] = [];
    collectPageLinks(home.blocks.filter((b) => b.kind === 'table'), fromTables);
    for (const slug of fromTables) take(slug);

    const fromProse: string[] = [];
    collectPageLinks(home.blocks, fromProse);
    for (const slug of fromProse) take(slug);
  }

  const rest = [...parsed.values()]
    .filter((p) => !seen.has(p.slug))
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const p of rest) take(p.slug);

  return out;
}

/* ==========================================================================
 * 2. MARKDOWN -> DOM
 * ========================================================================== */

/** What a link does when it is clicked. */
type Navigate = (target: LinkTarget) => void;

function renderInline(nodes: readonly Inline[], host: Node, nav: Navigate): void {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        host.appendChild(document.createTextNode(n.text));
        break;
      case 'code':
        host.appendChild(el('code', 'vm-manual-code', n.text));
        break;
      case 'strong': {
        const s = el('strong', 'vm-manual-strong');
        renderInline(n.children, s, nav);
        host.appendChild(s);
        break;
      }
      case 'em': {
        const e = el('em', 'vm-manual-em');
        renderInline(n.children, e, nav);
        host.appendChild(e);
        break;
      }
      case 'link':
        host.appendChild(renderLink(n.target, n.children, nav));
        break;
      default:
        break;
    }
  }
}

function renderLink(target: LinkTarget, label: readonly Inline[], nav: Navigate): Node {
  // A target the reader cannot follow is TEXT, not a dead link. `wiki-links`
  // forbids the only form this can take, so it should never be reachable —
  // and if the corpus ever grows one, a plain run of words is a better answer
  // than something that looks clickable and is not.
  if (target.kind === 'plain') {
    const span = el('span');
    renderInline(label, span, nav);
    return span;
  }

  // An external link is a REAL anchor: middle-click, copy-link and the desktop
  // shell's `setWindowOpenHandler` all depend on it being one.
  if (target.kind === 'external') {
    const a = el('a', 'vm-manual-link is-external');
    a.href = target.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    renderInline(label, a, nav);
    a.appendChild(icon('chevronRight', 12));
    return a;
  }

  /*
   * An INTERNAL link has no URL to be. It is an `<a>` without `href` rather
   * than a `<button>` because a button will not wrap mid-phrase, and half the
   * links in this corpus sit inside a sentence.
   *
   * `tabindex` and the Enter/Space handler are what an href would have given
   * for free. It is deliberately NOT `focusable()`: that attribute enrols a
   * node in the shell's arrow-key ring, and `Strategy.md` alone would put a
   * hundred of them between the rail and the Done button.
   */
  const a = el('a', 'vm-manual-link');
  a.setAttribute('role', 'link');
  a.tabIndex = 0;
  renderInline(label, a, nav);
  a.addEventListener('click', () => nav(target));
  a.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    nav(target);
  });
  return a;
}

const HEADING_CLASS = ['vm-manual-h1', 'vm-manual-h2', 'vm-manual-h3', 'vm-manual-h4'];

function renderBlocks(blocks: readonly Block[], host: HTMLElement, nav: Navigate): void {
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        const level = Math.min(b.level, 4);
        const h = el(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4', HEADING_CLASS[level - 1]);
        // The id is what a `#fragment` link scrolls to, and the slug comes
        // straight out of the wiki's own rule. See `markdown.ts#slugify`.
        h.id = `vm-md-${b.slug}`;
        renderInline(b.children, h, nav);
        host.appendChild(h);
        break;
      }
      case 'para': {
        const p = el('p', 'vm-manual-p');
        renderInline(b.children, p, nav);
        host.appendChild(p);
        break;
      }
      case 'list': {
        const list = el(b.ordered ? 'ol' : 'ul', 'vm-manual-list');
        for (const item of b.items) {
          const li = el('li');
          renderInline(item, li, nav);
          list.appendChild(li);
        }
        host.appendChild(list);
        break;
      }
      case 'code': {
        const pre = el('pre', 'vm-manual-pre');
        pre.appendChild(el('code', undefined, b.text));
        host.appendChild(pre);
        break;
      }
      case 'quote': {
        const q = el('blockquote', 'vm-manual-quote');
        renderBlocks(b.blocks, q, nav);
        host.appendChild(q);
        break;
      }
      case 'table': {
        host.appendChild(renderTable(b, nav));
        break;
      }
      case 'rule':
        host.appendChild(el('hr', 'vm-manual-rule'));
        break;
      default:
        break;
    }
  }
}

function renderTable(
  b: Extract<Block, { kind: 'table' }>,
  nav: Navigate,
): HTMLElement {
  // The wrapper is the horizontal scroller. `Combat.md`'s warhead/armour matrix
  // is seven columns wide and the doc pane is not, and a table that widens its
  // parent takes the whole options panel with it.
  const wrap = el('div', 'vm-manual-tablewrap');
  const table = el('table', 'vm-manual-table');

  const thead = el('thead');
  const hr = el('tr');
  for (const cell of b.head) {
    const th = el('th');
    renderInline(cell, th, nav);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of b.rows) {
    const tr = el('tr');
    for (const cell of row) {
      const td = el('td');
      renderInline(cell, td, nav);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  return wrap;
}

/* ==========================================================================
 * 3. THE VIEW
 * ========================================================================== */

export interface ManualViewOptions {
  /** Page to open. Falls back to the first in reading order. */
  readonly startPage?: string | null;
  /** Reported on every navigation so the host can reopen where you left off. */
  readonly onPage?: (slug: string) => void;
}

/**
 * One instance per mount of the Manual tab. Owns its DOM and nothing else —
 * the corpus promise is module-level and outlives every view.
 */
export class ManualView {
  readonly root: HTMLElement;

  private readonly rail: HTMLElement;
  private readonly doc: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly article: HTMLElement;

  private pages: readonly ManualPage[] = [];
  private current: ManualPage | null = null;
  /**
   * Where Back goes: the page and how far down it the reader was, most recent
   * last. The scroll offset is the half that matters — following a link out of
   * the middle of `Strategy.md` and coming back to the top of it is the same
   * as not coming back.
   */
  private readonly trail: { slug: string; scroll: number }[] = [];
  private disposed = false;

  constructor(private readonly options: ManualViewOptions = {}) {
    this.root = el('div', 'vm-manual');

    this.rail = el('nav', 'vm-manual-rail');
    this.rail.setAttribute('aria-label', 'Manual pages');

    this.doc = el('div', 'vm-manual-doc');
    this.crumb = el('div', 'vm-manual-crumb');
    this.article = el('article', 'vm-manual-article');
    this.doc.appendChild(this.crumb);
    this.doc.appendChild(this.article);

    this.root.appendChild(this.rail);
    this.root.appendChild(this.doc);

    this.article.appendChild(el('p', 'vm-manual-note', 'Opening the manual…'));

    void loadManual().then(
      (pages) => this.adopt(pages),
      () => this.fail(),
    );
  }

  dispose(): void {
    this.disposed = true;
  }

  /**
   * Page-scroll keys for the document pane, exactly as `HelpPanel` claims them.
   *
   * Up/Down are NOT claimed: they belong to the shell's focus ring, which is
   * how a gamepad reaches the rail. Escape is not claimed either — leaving the
   * options screen is what it does everywhere else on this screen, and changing
   * that here would be a surprise dressed as a convenience.
   *
   * @returns true when the key was consumed.
   */
  onKeyDown(e: KeyboardEvent): boolean {
    const page = Math.max(120, this.doc.clientHeight - 60);
    switch (e.code) {
      case 'PageDown': this.doc.scrollTop += page; return true;
      case 'PageUp': this.doc.scrollTop -= page; return true;
      case 'Home': this.doc.scrollTop = 0; return true;
      case 'End': this.doc.scrollTop = this.doc.scrollHeight; return true;
      default: return false;
    }
  }

  /* -------------------------------------------------------------------- */

  private adopt(pages: readonly ManualPage[]): void {
    if (this.disposed) return;
    this.pages = pages;
    if (pages.length === 0) { this.fail(); return; }
    const start = this.options.startPage ?? null;
    this.show(pages.find((p) => p.slug === start) ?? pages[0], {});
  }

  private fail(): void {
    if (this.disposed) return;
    this.article.replaceChildren();
    this.article.appendChild(el(
      'p',
      'vm-manual-note',
      'The manual could not be loaded. It is also published at '
      + 'github.com/avihaymenahem/voltmarch/wiki.',
    ));
  }

  /** Draw the rail. Re-run on every navigation so the marker follows. */
  private renderRail(): void {
    this.rail.replaceChildren();
    for (const page of this.pages) {
      const b = el('button', 'vm-manual-page');
      b.type = 'button';
      b.textContent = page.title;
      if (page === this.current) b.classList.add('is-current');
      b.setAttribute('aria-current', page === this.current ? 'page' : 'false');
      focusable(b);
      b.addEventListener('click', () => this.show(page, { push: true }));
      this.rail.appendChild(b);

      // The section jumps hang under the OPEN page only. Nineteen pages'
      // worth of `##` headings at once is 156 buttons and no longer a rail.
      if (page !== this.current || page.sections.length === 0) continue;
      const subs = el('div', 'vm-manual-subs');
      for (const s of page.sections) {
        const j = el('button', 'vm-manual-jump');
        j.type = 'button';
        j.textContent = s.text;
        focusable(j);
        j.addEventListener('click', () => this.scrollToAnchor(s.slug));
        subs.appendChild(j);
      }
      this.rail.appendChild(subs);
    }
  }

  private show(
    page: ManualPage,
    opts: { anchor?: string; push?: boolean; scroll?: number },
  ): void {
    if (this.disposed) return;
    if (opts.push === true && this.current !== null && this.current !== page) {
      this.trail.push({ slug: this.current.slug, scroll: this.doc.scrollTop });
      // A trail, not a history: twenty entries is far past any real chain of
      // "see also" hops and keeps this from growing for a whole session.
      if (this.trail.length > 20) this.trail.shift();
    }

    this.current = page;
    this.renderRail();
    this.renderCrumb();

    this.article.replaceChildren();
    renderBlocks(page.blocks, this.article, (t) => this.follow(t));

    this.doc.scrollTop = opts.scroll ?? 0;
    if (opts.anchor !== undefined && opts.anchor !== '') this.scrollToAnchor(opts.anchor);
    this.options.onPage?.(page.slug);
  }

  private renderCrumb(): void {
    this.crumb.replaceChildren();
    if (this.trail.length === 0) { this.crumb.hidden = true; return; }
    this.crumb.hidden = false;
    const back = button('Back', { iconName: 'back', onClick: () => this.goBack() });
    back.classList.add('is-icon');
    focusable(back);
    this.crumb.appendChild(back);
    const from = this.trail[this.trail.length - 1];
    const label = this.pages.find((p) => p.slug === from.slug)?.title ?? from.slug;
    this.crumb.appendChild(el('span', 'vm-manual-crumb-label', `Back to ${label}`));
  }

  private goBack(): void {
    const from = this.trail.pop();
    if (from === undefined) return;
    const page = this.pages.find((p) => p.slug === from.slug);
    if (page === undefined) return;
    this.show(page, { scroll: from.scroll });
  }

  private follow(target: LinkTarget): void {
    if (target.kind === 'anchor') { this.scrollToAnchor(target.anchor); return; }
    if (target.kind !== 'page') return;
    const page = this.pages.find((p) => p.slug === target.page);
    // A link to a page that is not here is inert rather than an error. The wiki
    // gate already forbids it; if one appears, doing nothing beats blanking the
    // pane the reader was using.
    if (page === undefined) return;
    this.show(page, { anchor: target.anchor, push: true });
  }

  /**
   * Offset arithmetic, not `scrollIntoView`.
   *
   * `.vm-manual-doc` is the scroll container AND is `position: relative`, so a
   * heading's `offsetTop` is already measured from it. `scrollIntoView` would
   * also scroll the shell layer behind us on engines that treat it as the
   * scroll root — the same reason `HelpPanel` does it this way.
   */
  private scrollToAnchor(slug: string): void {
    const node = this.article.querySelector<HTMLElement>(`#vm-md-${cssEscape(slug)}`);
    if (node === null) return;
    // The crumb bar is `position: sticky`, so once the pane is scrolled it
    // covers the top of the scrollport. Landing a heading underneath it is the
    // same as not scrolling to it.
    const lead = this.crumb.hidden ? 10 : (this.crumb.offsetHeight || 0) + 8;
    this.doc.scrollTop = Math.max(0, node.offsetTop - lead);
  }
}

/**
 * Escape a slug for use inside a CSS id selector.
 *
 * Slugs are `[a-z0-9_-]` by construction — `slugify` strips everything else —
 * so the only real hazard is a leading digit, which is not a valid identifier
 * start. `CSS.escape` handles it where it exists; the manual fallback covers
 * the same case for anything that does not have it.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/^(\d)/, '\\3$1 ');
}

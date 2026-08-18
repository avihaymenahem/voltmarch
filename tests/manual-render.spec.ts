/**
 * ============================================================================
 * tests/manual-render.spec.ts — the Manual tab actually builds DOM, for all 17
 * ============================================================================
 * `tests/manual.spec.ts` is the half that needs no document: the parser, the
 * link classification, and the promise that 306 kB of wiki stays out of the
 * entry chunk. This is the other half, and it exists because the usual answer
 * — "the screenshot harness covers the DOM" — is FALSE HERE. `?shot=` never
 * loads the shell chunk (`shell-scope.spec.ts` says so in its header, and it
 * cost a broken HUD to find out), so nothing in `npm run shots` has ever
 * rendered an options screen, let alone a fifth tab on one.
 *
 * So the whole render path — `ManualView`, `renderBlocks`, `renderInline` — is
 * driven here over the real corpus against a stub document. It cannot prove a
 * pixel. What it proves is the class of failure that would otherwise reach a
 * player unannounced: a page that throws on mount, a block kind that produces
 * no element, a link that is built without the handler that makes it a link.
 *
 * THE STUB IS INSTALLED BEFORE THE IMPORT, and the import is therefore dynamic
 * — a static one would hoist above it. Same arrangement, and the same reason,
 * as `tests/savegame-ux.spec.ts`.
 * ============================================================================
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ==========================================================================
 * 1. A DOCUMENT, MINUS EVERYTHING THE MANUAL DOES NOT USE
 * ========================================================================== */

type Handler = (e: { type: string; key?: string; preventDefault: () => void; stopPropagation: () => void }) => void;

class StubNode {
  readonly children: StubNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly handlers = new Map<string, Handler[]>();
  readonly classes = new Set<string>();
  parent: StubNode | null = null;
  ownText = '';
  hidden = false;
  /** Never read by the code under test, only written. Layout does not exist. */
  scrollTop = 0;
  clientHeight = 400;
  scrollHeight = 4000;
  offsetTop = 0;

  constructor(readonly tagName: string) {}

  get className(): string { return [...this.classes].join(' '); }
  set className(v: string) {
    this.classes.clear();
    for (const c of v.split(/\s+/)) if (c !== '') this.classes.add(c);
  }

  readonly classList = {
    add: (...c: string[]): void => { for (const x of c) this.classes.add(x); },
    remove: (...c: string[]): void => { for (const x of c) this.classes.delete(x); },
    contains: (c: string): boolean => this.classes.has(c),
    toggle: (c: string, on?: boolean): void => {
      const want = on ?? !this.classes.has(c);
      if (want) this.classes.add(c); else this.classes.delete(c);
    },
  };

  get tabIndex(): number { return Number(this.attrs.get('tabindex') ?? '-1'); }
  set tabIndex(v: number) { this.attrs.set('tabindex', String(v)); }

  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(v: boolean) {
    if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled');
  }

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(v: string) { this.attrs.set('id', v); }

  get href(): string { return this.attrs.get('href') ?? ''; }
  set href(v: string) { this.attrs.set('href', v); }

  get target(): string { return this.attrs.get('target') ?? ''; }
  set target(v: string) { this.attrs.set('target', v); }

  get rel(): string { return this.attrs.get('rel') ?? ''; }
  set rel(v: string) { this.attrs.set('rel', v); }

  get type(): string { return this.attrs.get('type') ?? ''; }
  set type(v: string) { this.attrs.set('type', v); }

  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.children.length = 0;
    this.ownText = v;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }

  appendChild<T extends StubNode>(child: T): T {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: StubNode): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  replaceChildren(...next: StubNode[]): void {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this.ownText = '';
    for (const c of next) this.appendChild(c);
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  removeEventListener(): void { /* nothing here removes one */ }

  focus(): void { /* no focus model without layout */ }

  click(): void {
    for (const fn of [...(this.handlers.get('click') ?? [])]) {
      fn({ type: 'click', preventDefault: () => undefined, stopPropagation: () => undefined });
    }
  }

  /** `.class`, `#id` and `tag` — the three forms the manual uses. */
  querySelector(selector: string): StubNode | null {
    return this.queryAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): StubNode[] { return this.queryAll(selector); }

  private queryAll(selector: string): StubNode[] {
    const out: StubNode[] = [];
    const match = (n: StubNode): boolean => {
      if (selector.startsWith('.')) return n.classes.has(selector.slice(1));
      if (selector.startsWith('#')) return n.id === selector.slice(1);
      return n.tagName === selector.toUpperCase();
    };
    const walk = (n: StubNode): void => {
      for (const c of n.children) {
        if (match(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  descendants(): StubNode[] {
    const out: StubNode[] = [];
    const walk = (n: StubNode): void => {
      for (const c of n.children) { out.push(c); walk(c); }
    };
    walk(this);
    return out;
  }
}

const TEXT_TAG = '#TEXT';

function installDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => new StubNode(tag.toUpperCase()),
    createElementNS: (_ns: string, tag: string) => new StubNode(tag.toUpperCase()),
    createTextNode: (text: string) => {
      const n = new StubNode(TEXT_TAG);
      n.ownText = text;
      return n;
    },
    body: new StubNode('BODY'),
    head: new StubNode('HEAD'),
    activeElement: null,
    getElementById: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  g.window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  g.requestAnimationFrame = (cb: (t: number) => void) => { cb(0); return 0; };
  g.cancelAnimationFrame = () => undefined;
}

installDom();

/* ==========================================================================
 * 2. THE MODULE UNDER TEST
 * ========================================================================== */

type ManualModule = typeof import('../src/shell/Manual');
let Manual: ManualModule;

beforeAll(async () => {
  Manual = await import('../src/shell/Manual');
  // Warm the memoised corpus promise once, so each case below is synchronous
  // after its own microtask turn.
  await Manual.loadManual();
});

/** Build a view and wait for its load callback to have run. */
async function mounted(startPage?: string): Promise<{
  view: InstanceType<ManualModule['ManualView']>;
  root: StubNode;
  visited: string[];
}> {
  const visited: string[] = [];
  const view = new Manual.ManualView({
    startPage: startPage ?? null,
    onPage: (slug) => visited.push(slug),
  });
  await Manual.loadManual();
  await Promise.resolve();
  return { view, root: view.root as unknown as StubNode, visited };
}

const rail = (root: StubNode): StubNode[] =>
  root.querySelectorAll('.vm-manual-page');

const article = (root: StubNode): StubNode =>
  root.querySelector('.vm-manual-article') as StubNode;

/* ==========================================================================
 * 3. IT MOUNTS, AND EVERY PAGE DRAWS
 * ========================================================================== */

describe('the manual mounts', () => {
  it('lists every page in the rail, with the front page open', async () => {
    const { root, visited } = await mounted();
    expect(rail(root).length).toBeGreaterThan(10);
    expect(rail(root)[0].classes.has('is-current')).toBe(true);
    expect(visited).toEqual(['Home']);
    // The rail is reachable by the shell focus ring; the inline links are not,
    // deliberately — see the note in `Manual.ts#renderLink`.
    expect(rail(root)[0].hasAttribute('data-vm-focus')).toBe(true);
  });

  it('opens on the page it was handed, when it was handed one', async () => {
    const { visited } = await mounted('Combat');
    expect(visited).toEqual(['Combat']);
  });

  it('renders every page in the corpus without throwing or drawing a blank', async () => {
    /*
     * THE ONE THAT MATTERS. Seventeen pages, every block kind in the corpus,
     * driven through the real renderer. Before this, nothing anywhere executed
     * `renderBlocks` — `npm run shots` does not load the shell chunk at all.
     */
    const { root } = await mounted();
    const buttons = rail(root);
    const thin: string[] = [];
    for (let i = 0; i < buttons.length; i++) {
      rail(root)[i].click();
      const body = article(root);
      const label = body.querySelector('.vm-manual-h1')?.textContent ?? `page ${i}`;
      if (body.descendants().length < 40) thin.push(`${label}: ${body.descendants().length} nodes`);
    }
    expect(thin, 'these pages rendered almost nothing').toEqual([]);
  });

  it('produces a paragraph, a table, a list, a rule and a code block somewhere', async () => {
    // Non-vacuity for the case above: node counts alone would be satisfied by
    // seventeen walls of undifferentiated text.
    const { root } = await mounted();
    const kinds = new Set<string>();
    for (let i = 0; i < rail(root).length; i++) {
      rail(root)[i].click();
      for (const n of article(root).descendants()) {
        for (const c of n.classes) if (c.startsWith('vm-manual-')) kinds.add(c);
        kinds.add(n.tagName);
      }
    }
    for (const want of [
      'vm-manual-p', 'vm-manual-list', 'vm-manual-table', 'vm-manual-rule',
      'vm-manual-pre', 'vm-manual-quote', 'vm-manual-code', 'vm-manual-strong',
      'vm-manual-em', 'vm-manual-link', 'vm-manual-h1', 'vm-manual-h2', 'vm-manual-h3',
    ]) {
      expect(kinds.has(want), `no ${want} was ever rendered`).toBe(true);
    }
    for (const tag of ['TABLE', 'THEAD', 'TBODY', 'TH', 'TD', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'A']) {
      expect(kinds.has(tag), `no <${tag.toLowerCase()}> was ever rendered`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 4. LINKS NAVIGATE
 * ========================================================================== */

describe('links inside the manual', () => {
  it('turns an internal wiki href into navigation, not an href', async () => {
    const { root, visited } = await mounted('Home');
    const links = article(root).querySelectorAll('.vm-manual-link');
    expect(links.length).toBeGreaterThan(10);

    // An internal link has NO href — there is no URL for it to be — and gets
    // the tabindex and role an anchor without one does not have.
    const internal = links.find((l) => !l.hasAttribute('href')) as StubNode;
    expect(internal, 'every link on Home came out external').toBeDefined();
    expect(internal.getAttribute('role')).toBe('link');
    expect(internal.tabIndex).toBe(0);

    internal.click();
    expect(visited.length).toBe(2);
    expect(visited[1]).not.toBe('Home');
  });

  it('shows a Back control after a hop, and only then', async () => {
    const { root } = await mounted('Home');
    const crumb = root.querySelector('.vm-manual-crumb') as StubNode;
    expect(crumb.hidden).toBe(true);

    const internal = article(root)
      .querySelectorAll('.vm-manual-link')
      .find((l) => !l.hasAttribute('href')) as StubNode;
    internal.click();
    expect(crumb.hidden).toBe(false);
    expect(crumb.textContent).toContain('Back to');
  });

  it('walks back to where it came from', async () => {
    const { root, visited } = await mounted('Home');
    const internal = article(root)
      .querySelectorAll('.vm-manual-link')
      .find((l) => !l.hasAttribute('href')) as StubNode;
    internal.click();
    const crumbBack = (root.querySelector('.vm-manual-crumb') as StubNode)
      .querySelector('.vm-btn') as StubNode;
    crumbBack.click();
    expect(visited[visited.length - 1]).toBe('Home');
  });

  it('marks the rail as the page changes', async () => {
    const { root } = await mounted('Home');
    const before = rail(root).findIndex((b) => b.classes.has('is-current'));
    article(root)
      .querySelectorAll('.vm-manual-link')
      .find((l) => !l.hasAttribute('href'))
      ?.click();
    const after = rail(root).findIndex((b) => b.classes.has('is-current'));
    expect(after).not.toBe(before);
    expect(rail(root).filter((b) => b.classes.has('is-current')).length).toBe(1);
  });

  it('hangs the open page section jumps under it, and nobody else', async () => {
    const { root } = await mounted('Combat');
    const subs = root.querySelectorAll('.vm-manual-subs');
    expect(subs.length).toBe(1);
    expect(subs[0].querySelectorAll('.vm-manual-jump').length).toBeGreaterThan(2);
  });

  it('gives every heading the anchor id a fragment link scrolls to', async () => {
    const { root } = await mounted('Combat');
    const heads = article(root).querySelectorAll('.vm-manual-h2');
    expect(heads.length).toBeGreaterThan(2);
    for (const h of heads) expect(h.id.startsWith('vm-md-')).toBe(true);
  });
});

/* ==========================================================================
 * 5. NO MARKUP STRINGS ON THE PATH
 * ========================================================================== */

describe('the renderer never builds HTML', () => {
  const ROOT = join(__dirname, '..');

  it('uses no innerHTML, outerHTML or insertAdjacentHTML', () => {
    /*
     * The escaping story, asserted rather than described. The corpus is ours
     * today; `Base-Building.md` already carries a literal `<Name>` in prose,
     * and a renderer whose safety rests on who wrote its input is one
     * contribution away from being wrong. There is no markup string to escape
     * because there is no markup string.
     */
    for (const f of ['src/shell/Manual.ts', 'src/shell/markdown.ts', 'src/shell/manual-corpus.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} builds markup`).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML/);
    }
  });

  it('puts prose on the page as text nodes', async () => {
    const { root } = await mounted('Home');
    const texts = article(root).descendants().filter((n) => n.tagName === TEXT_TAG);
    expect(texts.length).toBeGreaterThan(20);
  });
});

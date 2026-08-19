/**
 * ============================================================================
 * tests/campaign-chapters.spec.ts — one chapter's operations at a time
 * ============================================================================
 * `src/shell/Campaign.ts` opens with "Four chapter cards, an operation list
 * under whichever is chosen" and the screen did not do it: `mount` rendered
 * every chapter EXPANDED, so twenty operations stacked into one scroll in
 * which nineteen rows read "Locked — complete X", and the panel was clipped at
 * the bottom at 1600x1000. The first line of the file described the screen
 * somebody meant to build.
 *
 * ── THE VACUITY TRAPS, AND THERE ARE THREE OF THEM ──────────────────────────
 * "Only one chapter's operations are on screen" is ALSO true of a screen that
 * renders no operations at all, of a table with one chapter in it, and of a
 * chapter with one operation in it. §1 refuses all three before anything else
 * runs: the shipped table must hold at least two chapters, the second must
 * hold operations of its own, and the rendered count must be a strict subset
 * of the total. CLAUDE.md records walking into this trap three times.
 *
 * "The landing chapter is the first unfinished one" is likewise true by
 * accident on a fresh profile, where the first unfinished chapter IS the first
 * chapter. §4 therefore drives a profile that has FINISHED chapter one and
 * requires the screen to open on chapter two — the only case in which the
 * derived answer and a hard-coded `0` disagree.
 *
 * ── WHY THIS FILE BRINGS A DOM ──────────────────────────────────────────────
 * The suite is `environment: 'node'` and jsdom is not installed, so this stubs
 * the members of `Element` the shell chrome actually touches — the idiom
 * `tests/campaign-briefing.spec.ts` established, plus a real listener table,
 * because half of what is asserted here is what a PRESS does.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

/* ==========================================================================
 * THE DOM STUB — installed before any imported module can call it
 * ========================================================================== */

class StubClassList {
  private readonly names = new Set<string>();

  add(...list: string[]): void { for (const n of list) if (n !== '') this.names.add(n); }
  remove(...list: string[]): void { for (const n of list) this.names.delete(n); }
  contains(name: string): boolean { return this.names.has(name); }

  toggle(name: string, on?: boolean): boolean {
    const want = on ?? !this.names.has(name);
    if (want) this.names.add(name);
    else this.names.delete(name);
    return want;
  }

  get value(): string { return [...this.names].join(' '); }

  set value(v: string) {
    this.names.clear();
    for (const n of v.split(/\s+/)) if (n !== '') this.names.add(n);
  }
}

class StubElement {
  readonly childNodes: StubElement[] = [];
  parentNode: StubElement | null = null;
  readonly classList = new StubClassList();
  readonly style = { setProperty: (): void => { /* unused here */ } };
  type = '';
  id = '';
  disabled = false;
  tabIndex = 0;
  hidden = false;

  private textValue = '';
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(readonly tagName: string) {}

  get className(): string { return this.classList.value; }
  set className(v: string) { this.classList.value = v; }

  get children(): StubElement[] { return this.childNodes; }

  /** Own text PLUS children — see `tests/lobby-advanced.spec.ts` for why. */
  get textContent(): string {
    return this.textValue + this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes.length = 0;
    this.textValue = v;
  }

  appendChild(child: StubElement): StubElement {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  append(...parts: (StubElement | string)[]): void {
    for (const p of parts) {
      if (typeof p === 'string') {
        const t = new StubElement('#TEXT');
        t.textContent = p;
        this.appendChild(t);
      } else this.appendChild(p);
    }
  }

  replaceChildren(...parts: StubElement[]): void {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    for (const p of parts) this.appendChild(p);
  }

  removeChild(child: StubElement): StubElement {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'class') { this.classList.value = value; return; }
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.classList.value;
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'class') return this.classList.value !== '';
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void { this.attrs.delete(name); }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
}

const stubDocument = {
  createElement: (tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string): StubElement => new StubElement(tag.toUpperCase()),
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = stubDocument;

/* -- imports AFTER the stub -------------------------------------------------- */

import { CampaignScreen, landingChapter, loadCampaign } from '../src/shell/Campaign';
import { CAMPAIGNS } from '../src/campaign/index';
import type { Shell } from '../src/shell/Shell';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/** The shipped table, narrowed to the fields this file reads off it. */
interface ChapterLike {
  readonly id: string;
  readonly title: string;
  readonly operations: readonly { readonly id: string; readonly title: string }[];
}

const TABLE: readonly ChapterLike[] = CAMPAIGNS;

/**
 * Install a profile whose `campaign` rows are the given medals.
 *
 * `completionOf()` reads the same duck-typed `__vmProgression` handle the
 * objectives panel does, so this is the real read path rather than a seam
 * opened for the test.
 */
function withProfile(rows: Record<string, number>): void {
  g.__vmProgression = { profile: (): { campaign: Record<string, number> } => ({ campaign: rows }) };
}

function stubShell(opened: string[]): Shell {
  return {
    showMenu: (): void => { /* Back */ },
    openBriefing: (id: string): void => { opened.push(id); },
  } as unknown as Shell;
}

async function mountCampaign(opened: string[] = []): Promise<StubElement> {
  // Warm the memoised table first, so one macrotask flushes the `.then` inside
  // `mount` — the screen offers no completion signal of its own.
  await loadCampaign();
  const host = new StubElement('DIV');
  new CampaignScreen(stubShell(opened)).mount(host as unknown as HTMLElement);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  return host;
}

function all(root: StubElement, className: string): StubElement[] {
  const out: StubElement[] = [];
  const walk = (n: StubElement): void => {
    if (n.classList.contains(className)) out.push(n);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}

/** The titles of every operation row currently on the screen, in order. */
function shownOperations(host: StubElement): string[] {
  return all(host, 'vm-camp-op-title').map((t) => t.textContent);
}

/** The four chapter cards. */
function cards(host: StubElement): StubElement[] {
  return all(host, 'vm-camp-card');
}

function pressedCard(host: StubElement): StubElement | undefined {
  return cards(host).find((c) => c.getAttribute('aria-pressed') === 'true');
}

function titlesOf(ch: ChapterLike): string[] {
  return ch.operations.map((o) => o.title);
}

/** Every operation id in the table, so a "finished chapter" can be built. */
function completeChapter(index: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of TABLE[index].operations) out[op.id] = 1;
  return out;
}

afterEach(() => {
  delete g.__vmProgression;
});

/* ==========================================================================
 * 1. THE TABLE CAN TELL THE TWO BEHAVIOURS APART
 *
 * Read this first. Every assertion below is vacuously true against a table
 * with one chapter, a chapter with one operation, or a screen that renders
 * nothing.
 * ========================================================================== */

describe('the shipped table', () => {
  it('has at least two chapters, or "one at a time" restricts nothing', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(2);
  });

  it('gives every chapter operations of its own', () => {
    for (const ch of TABLE) expect(ch.operations.length, ch.id).toBeGreaterThan(0);
  });

  it('holds strictly more operations than any one chapter does', () => {
    const total = TABLE.reduce((n, ch) => n + ch.operations.length, 0);
    const biggest = Math.max(...TABLE.map((ch) => ch.operations.length));
    expect(total).toBeGreaterThan(biggest);
  });
});

/* ==========================================================================
 * 2. ONE CHAPTER'S OPERATIONS, NOT ALL OF THEM
 * ========================================================================== */

describe('the campaign screen', () => {
  it('draws one card per chapter', async () => {
    const host = await mountCampaign();
    expect(cards(host).length).toBe(TABLE.length);
    expect(cards(host).map((c) => c.textContent.startsWith(TABLE[0].title)))
      .toContain(true);
  });

  it('lists exactly one chapter\'s operations — not the whole table', async () => {
    const host = await mountCampaign();
    const total = TABLE.reduce((n, ch) => n + ch.operations.length, 0);
    const shown = shownOperations(host);

    expect(shown).toEqual(titlesOf(TABLE[0]));
    // The falsifier for the line above: the old screen rendered all of them,
    // and a screen rendering none would also "not render the whole table".
    expect(shown.length).toBeLessThan(total);
    expect(shown.length).toBeGreaterThan(0);
  });

  it('swaps the list when another chapter card is pressed', async () => {
    const host = await mountCampaign();
    const last = TABLE.length - 1;
    cards(host)[last].click();

    expect(shownOperations(host)).toEqual(titlesOf(TABLE[last]));
    // And the chapter that WAS open is gone rather than appended to.
    for (const title of titlesOf(TABLE[0])) {
      expect(shownOperations(host), `${title} survived the swap`).not.toContain(title);
    }
  });

  it('marks exactly one card pressed, and it follows the selection', async () => {
    const host = await mountCampaign();
    expect(cards(host).filter((c) => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
    expect(pressedCard(host)).toBe(cards(host)[0]);

    cards(host)[1].click();
    expect(cards(host).filter((c) => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
    expect(pressedCard(host)).toBe(cards(host)[1]);
  });

  it('keeps the recommended-order copy at the top', async () => {
    // Short, and the one thing telling a new player where to start.
    const host = await mountCampaign();
    expect(host.textContent).toContain('Soviets first');
  });
});

/* ==========================================================================
 * 3. FOCUS SURVIVES A CARD PRESS
 *
 * The cards are MUTATED, not rebuilt: rebuilding the row would destroy the
 * card the player just activated and drop `document.activeElement` back to
 * `<body>`. Asserted as node identity, which is the property a rebuild cannot
 * have.
 * ========================================================================== */

describe('the chapter cards', () => {
  it('are the same nodes after a selection', async () => {
    const host = await mountCampaign();
    const before = cards(host);
    before[1].click();
    const after = cards(host);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < after.length; i++) {
      expect(after[i], `card ${i} was rebuilt — focus would be lost`).toBe(before[i]);
    }
  });

  it('are all reachable by the focus ring', async () => {
    const host = await mountCampaign();
    for (const c of cards(host)) expect(c.hasAttribute('data-vm-focus')).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE LANDING CHAPTER IS DERIVED, NOT INDEX 0
 *
 * The only case where "first unfinished" and "the first card" disagree is a
 * player who has finished a chapter, so that is the case driven here.
 * ========================================================================== */

describe('landingChapter', () => {
  // The narrowest thing `landingChapter` accepts, which is the point of its
  // parameter type: two ids and nothing else.
  const CH = (id: string, ops: string[]): { id: string; operations: { id: string }[] } =>
    ({ id, operations: ops.map((o) => ({ id: o })) });

  it('is the first chapter when nothing is finished', () => {
    expect(landingChapter([CH('a', ['a1']), CH('b', ['b1'])], new Map())).toBe('a');
  });

  it('skips a chapter whose every operation is done', () => {
    const done = new Map([['a1', 1], ['a2', 3]]);
    expect(landingChapter([CH('a', ['a1', 'a2']), CH('b', ['b1'])], done)).toBe('b');
  });

  it('does NOT skip a chapter that is only partly done', () => {
    const done = new Map([['a1', 1]]);
    expect(landingChapter([CH('a', ['a1', 'a2']), CH('b', ['b1'])], done)).toBe('a');
  });

  it('falls back to the first chapter once everything is finished', () => {
    const done = new Map([['a1', 3], ['b1', 3]]);
    expect(landingChapter([CH('a', ['a1']), CH('b', ['b1'])], done)).toBe('a');
  });

  it('answers null for an empty table', () => {
    expect(landingChapter([], new Map())).toBe(null);
  });
});

describe('the screen opens where the player is', () => {
  it('opens on chapter TWO for a profile that has finished chapter one', async () => {
    withProfile(completeChapter(0));
    const host = await mountCampaign();

    expect(shownOperations(host)).toEqual(titlesOf(TABLE[1]));
    expect(pressedCard(host)).toBe(cards(host)[1]);
  });

  it('opens on chapter ONE for a profile halfway through it', async () => {
    // The other side of the same rule: a partly-finished chapter is still
    // where the player is, and the screen must not run past it.
    const rows = completeChapter(0);
    delete rows[TABLE[0].operations[TABLE[0].operations.length - 1].id];
    withProfile(rows);
    const host = await mountCampaign();

    expect(shownOperations(host)).toEqual(titlesOf(TABLE[0]));
    expect(pressedCard(host)).toBe(cards(host)[0]);
  });
});

/* ==========================================================================
 * 5. A LOCKED ROW IS LIGHTER, NOT GONE
 *
 * `Campaign.ts`'s header: "A row a player cannot see is a row they cannot plan
 * toward." The rows shrank; the reason did not go anywhere.
 * ========================================================================== */

describe('a locked operation', () => {
  it('is still on the list, with the reason on it', async () => {
    const host = await mountCampaign();
    const locked = all(host, 'vm-camp-op').filter((r) => r.classList.contains('is-locked'));

    // Chapter one on a fresh profile is one playable operation and the rest
    // locked — if that stops being true the assertions below prove nothing.
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.length).toBeLessThan(shownOperations(host).length);

    for (const r of locked) {
      const reason = all(r, 'vm-camp-op-lock');
      expect(reason.length, 'a locked row lost its reason line').toBe(1);
      expect(reason[0].textContent).toContain('Locked — complete ');
      // And it is still identifiable: the title and the index stay.
      expect(all(r, 'vm-camp-op-title').length).toBe(1);
    }
  });

  it('carries a padlock instead of a button, and nothing can be pressed into it', async () => {
    const opened: string[] = [];
    const host = await mountCampaign(opened);
    const rows = all(host, 'vm-camp-op');
    const locked = rows.filter((r) => r.classList.contains('is-locked'));
    const open = rows.filter((r) => !r.classList.contains('is-locked'));

    expect(open.length).toBeGreaterThan(0);
    for (const r of open) expect(all(r, 'vm-btn').length).toBe(1);
    for (const r of locked) {
      expect(all(r, 'vm-btn').length, 'a locked row still carries a button').toBe(0);
      expect(all(r, 'vm-camp-op-lockcell').length).toBe(1);
    }

    // The falsifier for "nothing can be pressed": the unlocked row can be.
    for (const r of locked) for (const b of all(r, 'vm-btn')) b.click();
    expect(opened).toEqual([]);
    all(open[0], 'vm-btn')[0].click();
    expect(opened.length).toBe(1);
  });

  it('drops the flavour beat, which the reason has replaced', async () => {
    const host = await mountCampaign();
    for (const r of all(host, 'vm-camp-op').filter((x) => x.classList.contains('is-locked'))) {
      expect(all(r, 'vm-camp-op-beat').length).toBe(0);
    }
  });
});

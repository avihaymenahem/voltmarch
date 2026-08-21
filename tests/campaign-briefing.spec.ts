/**
 * ============================================================================
 * tests/campaign-briefing.spec.ts — the briefing must not spoil a hidden bonus
 * ============================================================================
 * `BriefingScreen` in `src/shell/Campaign.ts` has said since the day it was
 * written that it shows "every objective the operation declares INCLUDING none
 * of the hidden ones — a briefing that listed a hidden objective would be the
 * operation spoiling its own turn before the player has pressed anything".
 *
 * IT COULD NOT OBEY. `OperationView.objectives` — the structural type the shell
 * declares for the lazily-imported operation table — was `{ id; kind; title }`,
 * with no `hidden` member to test. So `render` filtered on `kind` alone and
 * listed all three of `reclamation.01.held-paper`'s objectives, the hidden one
 * included, under a comment forbidding exactly that. The guard was prose and
 * never code, and nothing could see it: the shell's screens are covered "by
 * booting the page", and `npm run shots` never opens a briefing.
 *
 * ── WHY THIS FILE BRINGS A DOM ──────────────────────────────────────────────
 * The suite is `environment: 'node'` and jsdom is not installed, so this stubs
 * the ~10 members of `Element` that `pageFrame`, `button`, `panel` and `el`
 * actually touch — the idiom `tests/objectives-ux.spec.ts` established and for
 * its stated reasons. It matters that the DOM is real work rather than a call
 * to a helper: the assertion below is about WHAT LANDS ON THE SCREEN, and a
 * test that only read a pure function would have to trust that `render` calls
 * it. `briefingObjectives` is checked too, on the whole shipped table, but the
 * load-bearing case drives `BriefingScreen.mount` end to end.
 *
 * ── THE FALSIFIER ───────────────────────────────────────────────────────────
 * "No hidden objective is on the briefing" is ALSO true of a campaign that
 * declares none, and of a briefing that renders nothing at all. Both are
 * asserted against: the shipped table must still contain a hidden objective
 * (or this whole file is measuring nothing), and the same briefing must show
 * the two objectives that are NOT hidden. CLAUDE.md calls the first the
 * vacuous-metric trap and records walking into it three times.
 * ========================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ==========================================================================
 * THE DOM STUB — installed before any imported module can call it
 * ========================================================================== */

class StubClassList {
  private readonly names = new Set<string>();

  add(...list: string[]): void { for (const n of list) if (n !== '') this.names.add(n); }
  remove(...list: string[]): void { for (const n of list) this.names.delete(n); }
  contains(name: string): boolean { return this.names.has(name); }

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
  type = '';
  disabled = false;
  tabIndex = 0;

  private textValue = '';
  private readonly attrs = new Map<string, string>();

  constructor(readonly tagName: string) {}

  get className(): string { return this.classList.value; }
  set className(v: string) { this.classList.value = v; }

  get children(): StubElement[] { return this.childNodes; }

  get textContent(): string {
    if (this.childNodes.length === 0) return this.textValue;
    return this.childNodes.map((c) => c.textContent).join('');
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

  addEventListener(): void { /* the briefing is never clicked here */ }
}

const stubDocument = {
  createElement: (tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string): StubElement => new StubElement(tag.toUpperCase()),
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = stubDocument;

/* -- imports AFTER the stub. ESM hoists them, which is safe because nothing --
 * below touches `document` at module scope — only inside `mount`.           */

import { BriefingScreen, briefingObjectives, loadCampaign } from '../src/shell/Campaign';
import type { Shell } from '../src/shell/Shell';
import { CAMPAIGNS } from '../src/campaign/index';
import type { ObjectiveDef, OperationDef } from '../src/campaign/types';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/** The one shipped operation with a hidden secondary. See its own header. */
const HELD_PAPER = 'reclamation.01.held-paper';

function everyOperation(): readonly OperationDef[] {
  const out: OperationDef[] = [];
  for (const ch of CAMPAIGNS) for (const op of ch.operations) out.push(op);
  return out;
}

function operationById(id: string): OperationDef {
  const op = everyOperation().find((o) => o.id === id);
  if (op === undefined) throw new Error(`no operation '${id}'`);
  return op;
}

function hiddenOf(op: OperationDef): readonly ObjectiveDef[] {
  return op.objectives.filter((o) => o.hidden === true);
}

/** Every `.vm-camp-brief-obj-text` in a rendered tree, in document order. */
function objectiveLines(root: StubElement): string[] {
  const out: string[] = [];
  const walk = (n: StubElement): void => {
    if (n.classList.contains('vm-camp-brief-obj-text')) out.push(n.textContent);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}

function byClass(root: StubElement, className: string): StubElement[] {
  const out: StubElement[] = [];
  const walk = (node: StubElement): void => {
    if (node.classList.contains(className)) out.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

/** A shell that answers the two calls a briefing makes and nothing else. */
function stubShell(): Shell {
  return {
    openCampaign: (): void => { /* Back */ },
    startOperation: (): Promise<void> => Promise.resolve(),
  } as unknown as Shell;
}

/** Mount a real `BriefingScreen` and return the host once its load has landed. */
async function mountBriefing(operationId: string): Promise<StubElement> {
  // Warm the memoised table first, so one macrotask is enough to flush the
  // `.then` inside `mount` — the screen offers no completion signal of its own.
  await loadCampaign();
  const host = new StubElement('DIV');
  const screen = new BriefingScreen(stubShell(), operationId);
  screen.mount(host as unknown as HTMLElement);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  return host;
}

/* ==========================================================================
 * 1. THE TABLE STILL HAS SOMETHING TO HIDE
 *
 * Read this first. Every assertion below it is vacuously true against a
 * campaign that declares no hidden objective.
 * ========================================================================== */

describe('the shipped table', () => {
  it('still declares a hidden objective, or the rest of this file proves nothing', () => {
    const withHidden = everyOperation().filter((op) => hiddenOf(op).length > 0);
    expect(withHidden.map((op) => op.id)).toContain(HELD_PAPER);
  });

  it('gives Held Paper exactly one hidden bonus, and two that are not', () => {
    const op = operationById(HELD_PAPER);
    expect(hiddenOf(op).map((o) => o.id)).toEqual(['dark']);
    expect(op.objectives.filter((o) => o.hidden !== true).map((o) => o.id))
      .toEqual(['mast', 'yards']);
  });
});

/* ==========================================================================
 * 2. THE BRIEFING, RENDERED
 * ========================================================================== */

describe('BriefingScreen', () => {
  it('keeps a four-sided safe area and does not cap the content inside a wider panel', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'shell.css'), 'utf8');
    const at = css.indexOf('.vm-shell .vm-camp-brief {');
    const end = css.indexOf('\n}', at);
    const rule = css.slice(at, end);

    expect(at, 'the briefing container rule was renamed').toBeGreaterThan(-1);
    expect(rule, 'the wide panel must not grow a dead column beside the portrait')
      .toContain('width: calc(100% - 36px)');
    expect(rule, 'the short-height layout needs the same inset above as at either side')
      .toContain('margin: 18px');
    expect(rule, 'the old cap created the reported empty right column')
      .not.toMatch(/width:\s*min\(980px/);
  });

  it('gives the gold-master opening operation an authored command portrait and directive', async () => {
    const host = await mountBriefing('soviets.01.first-tap');
    const portraits = byClass(host, 'vm-camp-command-portrait');
    const directives = byClass(host, 'vm-camp-command-directive');

    expect(portraits).toHaveLength(1);
    expect(portraits[0]?.getAttribute('src')).toMatch(/campaign\/portraits\/rakhalt\.webp$/);
    expect(portraits[0]?.getAttribute('alt')).toMatch(/Rakhalt.*Directorate Command/i);
    expect(directives.map((line) => line.textContent)).toEqual([
      'Take the Allied survey tap. The three derricks stay with the town.',
    ]);
  });

  it('continues the gold-master treatment into Common Standard with Vosk', async () => {
    const host = await mountBriefing('soviets.02.common-standard');
    const portraits = byClass(host, 'vm-camp-command-portrait');
    const directives = byClass(host, 'vm-camp-command-directive');

    expect(portraits).toHaveLength(1);
    expect(portraits[0]?.getAttribute('src')).toMatch(/campaign\/portraits\/vosk\.webp$/);
    expect(portraits[0]?.getAttribute('alt')).toMatch(/Vosk.*Field Operations/i);
    expect(directives.map((line) => line.textContent)).toEqual([
      'Eight hulls. No yard, no replacements. Hold Survey 40 with five.',
    ]);
  });

  it('briefs Deep Sector with Vosk before Wend appears on the intercepted net', async () => {
    const host = await mountBriefing('soviets.03.deep-sector');
    const portraits = byClass(host, 'vm-camp-command-portrait');
    expect(portraits).toHaveLength(1);
    expect(portraits[0]?.getAttribute('src')).toMatch(/campaign\/portraits\/vosk\.webp$/);
    expect(byClass(host, 'vm-camp-command-directive').map((line) => line.textContent))
      .toEqual(['Take the survey instruments off them, then take the tap properly.']);
  });

  it('does not fabricate a portrait for an operation without authored presentation', async () => {
    const host = await mountBriefing(HELD_PAPER);
    expect(byClass(host, 'vm-camp-command-portrait')).toHaveLength(0);
  });

  it('does not list a hidden objective', async () => {
    const op = operationById(HELD_PAPER);
    const host = await mountBriefing(HELD_PAPER);
    const lines = objectiveLines(host);

    for (const o of hiddenOf(op)) expect(lines).not.toContain(o.title);
  });

  it('still lists every objective that is not hidden, primaries first', async () => {
    const op = operationById(HELD_PAPER);
    const host = await mountBriefing(HELD_PAPER);
    const lines = objectiveLines(host);

    // The falsifier for the assertion above: a briefing that rendered nothing
    // at all would also contain no hidden objective.
    expect(lines).toEqual([
      op.objectives.find((o) => o.id === 'mast')?.title,
      op.objectives.find((o) => o.id === 'yards')?.title,
    ]);
  });

  it('lists no hidden objective on ANY shipped operation', async () => {
    for (const op of everyOperation()) {
      const lines = objectiveLines(await mountBriefing(op.id));
      const shown = op.objectives.filter((o) => o.hidden !== true);
      expect(lines, op.id).toEqual(shown.filter((o) => o.kind === 'primary').map((o) => o.title)
        .concat(shown.filter((o) => o.kind === 'secondary').map((o) => o.title)));
    }
  });
});

/* ==========================================================================
 * 3. THE RULE ITSELF
 *
 * `render` calls this; so does anything else that ever needs the same answer.
 * Asserted separately so a future caller cannot get a different one.
 * ========================================================================== */

describe('briefingObjectives', () => {
  it('drops every hidden row and keeps the declared order within a kind', () => {
    const rows = briefingObjectives([
      { id: 'a', kind: 'secondary', title: 'A' },
      { id: 'b', kind: 'primary', title: 'B' },
      { id: 'c', kind: 'secondary', title: 'C', hidden: true },
      { id: 'd', kind: 'secondary', title: 'D' },
      { id: 'e', kind: 'primary', title: 'E', hidden: true },
    ]);
    expect(rows.map((o) => o.id)).toEqual(['b', 'a', 'd']);
  });

  it('treats a missing `hidden` as shown — the default an author does not write', () => {
    expect(briefingObjectives([{ id: 'a', kind: 'primary', title: 'A' }]).map((o) => o.id))
      .toEqual(['a']);
    expect(briefingObjectives([{ id: 'a', kind: 'primary', title: 'A', hidden: false }])
      .map((o) => o.id)).toEqual(['a']);
  });
});

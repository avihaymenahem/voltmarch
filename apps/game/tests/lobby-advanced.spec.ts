/**
 * ============================================================================
 * tests/lobby-advanced.spec.ts — the lobby's Advanced disclosure
 * ============================================================================
 * Reported as the Skirmish screen reading like a form: every row carried a two-
 * or three-line grey note, and at 1600x1000 the Map Seed row and the summary
 * line were both below the fold. Five rows moved behind one collapsed
 * `Advanced` header — Personality, Starting Credits, Game Speed, Opponent Tech
 * and Map Seed — and Starting Condition deliberately did not.
 *
 * ── WHAT THIS FILE HAS TO PROVE, AND WHY EACH HALF NEEDS THE OTHER ──────────
 * "The advanced rows are not on screen" is TRUE OF A SCREEN THAT DELETED THEM,
 * and a control quietly deleted is precisely the failure a disclosure invites.
 * So every assertion below is paired:
 *
 *   - the five rows EXIST while the disclosure is shut, inside the collapsed
 *     body (§2) — a deletion fails here;
 *   - the body is `hidden` while shut and NOT hidden after one press (§3) — a
 *     disclosure stuck open, or one that never opens, fails here;
 *   - the six rows that must stay in the open are NOT inside that body (§4) —
 *     burying Starting Condition to tidy the screen fails here.
 *
 * ── AND A DISCLOSURE THAT REPAINTS IS A DISCLOSURE THAT DROPS FOCUS ─────────
 * §5 is the reason the header toggles `hidden` instead of calling
 * `renderRight()`. A repaint destroys the element the player just activated,
 * so `document.activeElement` falls back to `<body>` and a keyboard or gamepad
 * player is thrown to the top of the ring. Asserted as node IDENTITY across the
 * press, which is the property a repaint cannot have.
 *
 * ── WHY THIS FILE BRINGS A DOM ──────────────────────────────────────────────
 * The suite is `environment: 'node'` and jsdom is not installed, so this stubs
 * the members of `Element` that `pageFrame`, `button`, `chooser`, `row` and
 * `el` actually touch — the idiom `tests/campaign-briefing.spec.ts` and
 * `tests/objectives-ux.spec.ts` established, extended by one thing they did not
 * need: a real listener table, so a press is a press rather than a direct call
 * into a private method.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  readonly style = { setProperty: (): void => { /* faction card colour */ } };
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

  /*
   * OWN TEXT **PLUS** CHILDREN, WHICH THE STUB THIS ONE IS COPIED FROM GETS
   * WRONG. `el(tag, class, text)` sets `textContent` and the caller then
   * appends — `row()` does exactly that, hanging `.vm-row-note` off a label it
   * has already given text to. A getter that returns the children ALONE once
   * there is a child loses the label, so every row on this screen read as ''
   * and four assertions failed against correct code. In a real DOM, setting
   * `textContent` leaves a text NODE that a later `appendChild` sits after.
   */
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

  /** A real press. `button()` guards on `disabled` inside its own handler. */
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
}

let createdElements = 0;

const stubDocument = {
  createElement: (tag: string): StubElement => {
    createdElements++;
    return new StubElement(tag.toUpperCase());
  },
  createElementNS: (_ns: string, tag: string): StubElement => {
    createdElements++;
    return new StubElement(tag.toUpperCase());
  },
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = stubDocument;

/* -- imports AFTER the stub. Nothing below touches `document` at module scope. */

import { SkirmishSetupScreen } from '../src/shell/SkirmishSetup';
import { defaultSetup, type MatchSetup } from '../src/shell/settings-store';
import { UnlockGate, setUnlockGate } from '../src/progression/UnlockGate';
import type { Shell } from '../src/shell/Shell';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/** A shell that answers only what the lobby asks of it. */
function stubShell(setup: MatchSetup): Shell {
  return {
    getSetup: (): MatchSetup => setup,
    showMenu: (): void => { /* Back */ },
    startMatch: (): Promise<void> => Promise.resolve(),
  } as unknown as Shell;
}

function mountLobby(setup: MatchSetup = defaultSetup()): StubElement {
  const host = new StubElement('DIV');
  new SkirmishSetupScreen(stubShell(setup)).mount(host as unknown as HTMLElement);
  return host;
}

/** Every node carrying `className`, in document order. */
function all(root: StubElement, className: string): StubElement[] {
  const out: StubElement[] = [];
  const walk = (n: StubElement): void => {
    if (n.classList.contains(className)) out.push(n);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}

function one(root: StubElement, className: string): StubElement {
  const hits = all(root, className);
  expect(hits.length, `expected exactly one .${className}`).toBe(1);
  return hits[0];
}

/**
 * The LABEL of every `row()` under `node`.
 *
 * `.vm-row-label` holds the label text and, when there is one, a nested
 * `.vm-row-note` — so the note is stripped rather than concatenated into it.
 * Without that, `'Game Speed'` reads as `'Game SpeedScales the accumulator…'`
 * and every assertion here would be an accidental `toContain`.
 */
function rowLabels(node: StubElement): string[] {
  return all(node, 'vm-row-label').map((l) => {
    const note = l.childNodes.find((c) => c.classList.contains('vm-row-note'));
    const whole = l.textContent;
    return (note === undefined ? whole : whole.slice(0, whole.length - note.textContent.length)).trim();
  });
}

/** The five rows the disclosure owns, and the six that must stay in the open. */
const HIDDEN_ROWS = [
  'Personality', 'Starting Credits', 'Game Speed', 'Opponent Tech', 'Dynamic Weather', 'Map Seed',
];
const OPEN_ROWS = ['Sides', 'Enemy Faction', 'Difficulty', 'Starting Condition'];

/* ==========================================================================
 * A LIVE UNLOCK GATE
 *
 * `Opponent Tech` is drawn only when `gateInstalled()` — with no progression
 * layer the row would be a control that changes nothing, and the lobby says so
 * in its own comment. Without a gate this file would assert the row into the
 * disclosure and pass because it does not exist ANYWHERE, which is the
 * absence-proves-nothing trap the header above is about. §1 pins that the gate
 * really is installed.
 * ========================================================================== */

beforeEach(() => {
  setUnlockGate(new UnlockGate(() => []));
});

afterEach(() => {
  setUnlockGate(null);
});

/* ==========================================================================
 * 1. THE SCREEN RENDERED AT ALL
 * ========================================================================== */

describe('the lobby', () => {
  it('renders every row this file reasons about, somewhere', () => {
    const labels = rowLabels(mountLobby());
    for (const name of [...HIDDEN_ROWS, ...OPEN_ROWS]) {
      // `Sides` is only drawn when the map offers more than one seat count and
      // `Opponent Tech` only when a gate is installed. Both hold for the
      // default setup with the gate above; if either stops holding, the
      // assertions below would start passing by absence.
      expect(labels, `${name} is not on the lobby at all`).toContain(name);
    }
  });
});

/* ==========================================================================
 * 2 & 3. CLOSED BY DEFAULT, AND EVERY ROW IS INSIDE IT
 * ========================================================================== */

describe('the Advanced disclosure', () => {
  it('starts closed', () => {
    const host = mountLobby();
    const body = one(host, 'vm-disclose-body');
    expect(body.hidden, 'the disclosure is open on first paint').toBe(true);
    expect(one(host, 'vm-disclose-head').getAttribute('aria-expanded')).toBe('false');
  });

  it('holds all five advanced rows while it is closed — they moved, they did not go', () => {
    const host = mountLobby();
    expect(rowLabels(one(host, 'vm-disclose-body'))).toEqual(HIDDEN_ROWS);
  });

  it('opens on one press, and the rows are then reachable', () => {
    const host = mountLobby();
    one(host, 'vm-disclose-head').click();

    const body = one(host, 'vm-disclose-body');
    expect(body.hidden, 'pressing the header did not reveal the rows').toBe(false);
    expect(one(host, 'vm-disclose-head').getAttribute('aria-expanded')).toBe('true');
    expect(rowLabels(body)).toEqual(HIDDEN_ROWS);
  });

  it('shuts again on a second press', () => {
    const host = mountLobby();
    const head = one(host, 'vm-disclose-head');
    head.click();
    head.click();
    expect(one(host, 'vm-disclose-body').hidden).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('points its header at the body it controls', () => {
    const host = mountLobby();
    const body = one(host, 'vm-disclose-body');
    expect(body.id).not.toBe('');
    expect(one(host, 'vm-disclose-head').getAttribute('aria-controls')).toBe(body.id);
  });
});

/* ==========================================================================
 * 4. WHAT STAYS IN THE OPEN
 *
 * The half that makes the feature a tidy-up rather than a demotion. Starting
 * Condition is the one row on this screen that changes what the match IS
 * rather than how it runs — `SkirmishSetup.ts`'s own section has said so since
 * it was written — and burying it would be the wrong trade however much
 * shorter it made the screen.
 * ========================================================================== */

describe('what the disclosure must NOT swallow', () => {
  it('leaves Starting Condition and the opponent rows on the open screen', () => {
    const host = mountLobby();
    const inside = rowLabels(one(host, 'vm-disclose-body'));
    for (const name of OPEN_ROWS) {
      expect(inside, `${name} was buried in Advanced`).not.toContain(name);
    }
  });

  it('leaves the Starting Condition paragraph in the open too', () => {
    // The two sentences of "what actually changes" are the difference between
    // an option a player understands and one they leave alone forever, which
    // is the whole reason the row is not a `row()` note. Both halves are
    // asserted: it is on the screen, and it is not inside the disclosure.
    const PHRASE = 'construction vehicle and a small escort';
    const host = mountLobby();
    expect(host.textContent, 'the opening paragraph is gone').toContain(PHRASE);
    expect(one(host, 'vm-disclose-body').textContent).not.toContain(PHRASE);
  });

  it('keeps the faction cards and the battlefield list out of it', () => {
    const host = mountLobby();
    const body = one(host, 'vm-disclose-body');
    expect(all(body, 'vm-card').length).toBe(0);
    expect(all(body, 'vm-mapitem').length).toBe(0);
  });
});

/* ==========================================================================
 * 5. THE PRESS DOES NOT REPAINT THE COLUMN
 *
 * See the header. This is asserted as node identity because that is the only
 * property a `renderRight()` in the handler cannot have — and it is the whole
 * reason the handler is written the way it is.
 * ========================================================================== */

describe('focus survives the press', () => {
  it('keeps the header element itself across an open and a close', () => {
    const host = mountLobby();
    const before = one(host, 'vm-disclose-head');
    before.click();
    expect(one(host, 'vm-disclose-head'), 'the header was rebuilt — focus would be lost')
      .toBe(before);
    before.click();
    expect(one(host, 'vm-disclose-head')).toBe(before);
  });

  it('keeps the header focusable in both states', () => {
    // `focusable()` only assigns a tabindex when the element has none, so a
    // header that lost its marker on a toggle would be mouse-only and silent
    // about it.
    const host = mountLobby();
    const head = one(host, 'vm-disclose-head');
    expect(head.hasAttribute('data-vm-focus')).toBe(true);
    head.click();
    expect(head.hasAttribute('data-vm-focus')).toBe(true);
  });
});

/* ===========================================================================
 * 6. CHEAP PICKS STAY CHEAP
 *
 * A player-side pick used to call both `renderLeft()` and `renderRight()`.
 * That rebuilt every opponent/rule control and repainted the canvas-backed
 * battlefield survey even though none of them depends on the player's side.
 * Node identity plus the creation count makes this a behavioural performance
 * test: a redraw that happens to look identical cannot pass it.
 * ========================================================================== */

describe('synchronous lobby redraws', () => {
  it('changes player faction in place without allocating or replacing either side', () => {
    const host = mountLobby();
    const cards = all(host, 'vm-card');
    const preview = one(host, 'vm-map-preview');
    const createdBefore = createdElements;

    cards[1].click();

    expect(createdElements, 'a faction pick rebuilt lobby DOM').toBe(createdBefore);
    expect(all(host, 'vm-card')).toEqual(cards);
    expect(one(host, 'vm-map-preview'), 'the unrelated battlefield survey was replaced').toBe(preview);
    expect(cards.map((card) => card.getAttribute('aria-pressed')))
      .toEqual(['false', 'true', 'false', 'false']);
  });

  it('retains the map preview across a rules repaint', () => {
    const host = mountLobby();
    const preview = one(host, 'vm-map-preview');
    const startingCondition = all(host, 'vm-row-label')
      .find((label) => label.textContent === 'Starting Condition')?.parentNode;
    expect(startingCondition).not.toBeNull();
    const chooserValue = one(startingCondition!, 'vm-chooser-value');

    chooserValue.click();

    expect(one(host, 'vm-map-preview'), 'an unchanged map was painted again').toBe(preview);
  });
});

/* ===========================================================================
 * 7. THE OPEN STATE IS NOT PERSISTED
 *
 * A disclosure that remembers is a second piece of state to get wrong. Two
 * screens in a row, no storage between them.
 * ========================================================================== */

describe('the open state', () => {
  it('is back to closed on the next visit to the lobby', () => {
    const first = mountLobby();
    one(first, 'vm-disclose-head').click();
    expect(one(first, 'vm-disclose-body').hidden).toBe(false);

    const second = mountLobby();
    expect(one(second, 'vm-disclose-body').hidden, 'the disclosure remembered').toBe(true);
  });
});

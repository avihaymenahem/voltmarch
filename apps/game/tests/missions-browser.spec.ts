/**
 * The Missions browser deliberately uses a small DOM double rather than jsdom:
 * Vitest runs this repository in Node and the panel needs only the same narrow
 * element tree/focus surface used by the shell's other UI tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MISSIONS } from '../src/data/Missions';
import {
  MISSION_PAGE_SIZE,
  MissionsPanel,
  MissionsScreen,
  missionBrowserView,
  type MissionFilters,
} from '../src/shell/Missions';
import type { CatalogueEntry, ProfileView, ProgressionView } from '../src/ui/Objectives';

type Handler = () => void;

class ClassList {
  private readonly values = new Set<string>();
  add(...names: string[]): void { for (const name of names) if (name) this.values.add(name); }
  remove(...names: string[]): void { for (const name of names) this.values.delete(name); }
  contains(name: string): boolean { return this.values.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.values.has(name);
    if (on) this.values.add(name); else this.values.delete(name);
    return on;
  }
  get value(): string { return [...this.values].join(' '); }
  set value(value: string) { this.values.clear(); this.add(...value.split(/\s+/)); }
}

class Node {
  readonly children: Node[] = [];
  readonly classList = new ClassList();
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string> = {};
  parentElement: Node | null = null;
  readonly attrs = new Map<string, string>();
  readonly events = new Map<string, Handler[]>();
  private ownText = '';

  type = '';
  value = '';
  title = '';
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 400;

  constructor(readonly tagName: string) {
    // HTMLElement.dataset reflects writes into data-* attributes; the panel
    // deliberately queries the latter when it restores focus after replacing
    // the list, so this part of the browser contract is load-bearing here.
    this.dataset = new Proxy<Record<string, string>>({}, {
      set: (target, key, value) => {
        const name = String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        target[key as string] = String(value);
        this.attrs.set(`data-${name}`, String(value));
        return true;
      },
    });
  }

  get className(): string { return this.classList.value; }
  set className(value: string) { this.classList.value = value; }
  get textContent(): string { return this.children.length ? this.children.map(child => child.textContent).join('') : this.ownText; }
  set textContent(value: string) { this.children.length = 0; this.ownText = value; }
  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(value: boolean) { if (value) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get tabIndex(): number { return Number(this.attrs.get('tabindex') ?? -1); }
  set tabIndex(value: number) { this.attrs.set('tabindex', String(value)); }
  get offsetParent(): Node { return this; }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  appendChild<T extends Node>(child: T): T { child.parentElement?.removeChild(child); child.parentElement = this; this.children.push(child); return child; }
  append(...children: Node[]): void { for (const child of children) this.appendChild(child); }
  insertBefore<T extends Node>(child: T, before: Node | null): T {
    child.parentElement?.removeChild(child); child.parentElement = this;
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child: Node): void { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentElement = null; }
  replaceChildren(...children: Node[]): void { for (const child of this.children) child.parentElement = null; this.children.length = 0; this.ownText = ''; this.append(...children); }
  addEventListener(type: string, fn: Handler): void { const handlers = this.events.get(type) ?? []; handlers.push(fn); this.events.set(type, handlers); }
  dispatch(type: string): void { for (const fn of this.events.get(type) ?? []) fn(); }
  click(): void { this.dispatch('click'); }
  focus(): void { documentStub.activeElement = this; }
  scrollIntoView(): void { /* layout is deliberately outside this node test */ }
  contains(node: unknown): boolean { return node === this || this.descendants().includes(node as Node); }
  closest(selector: string): Node | null { for (let n: Node | null = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  querySelector(selector: string): Node | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll<T extends Node = Node>(selector: string): T[] { return this.descendants().filter(node => node.matches(selector)) as T[]; }
  descendants(): Node[] { const out: Node[] = []; const walk = (node: Node) => { for (const child of node.children) { out.push(child); walk(child); } }; walk(this); return out; }
  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) return this.hasAttribute(selector.slice(1, -1));
    return this.tagName === selector.toUpperCase();
  }
}

const documentStub = {
  activeElement: null as Node | null,
  createElement: (tag: string) => new Node(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string) => new Node(tag.toUpperCase()),
  addEventListener: () => { /* no global handlers in this panel */ },
  removeEventListener: () => { /* no global handlers in this panel */ },
};

beforeEach(() => {
  documentStub.activeElement = null;
  vi.stubGlobal('document', documentStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __vmProgression?: ProgressionView }).__vmProgression;
});

const ALL: MissionFilters = { category: 'all', scope: 'all', state: 'all' };
const key = (code: string, target: Node): KeyboardEvent => ({ code, target } as unknown as KeyboardEvent);

function entry(id: string, over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id,
    scope: 'profile',
    title: id,
    description: `${id} description`,
    category: 'combat',
    target: 10,
    reward: [{ kind: 'unlock', unlockId: `unit.${id}` }],
    locked: false,
    progress: { id, value: 0, target: 10, complete: false, claimedAt: null },
    ...over,
  };
}

function catalogue(): CatalogueEntry[] {
  return MISSIONS.map(mission => entry(mission.id, {
    ...mission,
    progress: { id: mission.id, value: 0, target: mission.target, complete: false, claimedAt: null },
  }));
}

function profile(): ProfileView {
  return { version: 1, unlocked: [], missions: [] };
}

function provider(entries: CatalogueEntry[]): ProgressionView & { emit(): void; off: ReturnType<typeof vi.fn> } {
  let subscriber: (() => void) | undefined;
  const off = vi.fn();
  return {
    catalogue: () => entries,
    profile,
    activeObjectives: () => [],
    drainPending: () => [],
    isUnlocked: () => false,
    subscribe: fn => { subscriber = fn; return off; },
    resetProfile: () => {}, exportProfile: () => '', importProfile: () => false,
    emit: () => subscriber?.(),
    off,
  };
}

describe('missionBrowserView', () => {
  it('makes every authored mission reachable exactly once through bounded pages', () => {
    const rows = catalogue();
    const first = missionBrowserView(rows, ALL);
    expect(MISSION_PAGE_SIZE).toBe(5);
    expect(first.filtered).toHaveLength(rows.length);
    expect(first.pages).toBe(Math.ceil(rows.length / MISSION_PAGE_SIZE));

    const reached = Array.from({ length: first.pages }, (_, page) =>
      missionBrowserView(rows, ALL, null, page).visible.map(row => row.id),
    ).flat();
    expect(reached).toHaveLength(rows.length);
    expect(new Set(reached).size).toBe(rows.length);
    expect(reached).toEqual(first.filtered.map(row => row.id));
    expect(reached.every((_, index) => index === 0 || rows.some(row => row.id === reached[index]))).toBe(true);
  });

  it('orders category chain output before applying category, scope and state filters', () => {
    const rows = [
      entry('combat.root'), entry('combat.child', { requires: ['combat.root'] }),
      entry('economy.match', { category: 'economy', scope: 'match' }),
      entry('tactics.complete', { category: 'tactics', progress: { id: 'tactics.complete', value: 10, target: 10, complete: true, claimedAt: 1 } }),
      entry('mastery.locked', { category: 'mastery', locked: true }),
    ];
    expect(missionBrowserView(rows, ALL).filtered.map(row => row.id)).toEqual([
      'combat.root', 'combat.child', 'economy.match', 'tactics.complete', 'mastery.locked',
    ]);
    expect(missionBrowserView(rows, { category: 'all', scope: 'match', state: 'all' }).filtered.map(row => row.id)).toEqual(['economy.match']);
    expect(missionBrowserView(rows, { category: 'all', scope: 'all', state: 'complete' }).filtered.map(row => row.id)).toEqual(['tactics.complete']);
    expect(missionBrowserView(rows, { category: 'mastery', scope: 'profile', state: 'locked' }).filtered.map(row => row.id)).toEqual(['mastery.locked']);
  });

  it('retains a matching selection, otherwise chooses active then first, and clamps page requests', () => {
    const rows = Array.from({ length: 12 }, (_, index) => entry(`combat.${index}`, {
      locked: index === 0,
      progress: { id: `combat.${index}`, value: index === 1 ? 10 : 0, target: 10, complete: index === 1, claimedAt: index === 1 ? 1 : null },
    }));
    expect(missionBrowserView(rows, ALL).selected?.id).toBe('combat.2');
    expect(missionBrowserView(rows, ALL, 'combat.8').selected?.id).toBe('combat.8');
    const high = missionBrowserView(rows, ALL, 'combat.2', 99);
    expect(high.page).toBe(2);
    expect(high.selected?.id).toBe('combat.10');
    const low = missionBrowserView(rows, ALL, 'combat.8', -4);
    expect(low.page).toBe(0);
    expect(low.selected?.id).toBe('combat.0');
    const filteredOut = missionBrowserView(rows, { category: 'economy', scope: 'all', state: 'all' }, 'combat.8');
    expect(filteredOut).toMatchObject({ page: 0, pages: 1, selected: null, visible: [] });
  });
});

describe('MissionsPanel browser DOM', () => {
  it('renders static category/scope/state filters, a five-row master list, one detail and no credit reward', () => {
    const rows = Array.from({ length: 6 }, (_, index) => entry(`combat.${index}`, {
      reward: index === 0 ? [{ kind: 'credits', amount: 500 }] : [{ kind: 'unlock', unlockId: `unit.${index}` }],
    }));
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider(rows) });
    const root = panel.root as unknown as Node;
    expect(root.querySelectorAll('.vm-missions-jump')).toHaveLength(6);
    expect(root.querySelectorAll('SELECT')).toHaveLength(2);
    expect(root.querySelectorAll('.vm-mission-row')).toHaveLength(MISSION_PAGE_SIZE);
    expect(root.querySelectorAll('.vm-mission-detail')).toHaveLength(1);
    expect(root.querySelector('.vm-mission-detail')!.textContent).toContain('combat.0 description');
    expect(root.querySelector('.vm-mission-detail')!.textContent).not.toContain('Completion recorded');
    expect(root.querySelector('.vm-mission-row')!.textContent).toContain('Career objective');
    expect(root.textContent).not.toContain('500');
    expect(root.querySelectorAll('.vm-mission-row').map(row => row.dataset.missionId)).toEqual(rows.slice(0, 5).map(row => row.id));
  });

  it('keeps focus through provider refreshes, subscribes once, and tears down the subscription', () => {
    const rows = Array.from({ length: 7 }, (_, index) => entry(`combat.${index}`));
    const p = provider(rows);
    const panel = new MissionsPanel({ onClose: () => {}, progression: p });
    const root = panel.root as unknown as Node;
    const row = root.querySelectorAll('.vm-mission-row')[2];
    root.querySelector('.vm-mission-list')!.scrollTop = 81;
    row.focus();
    expect((panel as unknown as { body: Node }).body.contains(row)).toBe(true);
    expect(documentStub.activeElement?.dataset.missionFocus).toBe('row:combat.2');
    p.emit();
    expect(documentStub.activeElement?.dataset.missionFocus).toBe('row:combat.2');
    expect(root.querySelector('.vm-mission-list')!.scrollTop).toBe(81);
    panel.dispose();
    expect(p.off).toHaveBeenCalledOnce();
  });

  it('falls forward when an active filter refresh completes the selected mission', () => {
    const rows = [entry('combat.first'), entry('combat.second')];
    const p = provider(rows);
    const panel = new MissionsPanel({ onClose: () => {}, progression: p });
    const root = panel.root as unknown as Node;
    const state = root.querySelectorAll('SELECT')[1];
    state.value = 'active';
    state.dispatch('change');
    expect(root.querySelector('.vm-mission-detail')!.textContent).toContain('combat.first description');

    rows[0].progress.complete = true;
    rows[0].progress.value = rows[0].progress.target;
    p.emit();
    expect(root.querySelectorAll('.vm-mission-row').map(row => row.dataset.missionId)).toEqual(['combat.second']);
    expect(root.querySelector('.vm-mission-detail')!.textContent).toContain('combat.second description');
  });

  it('leaves native picker Home/End alone while list Home/End and paging select rows', () => {
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider(Array.from({ length: 7 }, (_, i) => entry(`combat.${i}`))) });
    const root = panel.root as unknown as Node;
    const picker = root.querySelectorAll('SELECT')[0];
    expect(panel.onKeyDown(key('Home', picker))).toBe(false);
    const first = root.querySelectorAll('.vm-mission-row')[0];
    expect(panel.onKeyDown(key('PageDown', first))).toBe(true);
    expect(root.querySelectorAll('.vm-mission-row').filter(row => row.getAttribute('aria-pressed') === 'true')[0].dataset.missionId).toBe('combat.5');
    const paged = root.querySelectorAll('.vm-mission-row')[0];
    expect(panel.onKeyDown(key('Home', paged))).toBe(true);
    const home = root.querySelectorAll('.vm-mission-row')[0];
    expect(home.dataset.missionId).toBe('combat.0');
    expect(panel.onKeyDown(key('End', home))).toBe(true);
    expect(root.querySelectorAll('.vm-mission-row').filter(row => row.getAttribute('aria-pressed') === 'true')[0].dataset.missionId).toBe('combat.6');
  });

  it('pages through the bounded real list and makes a page change select its first visible mission', () => {
    const rows = Array.from({ length: 7 }, (_, index) => entry(`combat.${index}`));
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider(rows) });
    const root = panel.root as unknown as Node;
    const next = root.querySelectorAll('BUTTON').find(button => button.textContent === 'Next');
    expect(next).toBeTruthy();
    root.querySelector('.vm-mission-list')!.scrollTop = 96;
    next!.click();
    const visible = root.querySelectorAll('.vm-mission-row');
    expect(visible.map(row => row.dataset.missionId)).toEqual(['combat.5', 'combat.6']);
    expect(visible.filter(row => row.getAttribute('aria-pressed') === 'true').map(row => row.dataset.missionId)).toEqual(['combat.5']);
    expect(root.querySelector('.vm-missions-page-count')!.textContent).toBe('6–7 / 7');
    expect(root.querySelector('.vm-mission-list')!.scrollTop).toBe(0);
    expect(root.querySelectorAll('BUTTON').find(button => button.textContent === 'Next')!.disabled).toBe(true);
  });

  it('uses the back-to-list control for the compact reading state without adding a second exit', () => {
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider([entry('combat.one'), entry('combat.two')]) });
    const root = panel.root as unknown as Node;
    root.querySelectorAll('.vm-mission-row')[1].click();
    const back = root.querySelectorAll('BUTTON').find(button => button.textContent === 'Back to list');
    expect(back).toBeTruthy();
    expect(documentStub.activeElement).toBe(back);
    back!.click();
    expect(documentStub.activeElement?.dataset.missionFocus).toBe('row:combat.two');
    expect(root.querySelectorAll('BUTTON').filter(button => button.textContent === 'Close')).toHaveLength(0);
  });

  it('keeps offline, unreadable, empty-catalogue and empty-filter states distinct', () => {
    const offline = new MissionsPanel({ onClose: () => {}, progression: null }).root as unknown as Node;
    expect(offline.textContent).toContain('Progression offline');
    expect(offline.textContent).toContain('Progression is not running');

    const broken = provider([]);
    broken.catalogue = () => { throw new Error('disk read failed'); };
    const unreadable = new MissionsPanel({ onClose: () => {}, progression: broken }).root as unknown as Node;
    expect(unreadable.textContent).toContain('Profile unreadable');
    expect(unreadable.textContent).toContain('profile could not be read');

    const empty = new MissionsPanel({ onClose: () => {}, progression: provider([]) }).root as unknown as Node;
    expect(empty.textContent).toContain('No missions authored yet');

    const filtered = new MissionsPanel({ onClose: () => {}, progression: provider([entry('combat.active')]) }).root as unknown as Node;
    const state = filtered.querySelectorAll('SELECT')[1];
    state.value = 'locked';
    state.dispatch('change');
    expect(filtered.textContent).toContain('No matching missions');
    expect(filtered.textContent).toContain('Show all missions');
  });

  it('Show all missions resets category and both native selects before repopulating the browser', () => {
    const rows = [
      entry('combat.profile'),
      entry('economy.match.locked', { category: 'economy', scope: 'match', locked: true }),
    ];
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider(rows) });
    const root = panel.root as unknown as Node;
    root.querySelectorAll('BUTTON').find(button => button.textContent.includes('Economy'))!.click();
    const [scope, state] = root.querySelectorAll('SELECT');
    scope.value = 'profile';
    scope.dispatch('change');
    expect(root.textContent).toContain('No matching missions');
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Show all missions')!.click();
    expect(scope.value).toBe('all');
    expect(state.value).toBe('all');
    expect(root.querySelectorAll('.vm-missions-jump').find(button => button.textContent.includes('All missions'))!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.vm-mission-row').map(row => row.dataset.missionId)).toEqual(['combat.profile', 'economy.match.locked']);
  });

  it('shows the selected mission progress bar and names a prerequisite from another category', () => {
    const rows = [
      entry('combat.parent', { title: 'Secure the bridge' }),
      entry('economy.child', {
        category: 'economy', title: 'Fund the offensive', requires: ['combat.parent'],
        progress: { id: 'economy.child', value: 4, target: 8, complete: false, claimedAt: null },
      }),
    ];
    const panel = new MissionsPanel({ onClose: () => {}, progression: provider(rows) });
    const root = panel.root as unknown as Node;
    root.querySelectorAll('BUTTON').find(button => button.textContent.includes('Economy'))!.click();
    expect(root.querySelector('.vm-mission-detail')!.textContent).toContain('Follows Secure the bridge');
    expect(root.querySelector('.vm-mission-fill')!.style.width).toBe('50.0%');
    expect(root.querySelector('.vm-mission-value')!.textContent).toBe('4 / 8');
  });

  it('unsubscribes an injected provider before subscribing to its replacement', () => {
    const first = provider([entry('combat.first')]);
    const second = provider([entry('combat.second')]);
    const panel = new MissionsPanel({ onClose: () => {}, progression: first });
    panel.setProgression(second);
    expect(first.off).toHaveBeenCalledOnce();
    panel.dispose();
    expect(second.off).toHaveBeenCalledOnce();
  });
});

describe('MissionsScreen wrapper', () => {
  it('keeps Escape/back as the one shared route and disposes a nested panel host', () => {
    const showMenu = vi.fn();
    const screen = new MissionsScreen({ showMenu } as never);
    const host = new Node('DIV');
    vi.stubGlobal('__vmProgression', provider([entry('combat.one')]));
    screen.mount(host as unknown as HTMLElement);
    expect(host.classList.contains('vm-page')).toBe(true);
    expect(screen.onBack()).toBe(true);
    expect(showMenu).toHaveBeenCalledOnce();
    screen.unmount();
    expect(host.classList.contains('vm-page')).toBe(false);
  });
});

/**
 * Service Record browser regression coverage. Vitest runs in Node, so this
 * deliberately models only the narrow DOM/focus surface used by ProfileScreen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MISSIONS, UNLOCKS } from '../src/data/Missions';
import {
  HONOURS_PAGE_SIZE,
  ProfileScreen,
  cosmeticCollection,
  honoursBrowserView,
} from '../src/shell/Profile';
import type { CatalogueEntry, ProfileView, ProgressionView } from '../src/ui/Objectives';

type Listener = (event?: { preventDefault(): void }) => void;

class Classes {
  private readonly names = new Set<string>();
  add(...values: string[]): void { values.filter(Boolean).forEach(value => this.names.add(value)); }
  remove(...values: string[]): void { values.forEach(value => this.names.delete(value)); }
  contains(value: string): boolean { return this.names.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(value); if (on) this.names.add(value); else this.names.delete(value); return on;
  }
  get value(): string { return [...this.names].join(' '); }
  set value(value: string) { this.names.clear(); this.add(...value.split(/\s+/)); }
}

class Node {
  readonly children: Node[] = [];
  readonly classList = new Classes();
  readonly attrs = new Map<string, string>();
  readonly events = new Map<string, Listener[]>();
  readonly style = { setProperty: () => {} } as Record<string, unknown> & { setProperty(name: string, value: string): void };
  readonly dataset: Record<string, string>;
  parentElement: Node | null = null;
  private text = '';
  value = ''; type = ''; id = ''; title = ''; hidden = false; scrollTop = 0; scrollHeight = 400; clientHeight = 400;
  selectionStart: number | null = 0; selectionEnd: number | null = 0;
  constructor(readonly tagName: string) {
    this.dataset = new Proxy<Record<string, string>>({}, { set: (target, key, value) => {
      const attr = `data-${String(key).replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
      target[String(key)] = String(value); this.attrs.set(attr, String(value)); return true;
    } });
  }
  get className(): string { return this.classList.value; }
  set className(value: string) { this.classList.value = value; }
  get textContent(): string { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; }
  set textContent(value: string) { this.children.length = 0; this.text = value; }
  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(value: boolean) { if (value) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get tabIndex(): number { return Number(this.attrs.get('tabindex') ?? -1); }
  set tabIndex(value: number) { this.attrs.set('tabindex', String(value)); }
  get offsetParent(): Node | null { return this.hidden ? null : this; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); if (name === 'id') this.id = value; }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  appendChild<T extends Node>(child: T): T { child.parentElement?.removeChild(child); child.parentElement = this; this.children.push(child); return child; }
  append(...nodes: Node[]): void { nodes.forEach(node => this.appendChild(node)); }
  insertBefore<T extends Node>(child: T, before: Node | null): T { child.parentElement?.removeChild(child); child.parentElement = this; const index = before === null ? -1 : this.children.indexOf(before); if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); return child; }
  removeChild(child: Node): void { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentElement = null; }
  replaceChildren(...nodes: Node[]): void { this.children.forEach(child => { child.parentElement = null; }); this.children.length = 0; this.text = ''; this.append(...nodes); }
  addEventListener(type: string, listener: Listener): void { const all = this.events.get(type) ?? []; all.push(listener); this.events.set(type, all); }
  dispatch(type: string): void { this.events.get(type)?.forEach(listener => listener({ preventDefault() {} })); }
  click(): void { if (!this.disabled) this.dispatch('click'); }
  focus(_options?: unknown): void { documentStub.activeElement = this; }
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }
  scrollIntoView(): void {}
  contains(node: unknown): boolean { return node === this || this.descendants().includes(node as Node); }
  querySelector<T extends Node = Node>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null; }
  querySelectorAll<T extends Node = Node>(selector: string): T[] { return this.descendants().filter(node => node.matches(selector)) as T[]; }
  private descendants(): Node[] { const out: Node[] = []; const walk = (node: Node) => node.children.forEach(child => { out.push(child); walk(child); }); walk(this); return out; }
  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('[')) return this.hasAttribute(selector.slice(1, -1));
    return this.tagName === selector.toUpperCase();
  }
}

const documentStub = {
  activeElement: null as Node | null,
  createElement: (tag: string) => new Node(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string) => new Node(tag.toUpperCase()),
  addEventListener: () => {}, removeEventListener: () => {},
};

beforeEach(() => { documentStub.activeElement = null; vi.stubGlobal('document', documentStub); });
afterEach(() => { vi.unstubAllGlobals(); });

function catalogue(): CatalogueEntry[] {
  return MISSIONS.map(mission => ({ ...mission, locked: false, progress: {
    id: mission.id, value: 0, target: mission.target, complete: false, claimedAt: null,
  } }));
}

function profile(): ProfileView {
  return { version: 4, createdAt: 1, updatedAt: 2, unlocked: [UNLOCKS.insigniaGold], missions: [], campaign: {}, stats: {
    matchesPlayed: 8, wins: 5, losses: 3, currentStreak: 2, bestStreak: 4, winsByFaction: {},
  } };
}

function provider(rows = catalogue()): ProgressionView & { emit(): void; off: ReturnType<typeof vi.fn> } {
  let subscriber: (() => void) | undefined;
  const off = vi.fn();
  return {
    profile, catalogue: () => rows, activeObjectives: () => [], drainPending: () => [], isUnlocked: () => false,
    subscribe: listener => { subscriber = listener; return off; }, resetProfile: () => {}, exportProfile: () => '', importProfile: () => false,
    emit: () => subscriber?.(), off,
  };
}

function shell() {
  const patch = vi.fn();
  return {
    settings: { get: () => ({ gameplay: { commanderName: 'Ash' } }), patch },
    openMissions: vi.fn(), openCampaign: vi.fn(), showMenu: vi.fn(), patch,
  };
}

function mount(p: ProgressionView | null = provider()) {
  const s = shell(); const screen = new ProfileScreen(s as never, p); const host = new Node('DIV'); screen.mount(host as never);
  return { screen, root: host, shell: s };
}

describe('honoursBrowserView', () => {
  it('reaches all 17 reward-derived cosmetics exactly once in six-item pages and clamps selection/page', () => {
    const collection = cosmeticCollection(catalogue(), profile().unlocked);
    const first = honoursBrowserView(collection);
    expect(HONOURS_PAGE_SIZE).toBe(6);
    expect(first.filtered).toHaveLength(17);
    const ids = Array.from({ length: first.pages }, (_, page) => honoursBrowserView(collection, 'all', 'all', null, page).visible.map(award => award.id)).flat();
    expect(ids).toHaveLength(17); expect(new Set(ids).size).toBe(17); expect(ids).toEqual(collection.map(award => award.id));
    // A requested page wins over the old selection; the selected detail must
    // clamp into the requested visible page rather than point at an off-page row.
    const high = honoursBrowserView(collection, 'all', 'all', collection[0]!.id, 99);
    expect(high.page).toBe(first.pages - 1); expect(high.selected).toBe(high.visible[0]);
    expect(honoursBrowserView(collection, 'all', 'all', 'missing', -3)).toMatchObject({ page: 0, selected: { id: ids[0] } });
  });

  it('filters by cosmetic kind and real ownership without turning rewards into credits', () => {
    const collection = cosmeticCollection(catalogue(), profile().unlocked);
    const earned = honoursBrowserView(collection, 'all', 'earned');
    const lockedDecals = honoursBrowserView(collection, 'decal', 'locked');
    expect(earned.filtered).toEqual(expect.arrayContaining([expect.objectContaining({ id: UNLOCKS.insigniaGold, earned: true })]));
    expect(lockedDecals.filtered).toSatisfy((awards: typeof collection) => awards.every(award => award.kind === 'decal' && !award.earned));
    expect(collection.map(award => award.id)).not.toContain('credits');
  });
});

describe('Service Record browser DOM', () => {
  it('renders one section at a time: factual overview, bounded faction record, and route actions', () => {
    const { root, shell: s } = mount();
    expect(root.querySelector('.vm-record-sections')!.getAttribute('aria-label')).toBe('Service Record sections');
    expect(root.querySelectorAll('BUTTON').filter(button => ['Overview', 'Honours', 'Identity'].includes(button.textContent)).map(button => button.textContent)).toEqual(['Overview', 'Honours', 'Identity']);
    expect(root.querySelectorAll('.vm-record-stats')).toHaveLength(1);
    expect(root.querySelectorAll('.vm-profile-stat')).toHaveLength(6);
    expect(root.querySelectorAll('.vm-record-faction')).toHaveLength(4);
    expect(root.querySelectorAll('.vm-record-award')).toHaveLength(0);
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'View Missions')!.click();
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'View Operations')!.click();
    expect(s.openMissions).toHaveBeenCalledWith('profile'); expect(s.openCampaign).toHaveBeenCalledOnce();
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Honours')!.click();
    expect(root.querySelectorAll('.vm-record-stats')).toHaveLength(0);
    expect(root.querySelectorAll('.vm-record-award')).toHaveLength(HONOURS_PAGE_SIZE);
    expect(root.querySelectorAll('.vm-record-award-detail')).toHaveLength(1);
  });

  it('keeps the identity editor live offline and on profile failure, including valid/invalid submission', () => {
    const offline = mount(null);
    expect(offline.root.textContent).toContain('Loading service record');
    offline.root.querySelectorAll('BUTTON').find(button => button.textContent === 'Edit identity')!.click();
    const input = offline.root.querySelector('.vm-profile-name-input')!;
    input.value = '   '; offline.root.querySelector('.vm-profile-editor')!.dispatch('submit');
    expect(input.getAttribute('aria-invalid')).toBe('true'); expect(offline.shell.patch).not.toHaveBeenCalled();
    input.value = 'Nova'; offline.root.querySelector('.vm-profile-editor')!.dispatch('submit');
    expect(offline.shell.patch).toHaveBeenCalledWith({ gameplay: { commanderName: 'Nova' } });
    expect(input.value).toBe('Nova');

    const broken = provider(); broken.profile = () => { throw new Error('broken'); };
    const failing = mount(broken); expect(failing.root.textContent).toContain('Service record unreadable');
    failing.root.querySelectorAll('BUTTON').find(button => button.textContent === 'Edit identity')!.click();
    expect(failing.root.querySelector('.vm-profile-name-input')).toBeTruthy();
    offline.screen.unmount();
    failing.screen.unmount();
  });

  it('preserves an unsaved identity draft, caret and focus through provider updates and section changes, then unsubscribes', () => {
    const p = provider(); const { screen, root } = mount(p);
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Identity')!.click();
    const editorInput = root.querySelector('.vm-profile-name-input')!; editorInput.value = 'Draft Commander'; editorInput.setSelectionRange(3, 8); editorInput.focus();
    p.emit();
    expect(root.querySelector('.vm-profile-name-input')).toBe(editorInput);
    expect(documentStub.activeElement).toBe(editorInput); expect(editorInput.selectionStart).toBe(3); expect(editorInput.selectionEnd).toBe(8);
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Overview')!.click();
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Identity')!.click();
    expect(root.querySelector('.vm-profile-name-input')).toBe(editorInput); expect(editorInput.value).toBe('Draft Commander');
    screen.unmount(); expect(p.off).toHaveBeenCalledOnce();
  });

  it('offers narrow reading return routing and honours filters without duplicate award cards', () => {
    const { root } = mount();
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Honours')!.click();
    const first = root.querySelector('.vm-record-award')!; first.click();
    const back = root.querySelectorAll('BUTTON').find(button => button.textContent === 'Back to honours')!;
    expect(back).toBeTruthy(); expect(documentStub.activeElement).toBe(back);
    back.click(); expect(documentStub.activeElement?.dataset.awardId).toBe(first.dataset.awardId);
    const [kind, ownership] = root.querySelectorAll('SELECT'); kind.value = 'decal'; kind.dispatch('change'); ownership.value = 'locked'; ownership.dispatch('change');
    const shown = root.querySelectorAll('.vm-record-award');
    expect(shown.length).toBeLessThanOrEqual(HONOURS_PAGE_SIZE); expect(shown.every(card => card.textContent.includes('Not earned'))).toBe(true);
  });

  it('keeps completed-but-unclaimed honours unowned while rendering their debrief status and completed progress', () => {
    const rows = catalogue();
    const pendingMission = rows.find(mission => mission.reward.some(reward => reward.kind === 'cosmetic'))!;
    pendingMission.progress = { ...pendingMission.progress, value: pendingMission.target, complete: true, claimedAt: null };
    const p = provider(rows); p.profile = () => ({ ...profile(), unlocked: [] });
    const pending = cosmeticCollection(rows, p.profile().unlocked).find(award => award.complete && !award.earned)!;
    expect(pending).toMatchObject({ earned: false, complete: true, claimedAt: null });

    const { root } = mount(p); root.querySelectorAll('BUTTON').find(button => button.textContent === 'Honours')!.click();
    for (let page = 0; page < 3 && root.querySelectorAll('.vm-record-award').every(card => card.dataset.awardId !== pending.id); page++) {
      root.querySelectorAll('BUTTON').find(button => button.textContent === 'Next')!.click();
    }
    const card = root.querySelectorAll('.vm-record-award').find(item => item.dataset.awardId === pending.id)!;
    expect(card.textContent).toContain('Awaiting debrief'); card.click();
    const progress = root.querySelector('.vm-record-progress')!;
    expect(root.querySelector('.vm-record-award-status')!.textContent).toBe('Awaiting debrief');
    expect(progress.getAttribute('aria-valuenow')).toBe('100');
    expect(progress.getAttribute('aria-valuetext')).toBe('Awaiting debrief');
    expect(root.querySelector('.vm-record-award-detail')!.textContent).not.toContain('Awarded ');
  });

  it('preserves honours selection and focused controls on refresh, while resetting list scroll for a new page', () => {
    const p = provider(); const { root } = mount(p);
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Honours')!.click();
    const list = root.querySelector('.vm-record-award-list')!; const tile = root.querySelector('.vm-record-award')!;
    list.scrollTop = 71; tile.focus(); p.emit();
    expect(root.querySelector('.vm-record-award-list')!.scrollTop).toBe(71);
    expect(documentStub.activeElement?.dataset.awardId).toBe(tile.dataset.awardId);

    tile.click(); const selectedName = root.querySelector('.vm-record-award-name')!.textContent; p.emit();
    expect(root.querySelector('.vm-record-award-name')!.textContent).toBe(selectedName);
    expect(documentStub.activeElement?.textContent).toBe('Back to honours');
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Back to honours')!.click();
    const next = root.querySelectorAll('BUTTON').find(button => button.textContent === 'Next')!;
    next.focus(); root.querySelector('.vm-record-award-list')!.scrollTop = 91; next.click();
    expect(root.querySelector('.vm-record-award-list')!.scrollTop).toBe(0);
    expect(documentStub.activeElement?.textContent).toBe('Next');
    expect(root.querySelectorAll('.vm-record-award').filter(card => card.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    p.emit(); expect(documentStub.activeElement?.textContent).toBe('Next');
  });

  it('resets both filters through Show all honours and never consumes native input/select paging keys', () => {
    const { screen, root } = mount();
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Identity')!.click();
    const input = root.querySelector('.vm-profile-name-input')!;
    expect(screen.onKeyDown({ code: 'Home', target: input } as unknown as KeyboardEvent)).toBe(false);
    expect(screen.onKeyDown({ code: 'PageDown', target: input } as unknown as KeyboardEvent)).toBe(false);
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Honours')!.click();
    const [kind, ownership] = root.querySelectorAll('SELECT');
    kind.value = 'decal'; kind.dispatch('change'); ownership.value = 'earned'; ownership.dispatch('change');
    expect(root.textContent).toContain('No matching honours');
    root.querySelectorAll('BUTTON').find(button => button.textContent === 'Show all honours')!.click();
    expect(kind.value).toBe('all'); expect(ownership.value).toBe('all');
    expect(root.querySelectorAll('.vm-record-award')).toHaveLength(HONOURS_PAGE_SIZE);
    expect(screen.onKeyDown({ code: 'End', target: kind } as unknown as KeyboardEvent)).toBe(false);
  });
});

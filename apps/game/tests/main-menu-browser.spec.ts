/**
 * Title-menu DOM regression coverage.  Vitest runs this in Node, so this is a
 * deliberately narrow element tree rather than a layout or screenshot fake.
 * It drives MainMenuScreen itself: the important claims are its controls,
 * callbacks and teardown, not a duplicate menu implementation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  desktop: false,
  tutorialComplete: false,
  tutorialFresh: true,
  saves: 0,
  relayKnown: null as boolean | null,
  probe: null as Promise<boolean> | null,
  playMenuMusic: vi.fn(),
  musicControls: [] as { dispose: ReturnType<typeof vi.fn> }[],
}));

vi.mock('../src/shell/Tutorial', () => ({
  tutorialCompleted: () => state.tutorialComplete,
  tutorialUntouched: () => state.tutorialFresh,
  tutorialMenuHint: () => 'Learn the command school',
}));
vi.mock('../src/shell/LoadGame', () => ({ saveSlots: () => Array.from({ length: state.saves }) }));
vi.mock('../src/shell/net-link', () => ({
  unavailableReason: () => '',
  relayKnownReachable: () => state.relayKnown,
  probeRelay: () => state.probe ?? Promise.resolve(false),
}));
vi.mock('../src/audio/AudioEngine', () => ({ audio: () => ({ playMenuMusic: state.playMenuMusic }) }));
vi.mock('../src/shell/MusicControl', () => ({
  MusicControl: class {
    readonly root = document.createElement('section');
    readonly dispose = vi.fn();
    constructor(_context: 'menu' | 'pause') { state.musicControls.push(this); }
  },
}));
vi.mock('../src/platform/desktop', () => ({ desktopBridge: () => state.desktop ? {} : null }));
vi.mock('../src/shell/settings-store', () => ({ MAPS: ['one', 'two'] }));
vi.mock('../src/shell/CampaignPresentation', () => ({ CAMPAIGN_OPERATION_COUNT: 3, CAMPAIGN_OPERATION_IDS: ['a', 'b', 'c'] }));
vi.mock('../src/shell/progression-link', () => ({ readProgression: () => null }));
vi.mock('../src/render/backend', () => ({ requestedBackend: () => 'webgpu' }));
vi.mock('../src/net/protocol', async importOriginal => ({
  ...await importOriginal<typeof import('../src/net/protocol')>(),
  normalizeCommanderName: (name: string) => name.trim() || null,
}));

import { MainMenuScreen } from '../src/shell/MainMenu';
import type { Shell } from '../src/shell/Shell';

type Handler = () => void;

class Classes {
  private readonly names = new Set<string>();
  add(...names: string[]): void { names.filter(Boolean).forEach(name => this.names.add(name)); }
  remove(...names: string[]): void { names.forEach(name => this.names.delete(name)); }
  contains(name: string): boolean { return this.names.has(name); }
  get value(): string { return [...this.names].join(' '); }
  set value(value: string) { this.names.clear(); this.add(...value.split(/\s+/)); }
}

class Node {
  readonly children: Node[] = [];
  readonly classList = new Classes();
  readonly attrs = new Map<string, string>();
  readonly events = new Map<string, Handler[]>();
  parentElement: Node | null = null;
  private ownText = '';
  type = ''; href = ''; target = ''; rel = ''; src = ''; alt = ''; width = 0; height = 0;

  constructor(readonly tagName: string) {}
  get firstChild(): Node | null { return this.children[0] ?? null; }
  get className(): string { return this.classList.value; }
  set className(value: string) { this.classList.value = value; }
  get textContent(): string { return this.children.length ? this.children.map(child => child.textContent).join('') : this.ownText; }
  set textContent(value: string) { this.children.length = 0; this.ownText = value; }
  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(value: boolean) { if (value) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get tabIndex(): number { return Number(this.attrs.get('tabindex') ?? -1); }
  set tabIndex(value: number) { this.attrs.set('tabindex', String(value)); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  appendChild<T extends Node>(child: T): T { child.parentElement?.removeChild(child); child.parentElement = this; this.children.push(child); return child; }
  append(...children: Node[]): void { children.forEach(child => this.appendChild(child)); }
  prepend(...children: Node[]): void { children.reverse().forEach(child => { child.parentElement?.removeChild(child); child.parentElement = this; this.children.unshift(child); }); }
  insertBefore<T extends Node>(child: T, before: Node | null): T {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child: Node): void { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentElement = null; }
  addEventListener(type: string, handler: Handler): void { this.events.set(type, [...(this.events.get(type) ?? []), handler]); }
  click(): void { if (!this.disabled) this.events.get('click')?.forEach(handler => handler()); }
  querySelector<T extends Node = Node>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null; }
  querySelectorAll<T extends Node = Node>(selector: string): T[] { return this.descendants().filter(node => node.matches(selector)) as T[]; }
  private descendants(): Node[] { const out: Node[] = []; const visit = (node: Node) => node.children.forEach(child => { out.push(child); visit(child); }); visit(this); return out; }
  private matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) return this.hasAttribute(selector.slice(1, -1));
    return this.tagName === selector.toUpperCase();
  }
}

const documentStub = {
  createElement: (tag: string) => new Node(tag.toUpperCase()),
  createElementNS: (_namespace: string, tag: string) => new Node(tag.toUpperCase()),
};

const titleCss = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'shell.css'), 'utf8');

function controls(root: Node): Map<string, Node> {
  return new Map(root.querySelectorAll('BUTTON').flatMap(button => {
    const label = button.querySelector('.vm-btn-label');
    return label === null ? [] : [[label.textContent, button] as const];
  }));
}

function shell() {
  return {
    settings: { get: () => ({ gameplay: { commanderName: 'Nova' } }) },
    openProfile: vi.fn(), openSettings: vi.fn(), openQuitConfirmation: vi.fn(),
    openTutorialConfirmation: vi.fn(), openCampaign: vi.fn(), openSetup: vi.fn(),
    openMultiplayer: vi.fn(), openLoadGame: vi.fn(), openReplays: vi.fn(),
    latestReplay: () => null,
  };
}

function mount() {
  const s = shell();
  const root = new Node('DIV');
  const screen = new MainMenuScreen(s as unknown as Shell);
  screen.mount(root as unknown as HTMLElement);
  return { s, root, screen };
}

async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => {
  state.desktop = false; state.tutorialComplete = false; state.tutorialFresh = true;
  state.saves = 0; state.relayKnown = true; state.probe = null;
  state.playMenuMusic.mockReset(); state.musicControls.length = 0;
  vi.stubGlobal('document', documentStub);
});
afterEach(() => vi.unstubAllGlobals());

describe('title menu browser DOM', () => {
  it('keeps the logo outside the scroll clip while the play list owns desktop overflow', () => {
    const inner = [...titleCss.matchAll(/\.vm-shell \.vm-menu-inner\s*\{(?<body>[^}]*)\}/g)]
      .map(match => match.groups?.body ?? '')
      .find(rule => rule.includes('overflow: visible;'));
    expect(inner).toContain('min-height: 0;');
    expect(inner).toContain('overflow: visible;');

    const play = titleCss.match(/\.vm-shell \.vm-cinematic-play\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    expect(play).toContain('min-height: 0;');
    expect(play).toContain('overflow-y: auto;');
  });

  it('keeps one focusable Service Record identity control and no duplicate profile utility', () => {
    const { root, s } = mount();
    const identity = root.querySelectorAll('.vm-cinematic-identity');
    expect(identity).toHaveLength(1);
    expect(identity[0]!.getAttribute('aria-label')).toBe('Open Service Record');
    expect(identity[0]!.hasAttribute('data-vm-focus')).toBe(true);
    expect(identity[0]!.tabIndex).toBe(0);
    expect([...controls(root).keys()]).not.toContain('Profile');
    identity[0]!.click();
    expect(s.openProfile).toHaveBeenCalledOnce();
  });

  it('shows Quit only through the desktop confirmation path', () => {
    expect(controls(mount().root).has('Quit')).toBe(false);
    state.desktop = true;
    const { root, s } = mount();
    controls(root).get('Quit')!.click();
    expect(s.openQuitConfirmation).toHaveBeenCalledOnce();
  });

  it('prioritises an untouched tutorial, then removes it after completion', () => {
    const fresh = mount();
    expect(controls(fresh.root).get('Tutorial')!.classList.contains('is-primary')).toBe(true);
    controls(fresh.root).get('Tutorial')!.click();
    expect(fresh.s.openTutorialConfirmation).toHaveBeenCalledOnce();

    state.tutorialFresh = false; state.tutorialComplete = true;
    const returned = mount();
    expect(controls(returned.root).has('Tutorial')).toBe(false);
    expect(controls(returned.root).get('Campaign')!.classList.contains('is-feature')).toBe(true);
  });

  it('dispatches every title route to its owning shell action', () => {
    const { root, s } = mount();
    const buttons = controls(root);
    buttons.get('Campaign')!.click(); buttons.get('Skirmish')!.click();
    buttons.get('Replays')!.click(); buttons.get('Settings')!.click(); buttons.get('News & Events')!.click();
    expect(s.openCampaign).toHaveBeenCalledOnce();
    expect(s.openSetup).toHaveBeenCalledOnce();
    expect(s.openReplays).toHaveBeenCalledOnce();
    expect(s.openSettings).toHaveBeenNthCalledWith(1, 'menu');
    expect(s.openSettings).toHaveBeenNthCalledWith(2, 'menu', 'updates');
  });

  it('keeps Load Game disabled, unfocusable, and explicit when the save index is empty', () => {
    const load = controls(mount().root).get('Load Game')!;
    expect(load.disabled).toBe(true);
    expect(load.tabIndex).toBe(-1);
    expect(load.hasAttribute('data-vm-focus')).toBe(false);
    expect(load.textContent).toContain('No saves');
  });

  it('restores relay focusability only for the current menu and ignores an old screen callback', async () => {
    let resolveOld!: (value: boolean) => void;
    state.relayKnown = null; state.probe = new Promise(resolve => { resolveOld = resolve; });
    const old = mount();
    const oldButton = controls(old.root).get('Multiplayer')!;
    expect(oldButton.disabled).toBe(true); expect(oldButton.tabIndex).toBe(-1);
    old.screen.unmount(); resolveOld(true); await settle();
    expect(oldButton.disabled).toBe(true);

    let resolveCurrent!: (value: boolean) => void;
    state.probe = new Promise(resolve => { resolveCurrent = resolve; });
    const current = mount();
    const multiplayer = controls(current.root).get('Multiplayer')!;
    resolveCurrent(true); await settle();
    expect(multiplayer.disabled).toBe(false);
    expect(multiplayer.tabIndex).toBe(0);
    expect(multiplayer.hasAttribute('data-vm-focus')).toBe(true);
    multiplayer.click();
    expect(current.s.openMultiplayer).toHaveBeenCalledOnce();
  });

  it('disposes the title music control when the screen unmounts', () => {
    const { screen } = mount();
    expect(state.playMenuMusic).toHaveBeenCalledOnce();
    expect(state.musicControls).toHaveLength(1);
    screen.unmount();
    expect(state.musicControls[0]!.dispose).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_ROUTES, FocusRing, mountCommandNavigation, setAdjust, Shell, showsCommandNavigation, updateCommandSection, type CommandRoute, type Screen, type ShellState } from '../src/shell/Shell';

afterEach(() => vi.unstubAllGlobals());

it('keyboard activation and adjustment follow real focus, not a stale gamepad index', () => {
  const doc = { activeElement: null as unknown };
  const control = () => ({
    offsetParent: {}, hasAttribute: () => false, closest: () => null,
    classList: { add: vi.fn(), remove: vi.fn() }, click: vi.fn(),
    focus() { doc.activeElement = this; },
  });
  const first = control();
  const second = control();
  const root = { querySelectorAll: () => [first, second], contains: (node: unknown) => node === first || node === second };
  vi.stubGlobal('document', doc);
  const ring = new FocusRing(root as unknown as HTMLElement);
  const adjustFirst = vi.fn();
  const adjustSecond = vi.fn();
  setAdjust(first as unknown as HTMLElement, adjustFirst);
  setAdjust(second as unknown as HTMLElement, adjustSecond);
  ring.focusFirst();
  doc.activeElement = second; // A click or Tab, outside the gamepad loop.
  expect(ring.adjust(1)).toBe(true);
  expect(adjustFirst).not.toHaveBeenCalled();
  expect(adjustSecond).toHaveBeenCalledWith(1);
  ring.activate();
  expect(second.click).toHaveBeenCalledOnce();
  expect(first.click).not.toHaveBeenCalled();
});

// Invoke the real dispatcher without constructing an engine or substituting a
// second route implementation. Only the lifecycle effects are spies.
const navigate = (Shell.prototype as unknown as {
  navigateCommand(this: object, route: CommandRoute): void;
}).navigateCommand;

function harness(state: ShellState = 'menu', live = false) {
  const effects = {
    busy: false, game: live ? {} : null, backdrop: false, state,
    pause: vi.fn(), showMenu: vi.fn(), openCampaign: vi.fn(), openSetup: vi.fn(),
    openMissions: vi.fn(), openProfile: vi.fn(), openSettings: vi.fn(),
    openMultiplayer: vi.fn(), openLoadGame: vi.fn(), openReplays: vi.fn(),
    quitToMenu: vi.fn(async () => {}),
    show: vi.fn<(screen: Screen, state: ShellState) => void>(),
  };
  return effects;
}

describe('shared command navigation', () => {
  it('keeps the opening title uncluttered without removing navigation from inner pages', () => {
    for (const id of ['menu', 'loading', 'menu-decision']) {
      expect(showsCommandNavigation(id), id).toBe(false);
    }
    for (const id of ['campaign', 'briefing', 'setup', 'missions', 'profile', 'multiplayer', 'load', 'replays', 'settings', 'paused', 'ended']) {
      expect(showsCommandNavigation(id), id).toBe(true);
    }
  });

  it('renders each destination once across the top bar and utility rail', () => {
    // Minimal DOM for the actual builder, not a second rendering implementation.
    class Node {
      children: Node[] = [];
      className = '';
      dataset: Record<string, string> = {};
      attributes = new Map<string, string>();
      events = new Map<string, () => void>();
      classList = { add: vi.fn(), toggle: vi.fn() };
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
      removeAttribute(name: string) { this.attributes.delete(name); }
      hasAttribute(name: string) { return this.attributes.has(name); }
      append(...nodes: Node[]) { this.children.push(...nodes); }
      prepend(...nodes: Node[]) { this.children.unshift(...nodes); }
      appendChild(node: Node) { this.append(node); return node; }
      addEventListener(name: string, fn: () => void) { this.events.set(name, fn); }
      querySelectorAll(selector: string): Node[] {
        expect(selector).toBe('[data-command-route]');
        return this.children.flatMap(node => [
          ...(node.dataset.commandRoute ? [node] : []), ...node.querySelectorAll(selector),
        ]);
      }
    }
    vi.stubGlobal('document', { createElement: () => new Node(), createElementNS: () => new Node() });
    const root = new Node();
    const navigate = vi.fn();
    mountCommandNavigation(root as unknown as HTMLElement, 'settings', navigate);
    const header = root.children[0];
    const rail = root.children[1];
    const ids = (node: Node) => node.querySelectorAll('[data-command-route]').map(n => n.dataset.commandRoute);
    expect(ids(header)).toEqual(['menu', 'campaign', 'setup', 'missions', 'profile', 'codex']);
    expect(ids(rail)).toEqual(['multiplayer', 'load', 'replays', 'settings']);
    const controls = root.querySelectorAll('[data-command-route]');
    expect(controls).toHaveLength(COMMAND_ROUTES.length);
    expect(new Set(ids(root)).size).toBe(controls.length);
    for (const control of controls) {
      expect(control.hasAttribute('data-vm-focus')).toBe(true);
      control.events.get('click')!();
      expect(navigate).toHaveBeenLastCalledWith(control.dataset.commandRoute);
    }
    const activeIds = () => controls.filter(n => n.hasAttribute('aria-current')).map(n => n.dataset.commandRoute);
    expect(activeIds()).toEqual(['settings']);
    updateCommandSection(root as unknown as HTMLElement, 'codex');
    expect(activeIds()).toEqual(['codex']);
  });

  it('has one unique route for every header and rail entry', () => {
    expect(new Set(COMMAND_ROUTES.map(r => r.id)).size).toBe(COMMAND_ROUTES.length);
    expect(COMMAND_ROUTES.filter(r => r.top).map(r => r.label)).toEqual([
      'Command centre', 'Operations', 'Build', 'Intelligence', 'Service record', 'Codex',
    ]);
  });

  it.each([
    ['menu', 'showMenu', []], ['campaign', 'openCampaign', []],
    ['setup', 'openSetup', []], ['missions', 'openMissions', ['menu']],
    ['profile', 'openProfile', []], ['codex', 'openSettings', ['menu', 'manual']],
    ['multiplayer', 'openMultiplayer', []], ['load', 'openLoadGame', []],
    ['replays', 'openReplays', []], ['settings', 'openSettings', ['menu']],
  ] as const)('%s dispatches to its real destination', (route, method, args) => {
    const h = harness();
    navigate.call(h, route);
    expect(h[method]).toHaveBeenCalledWith(...args);
    expect(h.quitToMenu).not.toHaveBeenCalled();
  });

  it.each([
    ['menu', 'pause', []], ['missions', 'openMissions', ['paused']],
    ['settings', 'openSettings', ['paused']], ['codex', 'openSettings', ['paused', 'manual']],
  ] as const)('%s preserves the paused battle and its return route', (route, method, args) => {
    const h = harness('settings', true);
    navigate.call(h, route);
    expect(h[method]).toHaveBeenCalledWith(...args);
    expect(h.quitToMenu).not.toHaveBeenCalled();
    expect(h.show).not.toHaveBeenCalled();
  });

  it.each(['campaign', 'setup', 'profile', 'multiplayer', 'load', 'replays'] as const)(
    '%s asks before leaving a live battle; cancellation returns to pause', route => {
      const h = harness('paused', true);
      navigate.call(h, route);
      expect(h.show).toHaveBeenCalledOnce();
      expect(h.show.mock.calls[0][1]).toBe('paused');
      expect(h.quitToMenu).not.toHaveBeenCalled();
      expect(h.openCampaign).not.toHaveBeenCalled();
      expect(h.openProfile).not.toHaveBeenCalled();
      h.show.mock.calls[0][0].onBack?.();
      expect(h.pause).toHaveBeenCalledOnce();
    },
  );

  it('tears down an ended match before opening a title-only route', async () => {
    const h = harness('ended', true);
    navigate.call(h, 'profile');
    expect(h.quitToMenu).toHaveBeenCalledOnce();
    expect(h.openProfile).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(h.openProfile).toHaveBeenCalledOnce();
  });

  it('refuses navigation while a lifecycle operation is busy', () => {
    const h = harness();
    h.busy = true;
    for (const route of COMMAND_ROUTES) navigate.call(h, route.id);
    expect(h.openSetup).not.toHaveBeenCalled();
    expect(h.showMenu).not.toHaveBeenCalled();
    expect(h.show).not.toHaveBeenCalled();
  });

  it('the real pause entry accepts returning from a leave-battle decision', () => {
    const h = {
      ...harness('paused', true), pvp: null,
      game: { setPaused: vi.fn(), ctx: { cameraRig: { setInputEnabled: vi.fn() } } },
      setHudVisible: vi.fn(),
    };
    Shell.prototype.pause.call(h as unknown as Shell);
    expect(h.show).toHaveBeenCalledOnce();
    expect(h.show.mock.calls[0][0].id).toBe('paused');
    expect(h.game.setPaused).toHaveBeenCalledWith(true);
  });
});

/** Lobby reconnect is allowed; match rejoin is deliberately not a protocol feature. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROTOCOL_VERSION } from '../src/net/protocol';
import { Session, type LobbyPhase, type SessionEvents } from '../src/net/Session';

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(body: string): void { this.sent.push(body); }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  receive(message: object): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  private emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function events(phases: LobbyPhase[]): SessionEvents {
  return {
    onPhase: (phase) => { phases.push(phase); },
    onCode: () => { /* not under test */ },
    onRooms: () => { /* not under test */ },
    onStart: () => { /* not under test */ },
    onPeerLost: () => { /* not under test */ },
    onChat: () => { /* not under test */ },
    onPing: () => { /* not under test */ },
    onOver: () => { /* not under test */ },
    onNotice: () => { /* not under test */ },
  };
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Session lobby recovery', () => {
  it('greets a fresh socket after a lobby disconnect and can become ready again', () => {
    const phases: LobbyPhase[] = [];
    const session = new Session('wss://relay.example/ws', events(phases));
    session.connect();

    const first = FakeWebSocket.instances[0]!;
    first.open();
    expect(JSON.parse(first.sent[0]!)).toMatchObject({ t: 'hello', protocol: PROTOCOL_VERSION });
    first.receive({ t: 'welcome', protocol: PROTOCOL_VERSION });
    expect(session.lobbyPhase).toBe('ready');

    first.drop();
    expect(session.lobbyPhase).toBe('ended');
    expect(session.reconnectLobby()).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(JSON.parse(second.sent[0]!)).toMatchObject({ t: 'hello', protocol: PROTOCOL_VERSION });
    second.receive({ t: 'welcome', protocol: PROTOCOL_VERSION });
    expect(session.lobbyPhase).toBe('ready');
    expect(phases).toEqual(['connecting', 'ready', 'ended', 'connecting', 'ready']);
  });

  it('refuses to reinterpret a dropped match as a lobby reconnect', () => {
    const phases: LobbyPhase[] = [];
    const session = new Session('wss://relay.example/ws', events(phases));
    session.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ t: 'welcome', protocol: PROTOCOL_VERSION });
    socket.receive({
      t: 'start', slot: 0, seed: 77, map: 'temperate-valley',
      factions: [1, 2], names: ['Aster', 'Rook'], teams: [0, 1], ai: [],
      difficulty: [0, 0], controlled: [0], turnTicks: 3, turnDelay: 4,
    });
    expect(session.lobbyPhase).toBe('playing');

    socket.drop();
    expect(session.lobbyPhase).toBe('ended');
    expect(session.reconnectLobby()).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

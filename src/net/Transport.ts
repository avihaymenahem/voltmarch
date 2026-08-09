/**
 * ============================================================================
 * src/net/Transport.ts — the socket, and nothing else
 * ============================================================================
 * A typed WebSocket wrapper with no game knowledge in it. It connects, sends
 * `ClientMessage`, and hands back `ServerMessage`. Everything about turns,
 * commands and worlds lives above it.
 *
 * ── THE RELAY IS NOT TRUSTED EITHER ────────────────────────────────────────
 *
 * Every inbound frame is re-parsed through the SAME `parseMessage` the server
 * uses, and every command inside a frame is re-validated through the SAME
 * `validateCommand`. That is not paranoia about our own server; it is the only
 * way the client's behaviour is defined when something upstream is wrong —
 * a proxy that mangles a frame, a relay running an older build, or an actually
 * hostile server somebody pointed the game at.
 *
 * And when validation DOES fail here, the response is to end the match, not to
 * drop the command. See THE TRIPWIRE RULE in `protocol.ts`: dropping it on one
 * client and not the other manufactures a desync with no findable cause.
 *
 * ── NO RECONNECT, DELIBERATELY ─────────────────────────────────────────────
 *
 * A dropped socket ends the match. Reconnecting would mean replaying the whole
 * command log at speed to catch up, which the replay machinery could do and
 * which is explicitly out of scope for v1. A transport that silently reconnects
 * mid-match without that catch-up would rejoin a simulation that has moved on.
 * ============================================================================
 */

import { PROTOCOL_VERSION, parseMessage, validateCommand } from './protocol';
import type { ClientMessage, ErrorCode, ServerMessage, WireCommand } from './protocol';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closed';

export interface TransportHandlers {
  onMessage(msg: ServerMessage): void;
  onStateChange(state: ConnectionState): void;
  /**
   * Something arrived that must not be acted on. The match is over; the caller
   * decides how to say so. `detail` is for the console, never for the DOM.
   */
  onFatal(code: ErrorCode, detail: string): void;
}

export class Transport {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';

  constructor(
    private readonly url: string,
    private readonly build: string,
    private readonly handlers: TransportHandlers,
  ) {}

  get connectionState(): ConnectionState { return this.state; }

  connect(): void {
    if (this.ws !== null) return;
    this.setState('connecting');

    // `wss://` is not merely preferred: the game is served over https, and a
    // browser blocks a plaintext socket from a secure page outright. A `ws://`
    // URL here can only be a localhost development run.
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.setState('connected');
      // The build string is enforced by the relay, not merely logged: two
      // different builds of a deterministic simulation desync on contact, and
      // a stale cached bundle on one side is the likeliest way that happens.
      this.send({ t: 'hello', protocol: PROTOCOL_VERSION, build: this.build });
    });

    ws.addEventListener('message', (ev: MessageEvent) => { this.receive(ev.data); });

    ws.addEventListener('close', () => {
      this.ws = null;
      this.setState('closed');
    });

    ws.addEventListener('error', () => {
      // The close event always follows, and carries the state change. Anything
      // more here would double-report one failure.
    });
  }

  send(msg: ClientMessage): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  /* ---------------------------------------------------------------------- */

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    this.handlers.onStateChange(s);
  }

  /**
   * Parse and re-validate one inbound message.
   *
   * A binary frame, a malformed body or a command that fails validation are all
   * FATAL rather than ignored — see the header. This is the tripwire.
   */
  private receive(data: unknown): void {
    if (typeof data !== 'string') {
      this.handlers.onFatal('bad-message', 'the relay sent a binary frame');
      return;
    }
    const parsed = parseMessage(data);
    if (!parsed.ok) {
      this.handlers.onFatal('bad-message', `unreadable message: ${parsed.reason}`);
      return;
    }
    const msg = parsed.value as ServerMessage;

    if (msg.t === 'welcome' && msg.protocol !== PROTOCOL_VERSION) {
      this.handlers.onFatal('protocol-mismatch',
        `relay speaks v${String(msg.protocol)}, this build speaks v${PROTOCOL_VERSION}`);
      return;
    }

    if (msg.t === 'frame') {
      // `turn` becomes a Map key in `TurnScheduler.frames`. `typeof number`
      // alone admits NaN and 1e300, and a NaN key can never be matched or
      // pruned — the entry is immortal and the turn it claims never completes.
      if (!Array.isArray(msg.commands)
        || !Number.isInteger(msg.turn) || msg.turn < 0 || msg.turn > 0x7fffffff) {
        this.handlers.onFatal('bad-message', 'a frame with no usable turn or no commands');
        return;
      }
      // THE TRIPWIRE. The relay already validated these; if one fails here the
      // relay is compromised, buggy, or not the relay we think it is. Ending
      // the match is the only response that cannot cause a silent divergence.
      const commands: WireCommand[] = [];
      for (const raw of msg.commands) {
        const check = validateCommand(raw);
        if (!check.ok) {
          this.handlers.onFatal('invalid-command',
            `turn ${msg.turn} carried a command the relay should have refused: ${check.fault}`);
          return;
        }
        commands.push(check.value);
      }
      this.handlers.onMessage({ t: 'frame', turn: msg.turn, commands });
      return;
    }

    this.handlers.onMessage(msg);
  }
}

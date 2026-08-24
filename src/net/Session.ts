/**
 * ============================================================================
 * src/net/Session.ts — one multiplayer match, from connect to over
 * ============================================================================
 * Owns the `Transport`, owns the `TurnScheduler`, and is the only thing that
 * calls `attachSession` / `detachSession` on the lockstep system. The lobby
 * screen drives it; the simulation never sees it.
 *
 * ── ERROR CODES BECOME STRINGS HERE, AND ONLY HERE ─────────────────────────
 *
 * The relay never sends prose. It sends a closed `ErrorCode` union, and this
 * file maps each one to a local string. That is a security boundary, not a
 * style choice: a server that could send arbitrary display text would be an
 * injection vector into the opponent's UI, and the whole reason
 * `tests/foundation.spec.ts` grew a markup gate is that this UI is about to
 * start rendering strings that another player influenced.
 *
 * ── CORRUPTION ENDS; A MISSING OPPONENT IS DELEGATED ───────────────────────
 *
 * Desync, a command this build cannot apply, a mangled frame, or THIS client's
 * dropped socket ends the match. An opponent's dropped socket is different:
 * the relay retires that command source and delegates its logical seat to this
 * client, which runs the existing AI through the same command bus.
 * ============================================================================
 */

import { TurnScheduler } from './TurnScheduler';
import { Transport, type ConnectionState } from './Transport';
import { detachSession, prepareSession } from './net.system';
import { PROTOCOL_VERSION, WIRE_LIMITS } from './protocol';
import type {
  ErrorCode, OverReason, RoomSummary, RoomVisibility, ServerMessage,
} from './protocol';

declare const __APP_VERSION__: string;

/** What the relay decided the match is. Identical on both clients but `slot`. */
export interface MatchStart {
  slot: number;
  seed: number;
  map: string;
  factions: number[];
  turnTicks: number;
  turnDelay: number;
}

export type LobbyPhase =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'hosting'
  | 'queued'
  | 'playing'
  | 'ended';

export interface SessionEvents {
  onPhase(phase: LobbyPhase): void;
  /**
   * A room was opened. `code` is present only for a PRIVATE room — a public one
   * is reached through the browser and has no code, so there is nothing to show
   * and the UI must not invent one.
   */
  onCode(code: string | null, visibility: RoomVisibility): void;
  /** The public room list changed. Pushed by the relay, never polled. */
  onRooms(rooms: RoomSummary[], total: number): void;
  /** The relay has paired us. Boot the match. */
  onStart(info: MatchStart): void;
  /** The opponent's socket went; activate AI control for this logical seat. */
  onPeerLost(slot: number): void;
  /** The match is over, for any reason. `message` is already display-ready. */
  onOver(reason: OverReason, winnerSlot: number, message: string): void;
  /** Something went wrong that is worth telling the player about. */
  onNotice(message: string): void;
}

/**
 * Local text for every code the relay can send.
 *
 * Exhaustive by construction: `Record<ErrorCode, string>` fails to compile the
 * moment a code is added to the union without a string for it, which is the
 * only way this stays complete.
 */
const ERROR_TEXT: Record<ErrorCode, string> = {
  'protocol-mismatch': 'This build speaks a different network protocol than the server. Reload the page.',
  'build-mismatch': 'You and the server are on different game versions. Reload the page to update.',
  'bad-message': 'The server rejected a message from this client.',
  'rate-limited': 'Too many requests. Wait a moment and try again.',
  'too-many-connections': 'The server is full right now. Try again shortly.',
  'no-such-room': 'No match with that code. Check it and try again.',
  'room-full': 'That match already has two players.',
  'not-in-match': 'You are not in a match.',
  'invalid-command': 'An order was rejected by the server.',
  'turn-out-of-window': 'This client got ahead of the server.',
  'duplicate-turn': 'This client sent the same turn twice.',
  internal: 'The server hit an internal error.',
};

const OVER_TEXT: Record<OverReason, string> = {
  'opponent-left': 'Your opponent disconnected. The match is yours.',
  'opponent-quit': 'Your opponent resigned.',
  desync: 'The two games fell out of step and the match was stopped.',
  'server-shutdown': 'The server is restarting. The match was stopped.',
  timeout: 'The match ran past its time limit.',
};

export class Session {
  private readonly transport: Transport;
  private scheduler: TurnScheduler | null = null;
  private phase: LobbyPhase = 'idle';
  private slot = -1;

  constructor(url: string, private readonly events: SessionEvents) {
    this.transport = new Transport(
      url,
      typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
      {
        onMessage: (m) => { this.receive(m); },
        onStateChange: (s) => { this.transportChanged(s); },
        onFatal: (code, detail) => { this.fatalCode(code, detail); },
      },
    );
  }

  get lobbyPhase(): LobbyPhase { return this.phase; }
  get localSlot(): number { return this.slot; }

  /**
   * Hand the session over from the lobby screen to the shell.
   *
   * The lobby screen is unmounted the moment a match starts, so whoever built
   * the session is gone before most of its interesting events fire. Rather than
   * keeping a dead screen alive to receive them, the shell REPLACES the three
   * handlers that matter once a match is running. `onPhase`, `onCode` and
   * `onStart` keep the lobby's — they cannot fire again.
   */
  attach(handlers: Pick<SessionEvents, 'onOver' | 'onPeerLost' | 'onNotice'>): void {
    this.events.onOver = handlers.onOver;
    this.events.onPeerLost = handlers.onPeerLost;
    this.events.onNotice = handlers.onNotice;
  }

  connect(): void {
    this.setPhase('connecting');
    this.transport.connect();
  }

  /* -- lobby actions ------------------------------------------------------ */

  host(faction: number, map: string, visibility: RoomVisibility): void {
    this.transport.send({ t: 'create', faction, map, visibility });
  }

  /**
   * Open or close the room browser.
   *
   * SUBSCRIBE, DO NOT POLL. The relay pushes a new list whenever one actually
   * changes; a client asking every two seconds would have every idle player in
   * the product waking the server forever to be told nothing happened.
   */
  watchRooms(on: boolean): void {
    this.transport.send({ t: 'rooms', subscribe: on });
  }

  /** Join a public room picked out of the browser. */
  joinRoom(id: string, faction: number): void {
    this.transport.send({ t: 'joinRoom', id, faction });
  }

  join(code: string, faction: number): void {
    // Upper-cased and stripped here as well as on the relay: the code alphabet
    // has no lower case and no ambiguous glyphs, so anything else is a typo and
    // normalising it locally saves a round trip to be told so.
    this.transport.send({ t: 'join', code: code.trim().toUpperCase(), faction });
  }

  queue(faction: number): void {
    this.transport.send({ t: 'queue', faction });
  }

  cancel(): void {
    this.transport.send({ t: 'cancel' });
    this.setPhase('ready');
  }

  /** Leave a match or the lobby entirely, and tear the lockstep system down. */
  leave(): void {
    this.transport.send({ t: 'leave' });
    this.stopLockstep();
    this.transport.close();
    this.setPhase('ended');
  }

  /* -- inbound ------------------------------------------------------------ */

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.setPhase('ready');
        return;

      case 'created':
        this.setPhase('hosting');
        this.events.onCode(msg.code ?? null, msg.visibility);
        return;

      case 'rooms':
        this.events.onRooms(msg.rooms, msg.total);
        return;

      case 'waiting':
        this.setPhase('queued');
        return;

      case 'start':
        this.begin(msg);
        return;

      case 'frame':
        // A frame arriving before `start`, or after the match ended, is not a
        // state this protocol has — dropping it silently would be the one thing
        // guaranteed to desync, so it is fatal.
        if (this.scheduler === null) {
          this.fatalCode('bad-message', 'a turn frame arrived outside a match');
          return;
        }
        this.scheduler.receiveFrame(msg.turn, msg.commands);
        return;

      case 'desync':
        // The relay saw the two fingerprints disagree. It has already ended the
        // match on its side; `Checksum.ts` exists so this line has a tick.
        console.error(
          `%c[net]%c desync at tick ${msg.tick} — hashes ${msg.hashes.map(hex).join(' vs ')}`,
          'color:#f66', 'color:inherit',
        );
        this.stopLockstep();
        return;

      case 'peerLost':
        if (!Number.isInteger(msg.slot) || msg.slot < 0 || msg.slot >= WIRE_LIMITS.maxPlayers
          || msg.slot === this.slot) {
          this.fatalCode('bad-message', 'the relay delegated an unusable player slot');
          return;
        }
        this.events.onPeerLost(msg.slot);
        return;

      case 'over':
        this.stopLockstep();
        this.setPhase('ended');
        this.events.onOver(msg.reason, msg.winnerSlot, OVER_TEXT[msg.reason] ?? 'The match ended.');
        return;

      case 'error':
        this.events.onNotice(ERROR_TEXT[msg.code] ?? 'The server refused that.');
        return;

      default:
        return;
    }
  }

  /**
   * Accept a match start, or refuse it.
   *
   * EVERY FIELD IS CHECKED, because every one of them reaches something that
   * cannot defend itself. `slot` becomes `world.localPlayer` and is used as an
   * array index. `factions[]` is written onto `PlayerState.faction` and then
   * indexes the faction-keyed art and def tables. `turnTicks` is a DIVISOR and a
   * modulus in the turn arithmetic — zero or negative silently destroys it.
   * `seed` of 0 means "roll one locally", which would have each client generate
   * a different world from the same message.
   *
   * The relay bounds all of this already. That is not a reason to skip it here:
   * `protocol.ts` says a client treats bad input from the relay as a TRIPWIRE,
   * and a start message that fails is a relay that is compromised, buggy, or
   * not the relay we think it is. Refusing is the only response that cannot
   * produce a silently different world.
   */
  private begin(msg: Extract<ServerMessage, { t: 'start' }>): void {
    const bad = describeBadStart(msg);
    if (bad !== '') {
      this.fatalCode('bad-message', `unusable start message: ${bad}`);
      return;
    }
    this.slot = msg.slot;
    this.setPhase('playing');
    this.events.onStart({
      slot: msg.slot,
      seed: msg.seed,
      map: msg.map,
      factions: msg.factions.slice(),
      turnTicks: msg.turnTicks,
      turnDelay: msg.turnDelay,
    });
  }

  /**
   * Arm lockstep. Called by the shell BEFORE the world is booted.
   *
   * IT MUST BE BEFORE. The step gate has to exist for tick 1 — the tick that
   * opens turn 0 — because a turn that opens ungated never sends its frame, and
   * both clients then wait forever for a frame neither produced. Calling this
   * after `startMatch` returns froze every multiplayer match at around tick 7.
   * `prepareSession` parks it; `net.system.init()` installs the gate during the
   * boot, before the loop starts.
   *
   * The turn geometry comes from the START MESSAGE, not from local constants.
   * Both clients then agree even if one of them is running a build whose
   * `TURN_TICKS` differs, which is a mismatch the relay would otherwise have to
   * detect by watching two games slowly disagree.
   */
  startLockstep(info: MatchStart): void {
    const sched = new TurnScheduler({
      localSlot: info.slot,
      turnTicks: info.turnTicks,
      turnDelay: info.turnDelay,
    });
    this.scheduler = sched;
    prepareSession({
      scheduler: sched,
      sendFrame: (frame) => {
        this.transport.send({
          t: 'turn', turn: frame.turn, commands: frame.commands, check: frame.check,
        });
      },
      fatal: (detail) => { this.fatalCode('invalid-command', detail); },
    });
  }

  private stopLockstep(): void {
    if (this.scheduler === null) return;
    this.scheduler = null;
    detachSession();
  }

  private transportChanged(s: ConnectionState): void {
    if (s !== 'closed') return;
    if (this.phase === 'ended') return;
    this.stopLockstep();
    const wasPlaying = this.phase === 'playing';
    this.setPhase('ended');
    if (wasPlaying) {
      this.events.onOver('opponent-left', -1,
        'The connection to the server was lost. The match was stopped.');
    } else {
      this.events.onNotice('Disconnected from the server.');
    }
  }

  /**
   * A failure that must stop the match rather than be worked around.
   *
   * `detail` goes to the console for whoever is debugging; the PLAYER sees the
   * mapped string. The two are separate on purpose — `detail` is the only place
   * a relay-influenced string appears, and it never reaches the DOM.
   */
  private fatalCode(code: ErrorCode, detail: string): void {
    console.error(`%c[net]%c ${code}: ${detail}`, 'color:#f66', 'color:inherit');
    this.stopLockstep();
    const wasPlaying = this.phase === 'playing';
    this.setPhase('ended');
    if (wasPlaying) {
      this.events.onOver('desync', -1, ERROR_TEXT[code]);
    } else {
      this.events.onNotice(ERROR_TEXT[code]);
    }
    this.transport.close();
  }

  private setPhase(p: LobbyPhase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.events.onPhase(p);
  }
}

const hex = (n: number): string => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** Why a `start` message is unusable, or '' when it is fine. See `begin`. */
function describeBadStart(m: Extract<ServerMessage, { t: 'start' }>): string {
  const int = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);

  // Becomes `world.localPlayer` and indexes `world.players`.
  if (!int(m.slot) || m.slot < 0 || m.slot >= WIRE_LIMITS.maxPlayers) return 'slot';
  // 0 means "roll one locally", which would give the two clients different maps.
  if (!int(m.seed) || m.seed === 0) return 'seed';
  if (typeof m.map !== 'string' || !/^[a-z0-9-]{1,32}$/.test(m.map)) return 'map';

  if (!Array.isArray(m.factions) || m.factions.length < 2) return 'factions';
  if (m.factions.length > WIRE_LIMITS.maxPlayers) return 'factions';
  // Indexes the faction-keyed art and def tables. The relay bounds this with
  // WIRE_LIMITS.factions; applying the SAME bound here is the point of the
  // constant being shared rather than duplicated.
  for (const f of m.factions) {
    if (!int(f) || f < 0 || f >= WIRE_LIMITS.factions) return 'factions';
  }
  if (m.slot >= m.factions.length) return 'slot';

  // A divisor and a modulus in `TurnScheduler`. Zero destroys the arithmetic
  // silently; a huge value makes every order feel seconds late.
  if (!int(m.turnTicks) || m.turnTicks < 1 || m.turnTicks > 16) return 'turnTicks';
  // A loop bound for the bootstrap pre-seed, and the whole latency budget.
  if (!int(m.turnDelay) || m.turnDelay < 1 || m.turnDelay > 16) return 'turnDelay';

  return '';
}

/** The protocol this build speaks, for the lobby to display. */
export const CLIENT_PROTOCOL = PROTOCOL_VERSION;

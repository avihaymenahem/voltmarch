/**
 * ============================================================================
 * src/net/protocol.ts — the wire contract, and the only thing the server knows
 * ============================================================================
 * THIS FILE IS IMPORTED BY BOTH SIDES. The client bundles it; the relay in
 * `server/` compiles it. That is deliberate and it is the whole anti-drift
 * strategy: a message shape, a limit and a validation rule exist ONCE, so the
 * two ends cannot disagree about what a legal command is.
 *
 * Its import closure is exactly one other file — `src/core/types.ts`, which
 * imports nothing at all. So `server/tsconfig.json` can include precisely these
 * two files and importing `three`, `src/sim/**` or anything else becomes a
 * COMPILE ERROR rather than a code-review note. "The server runs no game code"
 * is therefore a property the compiler holds, not a promise a human keeps.
 *
 * ── THE SECURITY MODEL IN FOUR LINES ───────────────────────────────────────
 *
 *   The relay stamps identity.      (`player` is overwritten from the socket)
 *   The simulation enforces authority. (every applier already checks ownership)
 *   Validation rejects structure.   (`validateCommand`, below)
 *   Nothing silently drops.         (see THE TRIPWIRE RULE)
 *
 * `Command.player` in core/types.ts already carries the instruction this
 * depends on: "The bus stamps this; never trust a client-set value."
 *
 * ── THE TRIPWIRE RULE ──────────────────────────────────────────────────────
 *
 * `validateCommand` has two callers with two different jobs, and confusing them
 * produces the exact bug lockstep cannot survive.
 *
 *   THE SERVER runs it as a FILTER. A rejection happens BEFORE the broadcast,
 *   so every client receives the same frame and the rejection is atomically
 *   consistent for everyone.
 *
 *   A CLIENT runs it as a TRIPWIRE. By the time a command reaches a client the
 *   server has already approved it, so a failure means the relay is compromised
 *   or buggy. The correct response is to END THE MATCH with a named error —
 *   NOT to drop the command. Dropping it on one client and not the other is how
 *   you manufacture a desync with no cause anybody can find.
 *
 * ── REJECT, NEVER CLAMP ────────────────────────────────────────────────────
 *
 * A clamped command is a DIFFERENT command. Two implementations that round or
 * saturate differently diverge, so the validator never repairs anything: it
 * returns the command or it returns a fault. Same discipline as
 * `parseReplay`, which refuses a file rather than half-reading it.
 *
 * ── REBUILD, NEVER SANITISE ────────────────────────────────────────────────
 *
 * The value returned is a FRESH object with only known keys copied across.
 * Filtering a caller-supplied object leaves whatever else was on it — including
 * `__proto__`, `constructor` and any field a future reader might trust — so the
 * validator does not filter. It rebuilds. Same reason `ReplayRecorder.record`
 * copies out of the pooled struct rather than retaining it.
 * ============================================================================
 */

import { BuildTab, CommandKind, OrderKind, Stance } from '../core/types';

/* ==========================================================================
 * 1. VERSIONS
 * ========================================================================== */

/**
 * Bumped when any message shape below changes in a way an older peer cannot
 * survive. A mismatch REFUSES the connection rather than negotiating down: a
 * client that half-understands the protocol is a client that desyncs, and
 * "it mostly worked" is the outcome this number exists to prevent.
 *
 * ── WHY THIS IS 2 AND WAS 1 FOR THREE VOCABULARY CHANGES ───────────────────
 *
 * `git log -S` on this line returns exactly one commit — the one that wrote it.
 * `git log --follow` on the file returns three later ones that each WIDENED
 * what a legal command is and left the number alone:
 *
 *   `OrderKind.Unload`      added to ORDERS
 *   `CommandKind.UsePower`  added to KINDS
 *   `BuildTab.Powers`       added to TABS   (`BUILD_TAB_COUNT` 4 -> 5)
 *
 * Every one of those makes an older peer reject a command a newer peer sends —
 * as a TRIPWIRE, so the match ends rather than desyncing, which is the good
 * failure but not a good experience. Nothing was ever broken by it because no
 * build has ever carried a relay address (`VITE_RELAY_URL` is set nowhere), so
 * two builds have never paired. That is luck, and it expires the day this is
 * deployed.
 *
 * The number alone installs no mechanism, which is why `tests/net-protocol.spec`
 * pins the SIZE of each allowlist next to it: adding an enum member fails that
 * test, and the only way to make it pass is to state whether the wire changed.
 */
export const PROTOCOL_VERSION = 2;

/* ==========================================================================
 * 2. TURN SCHEDULE
 *
 * These are protocol, not preference: both ends compute turn boundaries from
 * them, so they travel in the `start` message and are not read from local
 * config on either side.
 * ========================================================================== */

/**
 * Simulation ticks per lockstep turn. At SIM_HZ 30 this is 10 turns a second.
 *
 * Commands therefore land only on ticks that are multiples of this. That is not
 * a compromise — quantising orders to 100 ms is inaudible next to the 200 ms of
 * scheduling delay below, and it keeps the frame rate of the network an order
 * of magnitude below the frame rate of the simulation.
 */
export const TURN_TICKS = 3;

/**
 * How many turns ahead a command is scheduled. Two turns at TURN_TICKS 3 is
 * 200–300 ms between the click and the effect, which is the latency budget the
 * whole design is buying: it is what lets a peer's frame arrive late without
 * anybody's simulation stalling.
 */
export const TURN_DELAY = 2;

/**
 * How far ahead of the executing turn a peer may send.
 *
 * Without a ceiling a client can announce turn 1,000,000 and make the server
 * hold a million frames in memory. `TURN_DELAY + 2` is the smallest window that
 * still tolerates a peer running slightly ahead.
 */
export const TURN_LOOKAHEAD = TURN_DELAY + 2;

/* ==========================================================================
 * 3. LIMITS
 *
 * MIRRORED CONSTANTS, BOUND BY A TEST. The engine's real values live in
 * `src/core/config.ts`, which is three thousand lines of art direction the
 * relay has no business carrying. So the four numbers the validator actually
 * needs are restated here and `tests/net-protocol.spec.ts` asserts each one
 * equals its source.
 *
 * This is the pattern `tools/shoot.mjs` already uses for SIM_HZ, and
 * Bootstrap.ts states the reason: "a duplicate nobody checks is a duplicate
 * that drifts".
 * ========================================================================== */

export const WIRE_LIMITS = {
  /** Mirrors MAX_SELECTION. The most entities one command may address. */
  maxEntitiesPerCommand: 100,
  /** Mirrors MAP_CELLS. Grid coordinates must fall inside [0, this). */
  mapCells: 128,
  /** Mirrors MAP_SIZE. World coordinates must fall inside [0, this]. */
  mapSize: 512,
  /** Mirrors MAX_PLAYERS. */
  maxPlayers: 8,
  /**
   * Mirrors FACTION_COUNT. Bounds a faction index BEFORE it is relayed.
   *
   * The relay used to accept anything under 8 because that was the player cap
   * and the two numbers looked interchangeable. They are not: a faction of 5, 6
   * or 7 would have been forwarded to both clients, seated by
   * `seatPvpPlayers`, and then used to index the faction-keyed art and def
   * tables — producing `undefined`, then NaN, then the black frame CLAUDE.md
   * already records losing a day to. Both clients would do it identically, so
   * the checksum would agree perfectly the whole way down.
   */
  factions: 5,
  /**
   * Loose structural ceiling on `defId`. The def tables are built at runtime
   * and the relay cannot know their length, so this only rejects the absurd;
   * an unknown-but-plausible id is refused by the simulation, which already
   * returns undefined for one and does nothing.
   *
   * IT WAS 4095 AND THAT REJECTED EVERY UNIT IN THE GAME. `Command.defId` on a
   * production command is a `BuildEntry.publicId`, and `UNIT_PUBLIC_ID_BASE` is
   * **4096** — exactly one above the old ceiling. So every `ProductionStart` and
   * `ProductionCancel` for a unit (measured: publicIds 4096..4155 over the
   * shipped 60-unit roster) came back `{ fault: 'bounds' }`, `TurnRelay` emptied
   * the WHOLE submission, and a multiplayer player could not buy a single hull —
   * losing every other order issued in the same 100 ms turn with it.
   *
   * The ceiling was understood everywhere except where it bit. `Production.ts`
   * argues at length that `UPGRADE_PUBLIC_ID_BASE` sits at 2048 and
   * `POWER_PUBLIC_ID_BASE` at 3072 *because* an id above this is dropped by the
   * relay; `tests/upgrades.spec.ts` and `tests/command-post.spec.ts` each assert
   * their own half against it. Nobody ever asserted the unit half, and the unit
   * half is the one that was wrong.
   *
   * 8191 is `UNIT_PUBLIC_ID_BASE * 2 - 1`: the unit window is now exactly as
   * wide as the whole id space beneath it, so the roster can grow by two orders
   * of magnitude before this is a question again. Widening rejects no case the
   * old value caught — 4096 of the 4096 ids below it were already
   * unknown-but-plausible, and `ProductionCatalog.resolve` answers `undefined`
   * for an unknown id in either range. `tests/net-protocol.spec.ts` binds this
   * to the real roster in BOTH directions so it cannot drift again.
   */
  maxDefId: 8191,
  /**
   * Commands one slot may contribute to one turn.
   *
   * IT WAS 32, AND ONE LEGAL GESTURE EMITS UP TO 100. Self-destruct fans out to
   * one command per selected unit (`Hud.ts` walks a `MAX_SELECTION`-sized id
   * buffer), and deploy and set-primary have the same shape — so a player who
   * box-selected 33 hulls and pressed the confirm key had the entire turn
   * emptied and every other order in it lost. A cap that bites legitimate play
   * is a worse defect than the one it closes.
   *
   * 128 is `MAX_SELECTION` (100) plus headroom, because `TURN_TICKS` is 3 and a
   * turn therefore banks up to three sim ticks of fan-out. The ceiling that
   * matters for resources is `maxMessageBytes` below, not this: 128 commands
   * with no entity lists is ~17 kB and the worst realistic turn — 100
   * self-destructs plus a 100-entity move order — is under 20 kB, comfortably
   * inside the 64 kB frame `ws` will accept. Raising `maxMessageBytes` to buy
   * room here would be a real DoS regression traded for an imaginary one.
   */
  maxCommandsPerTurn: 128,
  /** Bytes. Anything larger is closed on, not parsed. */
  maxMessageBytes: 64 * 1024,
} as const;

/**
 * EntityId is a packed handle — 12 generation bits above 20 index bits — built
 * with `<<`, which yields a SIGNED 32-bit result. Any generation at or above
 * 2048 therefore produces a NEGATIVE handle, and the arena that stores them is
 * an Int32Array. So the legal range is the whole of int32, and a validator that
 * demanded non-negative ids would reject perfectly ordinary late-game units.
 */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/* ==========================================================================
 * 3b. INVITE CODES
 *
 * SHARED, because both ends need them: the relay generates a code and the lobby
 * validates what was typed before spending a round trip and a rate-limit token
 * being told it was a typo.
 * ========================================================================== */

/**
 * Characters an invite code may contain.
 *
 * `0/O`, `1/I/L` and `U/V` are omitted: a code is read aloud and typed by hand,
 * and a mistyped code is indistinguishable from a wrong one. 29 symbols over 6
 * places is 5.9e8 — which is only safe BECAUSE of the relay's per-address join
 * limit. The alphabet size is not the defence; the rate limit is.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const CODE_LENGTH = 6;

/** True when `code` could possibly be a code this scheme produced. */
export function isWellFormedCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/* ==========================================================================
 * 3c. THE ROOM BROWSER
 * ========================================================================== */

/**
 * Whether a room appears in the public list.
 *
 * A PUBLIC ROOM AND AN INVITE CODE ARE DIFFERENT PRODUCTS, and conflating them
 * breaks both. If every room were listed, the code would be decorative and a
 * friend's private game would be joinable by any stranger who refreshed the
 * browser. If no room were listed, there would be no browser.
 *
 * So a room declares which it is, and a private one is never listed under any
 * circumstances.
 */
export type RoomVisibility = 'public' | 'private';

/**
 * One row in the room browser.
 *
 * WHAT IS DELIBERATELY NOT HERE IS THE POINT OF THE TYPE:
 *
 *   - NOT the invite code. `id` is a SEPARATE token, so a bug in the listing
 *     path cannot leak a private room's code — there is no code in the object
 *     to leak. Two tokens cost one extra field and remove a whole class of
 *     mistake.
 *   - NOT the host's address, hashed or otherwise.
 *   - NOT a name, a title or any other free text. Everything here is a number,
 *     an enum, or a map id checked against `/^[a-z0-9-]+$/`. The browser
 *     therefore renders nothing a stranger authored.
 */
export interface RoomSummary {
  /** Opaque public handle. NOT the invite code. */
  id: string;
  /** Map id. Checked against a character class before it is ever listed. */
  map: string;
  /** The host's chosen faction, as a Faction index. */
  faction: number;
  /** Seconds since the room opened, so the UI can show staleness. */
  ageSec: number;
}

/** Length of a public room id. Longer than a code: nobody types one. */
export const ROOM_ID_LENGTH = 12;

/**
 * Most rooms one listing carries.
 *
 * A CAP THAT IS REPORTED, NOT SILENT. `RoomList.total` travels with it so the
 * UI can say "showing 60 of 140" rather than implying the world is small — a
 * truncation nobody mentions reads as completeness.
 */
export const ROOM_LIST_LIMIT = 60;

export interface RoomList {
  rooms: RoomSummary[];
  /** How many public rooms exist, before `ROOM_LIST_LIMIT` was applied. */
  total: number;
}

/* ==========================================================================
 * 4. THE COMMAND ON THE WIRE
 * ========================================================================== */

/**
 * One command, flat and JSON-safe.
 *
 * The same shape `ReplayCommand` carries, minus its tick — deliberately, so
 * `applyCommand` can re-issue a recorded command and a received one through one
 * code path. A replay and a multiplayer frame are the same thing arriving from
 * two different places.
 */
export interface WireCommand {
  kind: number;
  /** Slot index. Stamped by the relay from the socket; a client's value is discarded. */
  player: number;
  order: number;
  target: number;
  x: number;
  z: number;
  defId: number;
  tab: number;
  cx: number;
  cz: number;
  stance: number;
  queued: boolean;
  arg: number;
  entities: number[];
}

/** Why a command was refused. A closed set, so the wire never carries prose. */
export type CommandFault =
  | 'shape'      // not an object, or a field has the wrong JavaScript type
  | 'kind'       // not a CommandKind this build knows
  | 'order'      // not an OrderKind
  | 'tab'        // not a BuildTab
  | 'stance'     // not a Stance
  | 'player'     // not a plausible slot index
  | 'nonfinite'  // NaN or Infinity reached a numeric field
  | 'noninteger' // a field that indexes something was fractional
  | 'bounds'     // a coordinate or id outside the map / table
  | 'entities';  // the entity list is missing, oversized or malformed

export type CommandCheck =
  | { ok: true; value: WireCommand }
  | { ok: false; fault: CommandFault; detail: string };

/* -- allowlists, not range checks ------------------------------------------
 * `kind >= 0 && kind <= 12` passes anything a future gap in the enum leaves
 * behind. These are explicit sets built from the enum itself, so adding a
 * CommandKind without adding it here fails closed — which is the direction a
 * security check should fail.
 * ------------------------------------------------------------------------ */

const KINDS: ReadonlySet<number> = new Set<number>([
  CommandKind.Order, CommandKind.ProductionStart, CommandKind.ProductionPause,
  CommandKind.ProductionCancel, CommandKind.PlaceBuilding, CommandKind.SetRally,
  CommandKind.SellBuilding, CommandKind.RepairToggle, CommandKind.SetStance,
  CommandKind.SetPrimary, CommandKind.SelfDestruct, CommandKind.Relocate,
  CommandKind.UsePower,
]);

const ORDERS: ReadonlySet<number> = new Set<number>([
  OrderKind.None, OrderKind.Move, OrderKind.AttackMove, OrderKind.Attack,
  OrderKind.ForceAttack, OrderKind.Stop, OrderKind.Guard, OrderKind.Harvest,
  OrderKind.Deploy, OrderKind.Capture, OrderKind.Repair, OrderKind.Enter,
  OrderKind.Scatter, OrderKind.Patrol, OrderKind.SetRally, OrderKind.UseAbility,
  OrderKind.Unload,
]);

/**
 * AN ALLOWLIST, NOT A RANGE CHECK, and `Powers` is spelt out here for the same
 * reason the other four are: a `c.tab < BUILD_TAB_COUNT` test would silently
 * start accepting whatever the next tab turns out to be, on a relay that is
 * deliberately kept ignorant of the game's tables. A production command in the
 * Powers tab is an ordinary `ProductionStart` carrying `defId` 3072 + the power
 * id, which is inside `WIRE_LIMITS.maxDefId` — see `POWER_PUBLIC_ID_BASE`.
 */
const TABS: ReadonlySet<number> = new Set<number>([
  BuildTab.Structures, BuildTab.Defense, BuildTab.Infantry, BuildTab.Vehicles,
  BuildTab.Powers,
]);

const STANCES: ReadonlySet<number> = new Set<number>([
  Stance.Aggressive, Stance.Defensive, Stance.HoldFire, Stance.HoldGround,
]);

/** `CommandKind.None` is legal in the enum and meaningless on the wire. */
export function isKnownCommandKind(k: number): boolean { return KINDS.has(k); }

/* ==========================================================================
 * 5. THE VALIDATOR
 * ========================================================================== */

function fault(f: CommandFault, detail: string): CommandCheck {
  return { ok: false, fault: f, detail };
}

/** Finite, and an integer, and inside [lo, hi]. */
function intIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Finite (NOT NaN, NOT Infinity) and inside [lo, hi]. Fractions allowed. */
function realIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * Turn an untrusted value into a `WireCommand`, or say why not.
 *
 * PURE. No clock, no randomness, no I/O, no logging — so the server and every
 * client reach the identical verdict for the identical input, which is the
 * property the whole scheme rests on. See THE TRIPWIRE RULE in the header for
 * what each caller must DO with a rejection; they are not the same thing.
 *
 * The `Number.isFinite` checks are the load-bearing ones. This repo has already
 * lost a day to a NaN that reached an instance colour attribute and came back
 * out of the bloom pass as an entirely black frame — a remote peer must not be
 * able to post one deliberately.
 */
/**
 * The size of each allowlist above, so a test can pin the vocabulary next to
 * `PROTOCOL_VERSION`.
 *
 * EXPORTED FOR ONE REASON: the version sat at 1 through three widenings of
 * these four sets, because nothing forced anybody to look at it. Adding an enum
 * member now fails `tests/net-protocol.spec.ts` by name, and the only way to
 * make it pass is to decide, out loud, whether the wire changed. The sets
 * themselves stay private — they are a validator's internals, not a contract.
 */
export const VOCABULARY_SIZES = {
  kinds: KINDS.size,
  orders: ORDERS.size,
  tabs: TABS.size,
  stances: STANCES.size,
} as const;

export function validateCommand(raw: unknown): CommandCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fault('shape', 'not an object');
  }
  const c = raw as Record<string, unknown>;

  if (!intIn(c.kind, 0, 255)) return fault('shape', 'kind is not a small integer');
  if (!KINDS.has(c.kind as number)) return fault('kind', `unknown command kind ${String(c.kind)}`);

  if (!intIn(c.player, 0, WIRE_LIMITS.maxPlayers - 1)) {
    return fault('player', `slot ${String(c.player)} is not a player`);
  }
  if (!intIn(c.order, 0, 255)) return fault('shape', 'order is not a small integer');
  if (!ORDERS.has(c.order as number)) return fault('order', `unknown order ${String(c.order)}`);
  if (!intIn(c.tab, 0, 255)) return fault('shape', 'tab is not a small integer');
  if (!TABS.has(c.tab as number)) return fault('tab', `unknown build tab ${String(c.tab)}`);
  if (!intIn(c.stance, 0, 255)) return fault('shape', 'stance is not a small integer');
  if (!STANCES.has(c.stance as number)) return fault('stance', `unknown stance ${String(c.stance)}`);

  // Handles span the whole of int32 — see INT32_MIN above.
  if (!intIn(c.target, INT32_MIN, INT32_MAX)) {
    return fault(typeof c.target === 'number' && !Number.isFinite(c.target) ? 'nonfinite' : 'noninteger',
      'target is not an entity handle');
  }

  // World coordinates. Fractional, so `realIn` — but still finite and on the map.
  if (!realIn(c.x, 0, WIRE_LIMITS.mapSize)) return fault('bounds', `x ${String(c.x)} is off the map`);
  if (!realIn(c.z, 0, WIRE_LIMITS.mapSize)) return fault('bounds', `z ${String(c.z)} is off the map`);

  // Grid coordinates. Integers, and inside the cell grid.
  if (!intIn(c.cx, 0, WIRE_LIMITS.mapCells - 1)) return fault('bounds', `cx ${String(c.cx)} is off the grid`);
  if (!intIn(c.cz, 0, WIRE_LIMITS.mapCells - 1)) return fault('bounds', `cz ${String(c.cz)} is off the grid`);

  // -1 is the live "no def" sentinel the bus itself resets to.
  //
  // `defId` IS ALWAYS A `ProductionCatalog.publicId` AND NEVER A STORE-SPACE ID.
  // Worth stating because the id-space reasoning in this file is the thing
  // people get wrong — `maxDefId` was one below every unit for as long as units
  // had ids. `Command.defId` is written in exactly four places in
  // `core/events.ts` (the reset to -1 and the three production constructors)
  // and every caller passes a `publicId`. Store-space ids — wrecks at 30000+,
  // scatter props — live in a different space entirely and are only ever READ
  // from `store.defId[]` for capability lookups; none of those five call sites
  // writes a command field, so nothing from that space can reach this check.
  if (!intIn(c.defId, -1, WIRE_LIMITS.maxDefId)) {
    return fault('bounds', `defId ${String(c.defId)} is not a plausible def`);
  }

  // `arg` carries a facing, a queue slot, a count or -1 depending on kind.
  // Structurally it is a small integer and nothing more can be said here; the
  // simulation is what knows which meaning applies.
  if (!intIn(c.arg, -1024, 1024)) return fault('bounds', `arg ${String(c.arg)} is out of range`);

  if (typeof c.queued !== 'boolean') return fault('shape', 'queued is not a boolean');

  if (!Array.isArray(c.entities)) return fault('entities', 'entities is not an array');
  if (c.entities.length > WIRE_LIMITS.maxEntitiesPerCommand) {
    return fault('entities', `${c.entities.length} entities exceeds ${WIRE_LIMITS.maxEntitiesPerCommand}`);
  }
  // Rebuilt element by element: the output array shares no identity with the
  // input, so a caller cannot mutate it afterwards and cannot smuggle a holey
  // array or an exotic object through.
  const entities: number[] = new Array<number>(c.entities.length);
  for (let i = 0; i < c.entities.length; i++) {
    const e: unknown = c.entities[i];
    if (!intIn(e, INT32_MIN, INT32_MAX)) {
      return fault('entities', `entity ${i} is not a handle`);
    }
    entities[i] = e as number;
  }

  // REBUILT, not filtered. Only these fourteen keys exist on the result, so
  // `__proto__`, `constructor` and anything else the sender attached is gone by
  // construction rather than by a blocklist somebody has to keep current.
  return {
    ok: true,
    value: {
      kind: c.kind as number,
      player: c.player as number,
      order: c.order as number,
      target: c.target as number,
      x: c.x as number,
      z: c.z as number,
      defId: c.defId as number,
      tab: c.tab as number,
      cx: c.cx as number,
      cz: c.cz as number,
      stance: c.stance as number,
      queued: c.queued,
      arg: c.arg as number,
      entities,
    },
  };
}

/* ==========================================================================
 * 6. MESSAGES
 *
 * `t` is the discriminant on every one. Short, because these are the only
 * things on the hot path — a turn frame goes out ten times a second per player.
 * ========================================================================== */

/** Why a match ended. A closed set: the wire never carries prose to display. */
export type OverReason =
  | 'opponent-left'
  | 'opponent-quit'
  | 'desync'
  | 'server-shutdown'
  | 'timeout';

/**
 * Why a connection was refused or closed.
 *
 * A CLOSED SET, AND THAT IS A SECURITY DECISION. If the server could send
 * arbitrary strings for the client to display, the relay would become an
 * injection vector into the opponent's UI. The client maps these codes to its
 * own local strings and never renders a server-supplied one.
 */
export type ErrorCode =
  | 'protocol-mismatch'
  | 'build-mismatch'
  | 'bad-message'
  | 'rate-limited'
  | 'too-many-connections'
  | 'no-such-room'
  | 'room-full'
  | 'not-in-match'
  | 'invalid-command'
  | 'turn-out-of-window'
  | 'duplicate-turn'
  | 'internal';

/** The sim fingerprint a peer reports for a turn. Same triple as ReplayCheck. */
export interface WireCheck {
  tick: number;
  hash: number;
}

/* -- client -> server ----------------------------------------------------- */

export type ClientMessage =
  | { t: 'hello'; protocol: number; build: string }
  | { t: 'create'; faction: number; map: string; visibility: RoomVisibility }
  /** Join a PRIVATE room by the code its host was given. */
  | { t: 'join'; code: string; faction: number }
  /** Join a PUBLIC room picked out of the browser. */
  | { t: 'joinRoom'; id: string; faction: number }
  /**
   * Open or close the room browser.
   *
   * SUBSCRIBE, DO NOT POLL. A browser that re-requested every two seconds would
   * have every idle client in the product waking the server on a timer forever,
   * to be told nothing changed. The server pushes a fresh list to subscribers
   * when one actually changes, and `cancel`/`leave` unsubscribes.
   */
  | { t: 'rooms'; subscribe: boolean }
  | { t: 'queue'; faction: number }
  | { t: 'cancel' }
  | { t: 'turn'; turn: number; commands: WireCommand[]; check: WireCheck }
  | { t: 'leave' };

/* -- server -> client ----------------------------------------------------- */

export type ServerMessage =
  | { t: 'welcome'; protocol: number }
  /**
   * A room was opened. `code` is present only for a PRIVATE room — a public one
   * is reached from the browser and has no code to show, so the field is absent
   * rather than empty and the UI cannot display a code that means nothing.
   */
  | { t: 'created'; code?: string; visibility: RoomVisibility }
  /** The public room list, pushed on subscribe and on every change. */
  | { t: 'rooms'; rooms: RoomSummary[]; total: number }
  | { t: 'waiting' }
  | {
    t: 'start';
    /** Which slot THIS client drives. The only per-client field in the match setup. */
    slot: number;
    seed: number;
    map: string;
    /** Faction per slot, index === slot. */
    factions: number[];
    turnTicks: number;
    turnDelay: number;
  }
  /** The merged, validated, identity-stamped frame for one turn. */
  | { t: 'frame'; turn: number; commands: WireCommand[] }
  | { t: 'desync'; turn: number; tick: number; hashes: number[] }
  | { t: 'peerLost'; graceMs: number }
  | { t: 'peerBack' }
  | { t: 'over'; reason: OverReason; winnerSlot: number }
  | { t: 'error'; code: ErrorCode };

/**
 * Parse a JSON string into a message, or fail.
 *
 * `JSON.parse` with no reviver is safe against prototype pollution on its own —
 * a `"__proto__"` key produces an ordinary own property, not a prototype write —
 * but every consumer below still rebuilds rather than trusting the parsed
 * object, so the guarantee does not rest on that subtlety being remembered.
 */
export function parseMessage(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (text.length > WIRE_LIMITS.maxMessageBytes) return { ok: false, reason: 'too large' };
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return { ok: false, reason: 'not an object' };
    }
    if (typeof (v as { t?: unknown }).t !== 'string') return { ok: false, reason: 'no discriminant' };
    return { ok: true, value: v };
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
}
